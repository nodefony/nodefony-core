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
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--force" || word === "-f") {
      force = true;
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
  return { type: type as TCreateType, name, dir: dir ?? name, force };
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
 * Commande `nodefony create <type> <name> [--dir <path>] [--force]` — génère un
 * projet depuis les templates shippés. Standalone : zéro boot, utilisable via
 * `npx nodefony create app mon-app` hors de tout projet.
 *
 * @returns exit code sémantique (`OK`, `USAGE`, `CANTCREAT`, `SOFTWARE`)
 */
export function runCreateCommand(argv: string[]): number {
  const parsed = parseCreateArgv(argv);
  if ("error" in parsed) {
    process.stderr.write(
      `create: ${parsed.error}\n` +
        `usage : nodefony create <${CREATE_TYPES.join("|")}> <name> [--dir <path>] [--force]\n`,
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
  try {
    const templates = path.join(findPackageRoot(), "templates", parsed.type);
    files = renderTemplates(templates, dest, {
      appName: parsed.name,
      nodefonyVersion: version,
    });
  } catch (e) {
    process.stderr.write(`create: ${(e as Error).message}\n`);
    return SysExit.SOFTWARE;
  }
  const relDest = path.relative(process.cwd(), dest) || ".";
  process.stdout.write(
    `✔ ${parsed.type} « ${parsed.name} » généré dans ${relDest}/\n\n` +
      files.map((f) => `  ${f}`).join("\n") +
      `\n\nProchaines étapes :\n` +
      `  cd ${relDest}\n` +
      `  npm install\n` +
      `  npm run dev        # → http://127.0.0.1:5151/api/hello\n`,
  );
  return SysExit.OK;
}
