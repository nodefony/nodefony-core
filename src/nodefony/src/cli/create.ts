import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SysExit } from "./sysexits";
import { version } from "../../package.json";

/**
 * Scaffold `nodefony create <type> <name>` — chaîne de création d'un projet.
 *
 * Pur outillage standalone (même famille que status/stop/completion) : AUCUN boot
 * kernel — `create app` s'exécute HORS de tout projet Nodefony (c'est son cas
 * nominal : `npx nodefony create app mon-app`). Les templates sont de VRAIS
 * fichiers paramétrés (`templates/<type>/**∕*.tpl`, tokens `{{token}}`) shippés
 * avec le paquet npm — source UNIQUE partagée avec le skill IA de scaffold
 * (le skill délègue à cette commande, il ne réimplémente pas la mécanique).
 */

/** Types de scaffold disponibles (`module`/`controller` = lots suivants). */
export const CREATE_TYPES = ["app"] as const;
export type TCreateType = (typeof CREATE_TYPES)[number];

/** Un nom de projet npm-safe : kebab-case, commence par une lettre. */
const NAME_RE = /^[a-z][a-z0-9-]*$/u;

/** Fichiers dont le nom rendu diffère du template (npm strip les dotfiles publiés). */
const RENAMES: Record<string, string> = { gitignore: ".gitignore" };

export interface ICreateRequest {
  type: TCreateType;
  name: string;
  /** Dossier cible complet (défaut : `./<name>` relatif au cwd). */
  dir: string;
  /** Autorise un dossier cible existant non vide. */
  force: boolean;
  /** Câble les deps nodefony en `file:` vers un checkout local (avant release npm). */
  link: boolean;
}

/**
 * Parse l'argv complet du process après le mot `create`.
 *
 * @returns la requête, ou un message d'usage si invalide
 */
export function parseCreateArgv(
  argv: string[],
): ICreateRequest | { error: string } {
  const at = argv.indexOf("create");
  const rest = at === -1 ? [] : argv.slice(at + 1);
  const positionals: string[] = [];
  let dir: string | undefined;
  let force = false;
  let link = false;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--force" || word === "-f") {
      force = true;
    } else if (word === "--link") {
      link = true;
    } else if (word === "--dir") {
      dir = rest[++i];
    } else if (word.startsWith("-")) {
      return { error: `option inconnue : ${word}` };
    } else {
      positionals.push(word);
    }
  }
  const [type, name] = positionals;
  if (!type || !(CREATE_TYPES as readonly string[]).includes(type)) {
    return {
      error: `type requis : ${CREATE_TYPES.join(" | ")} (reçu : ${type ?? "rien"})`,
    };
  }
  if (!name) {
    return { error: "nom requis : nodefony create app <name>" };
  }
  if (!NAME_RE.test(name) || name.length > 100) {
    return {
      error: `nom invalide « ${name} » — kebab-case attendu (ex : mon-app)`,
    };
  }
  return { type: type as TCreateType, name, dir: dir ?? name, force, link };
}

/**
 * Racine du paquet `nodefony` contenant `templates/` — remontée depuis CE fichier
 * (source `src/cli/`, bundle `dist/node/cli/` ou `bin/nodefony` : la remontée
 * marche pour les trois sans dépendre de la profondeur).
 */
export function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
          name?: string;
        };
        if (pkg.name === "nodefony") {
          return dir;
        }
      } catch {
        // package.json illisible → continuer la remontée
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error("paquet nodefony introuvable (templates/)");
}

/**
 * Rend un arbre de templates : chaque `*.tpl` est copié dans `destDir` (suffixe
 * retiré, renames appliqués), tokens `{{token}}` substitués. Un token inconnu
 * jette — garantit ZÉRO `{{` résiduel dans le rendu.
 *
 * @returns chemins relatifs écrits (triés, pour le récap et les tests)
 */
export function renderTemplates(
  srcDir: string,
  destDir: string,
  tokens: Record<string, string>,
): string[] {
  const written: string[] = [];
  const entries = readdirSync(srcDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tpl")) {
      continue;
    }
    const abs = path.join(entry.parentPath, entry.name);
    const relDir = path.relative(srcDir, entry.parentPath);
    const base = entry.name.replace(/\.tpl$/u, "");
    const rel = path.join(relDir, RENAMES[base] ?? base);
    const rendered = readFileSync(abs, "utf8").replace(
      /\{\{(\w+)\}\}/gu,
      (_, key: string) => {
        const value = tokens[key];
        if (value === undefined) {
          throw new Error(`token inconnu dans ${rel} : {{${key}}}`);
        }
        return value;
      },
    );
    const target = path.join(destDir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, rendered);
    written.push(rel);
  }
  return written.sort();
}

/**
 * Workspaces nodefony d'un CHECKOUT du repo (`src/nodefony` + `src/packages/@nodefony/*`),
 * résolus depuis la racine du paquet `nodefony`. Un paquet INSTALLÉ (node_modules)
 * n'a pas ce voisinage → `null` (le mode `--link` n'a de sens que sur un checkout).
 */
export function resolveLocalWorkspaces(
  packageRoot: string,
): Record<string, string> | null {
  const packagesDir = path.resolve(packageRoot, "..", "packages", "@nodefony");
  if (!existsSync(packagesDir)) {
    return null;
  }
  const map: Record<string, string> = { nodefony: packageRoot };
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      map[`@nodefony/${entry.name}`] = path.join(packagesDir, entry.name);
    }
  }
  return map;
}

/**
 * Mode `--link` : réécrit dans le `package.json` GÉNÉRÉ toute dep `nodefony` /
 * `@nodefony/*` en `file:<workspace>` — `npm install` symlinke le checkout local
 * et installe ses deps transitives. Rend l'app contrôlable AVANT toute release
 * npm (dev du framework) ; les deps publiques (zod, rolldown…) restent au registre.
 *
 * @returns les noms de paquets liés (triés, pour le récap)
 * @throws si une dep du scope nodefony n'existe pas dans le checkout
 */
export function linkLocalDeps(
  destDir: string,
  workspaces: Record<string, string>,
): string[] {
  const manifestPath = path.join(destDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    Record<string, string>
  >;
  const linked: string[] = [];
  for (const block of ["dependencies", "devDependencies"]) {
    const deps = manifest[block];
    if (!deps) {
      continue;
    }
    for (const name of Object.keys(deps)) {
      if (name !== "nodefony" && !name.startsWith("@nodefony/")) {
        continue;
      }
      const workspace = workspaces[name];
      if (!workspace) {
        throw new Error(`--link : workspace introuvable pour ${name}`);
      }
      deps[name] = `file:${workspace}`;
      linked.push(name);
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return linked.sort();
}

/**
 * Commande `nodefony create <type> <name> [--dir <path>] [--force] [--link]` —
 * génère un projet depuis les templates shippés. Standalone : zéro boot,
 * utilisable via `npx nodefony create app mon-app` hors de tout projet.
 *
 * @returns exit code sémantique (`OK`, `USAGE`, `CANTCREAT`, `SOFTWARE`)
 */
export function runCreateCommand(argv: string[]): number {
  const parsed = parseCreateArgv(argv);
  if ("error" in parsed) {
    process.stderr.write(
      `create: ${parsed.error}\n` +
        `usage : nodefony create <${CREATE_TYPES.join("|")}> <name> [--dir <path>] [--force] [--link]\n`,
    );
    return SysExit.USAGE;
  }
  const dest = path.resolve(parsed.dir);
  if (existsSync(dest) && readdirSync(dest).length > 0 && !parsed.force) {
    process.stderr.write(
      `create: le dossier ${dest} existe et n'est pas vide (--force pour écraser)\n`,
    );
    return SysExit.CANTCREAT;
  }
  let files: string[];
  let linked: string[] = [];
  try {
    const packageRoot = findPackageRoot();
    const templates = path.join(packageRoot, "templates", parsed.type);
    files = renderTemplates(templates, dest, {
      appName: parsed.name,
      nodefonyVersion: version,
    });
    if (parsed.link) {
      const workspaces = resolveLocalWorkspaces(packageRoot);
      if (!workspaces) {
        process.stderr.write(
          `create: --link exige un CHECKOUT de nodefony-core (paquet installé détecté).\n` +
            `Sans checkout, attends la release npm puis installe sans --link.\n`,
        );
        return SysExit.SOFTWARE;
      }
      linked = linkLocalDeps(dest, workspaces);
    }
  } catch (e) {
    process.stderr.write(`create: ${(e as Error).message}\n`);
    return SysExit.SOFTWARE;
  }
  const relDest = path.relative(process.cwd(), dest) || ".";
  const linkNote = linked.length
    ? `\n🔗 --link : ${linked.length} paquets nodefony câblés en file: sur le checkout local (dev framework — ne pas publier ce package.json tel quel)\n`
    : "";
  process.stdout.write(
    `✔ ${parsed.type} « ${parsed.name} » généré dans ${relDest}/\n\n` +
      files.map((f) => `  ${f}`).join("\n") +
      `\n${linkNote}\nProchaines étapes :\n` +
      `  cd ${relDest}\n` +
      `  npm install\n` +
      `  npm run dev        # → http://127.0.0.1:5151/api/hello\n`,
  );
  return SysExit.OK;
}
