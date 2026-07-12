import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";
import {
  getScaffoldSpec,
  type IScaffoldTypeSpec,
  type TFrontendChoice,
  type TPresetChoice,
} from "./spec";

/**
 * Moteur de scaffold — PUR : réponses validées → fichiers écrits. Aucune I/O
 * terminal, aucun kernel : le même moteur sert le CLI rapide (argv), le CLI
 * interactif (readline) et Studio (endpoint data plane). Rendu par **eta**
 * (dep runtime du core) : les choix (preset × frontend) exigent des
 * conditionnels dans `package.json`/`nodefony.config.ts` — des overlays de
 * fichiers entiers n'auraient pas tenu deux axes croisés.
 */

/** Réponses d'un scaffold, complétées et validées contre la spec. */
export type TScaffoldAnswers = Record<string, string | boolean>;

/** Capacités d'environnement évaluées par le front (cf `IScaffoldQuestion.askIf`). */
export interface IScaffoldCaps {
  hasCheckout: boolean;
}

export interface IScaffoldRequest {
  type: string;
  answers: TScaffoldAnswers;
  /** Dossier cible complet (défaut : `./<name>` relatif au cwd de l'appelant). */
  dir: string;
  force: boolean;
}

export interface IScaffoldResult {
  dest: string;
  /** Chemins relatifs écrits (triés). */
  files: string[];
  /** Paquets nodefony câblés en `file:` (mode link). */
  linked: string[];
}

/** Fichiers dont le nom rendu diffère du template (npm strip les dotfiles publiés). */
const RENAMES: Record<string, string> = { gitignore: ".gitignore" };

/** Paramètres frontend par framework (type registerEntry, entry, nœud de montage). */
export const FRONTEND_PARAMS: Record<
  Exclude<TFrontendChoice, "none">,
  { type: string; entry: string; mountNode: string }
> = {
  react: {
    type: "react19",
    entry: "./frontend/src/main.tsx",
    mountNode: '<div id="root"></div>',
  },
  vue: {
    type: "vue3",
    entry: "./frontend/src/main.ts",
    mountNode: '<div id="app"></div>',
  },
  angular: {
    type: "angular",
    entry: "./frontend/src/main.ts",
    mountNode: "<app-root></app-root>",
  },
};

/**
 * Racine du paquet `nodefony` contenant `templates/` — remontée depuis CE fichier
 * (source `src/cli/scaffold/`, bundle `dist/node/cli/scaffold/` : la remontée
 * marche pour les deux sans dépendre de la profondeur).
 */
export function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 7; i++) {
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
 * Workspaces nodefony d'un CHECKOUT du repo (`src/nodefony` + `src/packages/@nodefony/*`),
 * résolus depuis la racine du paquet `nodefony`. Un paquet INSTALLÉ (node_modules)
 * n'a pas ce voisinage → `null` (le mode link n'a de sens que sur un checkout).
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
 * Mode link : réécrit dans le `package.json` GÉNÉRÉ toute dep `nodefony` /
 * `@nodefony/*` en `file:<workspace>` — `npm install` symlinke le checkout local
 * et installe ses deps transitives. Rend l'app contrôlable AVANT toute release
 * npm (dev du framework) ; les deps publiques (zod, react…) restent au registre.
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
        throw new Error(`link : workspace introuvable pour ${name}`);
      }
      deps[name] = `file:${workspace}`;
      linked.push(name);
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return linked.sort();
}

/**
 * Complète et VALIDE des réponses partielles contre la spec d'un type : défauts
 * appliqués, patterns vérifiés, choix contraints à leur liste. Le contexte des
 * templates est donc complet PAR CONSTRUCTION (eta ne rend jamais un `undefined`
 * silencieux). Les questions `askIf` non satisfaites sont forcées à `false`.
 *
 * @throws Error si une valeur viole la spec (message = libellé + attendu)
 */
export function resolveAnswers(
  spec: IScaffoldTypeSpec,
  partial: TScaffoldAnswers,
  caps: IScaffoldCaps,
): TScaffoldAnswers {
  const answers: TScaffoldAnswers = {};
  for (const q of spec.questions) {
    let value = partial[q.key];
    if (q.askIf === "hasCheckout" && !caps.hasCheckout) {
      value = false;
    }
    if (value === undefined) {
      value = q.default;
    }
    if (q.type === "boolean") {
      answers[q.key] = value === true || value === "true";
      continue;
    }
    const str = String(value);
    if (q.type === "choice") {
      if (!q.choices?.some((c) => c.value === str)) {
        const allowed = q.choices?.map((c) => c.value).join(" | ") ?? "";
        throw new Error(`${q.key} invalide « ${str} » — attendu : ${allowed}`);
      }
    }
    if (q.pattern && !new RegExp(q.pattern, "u").test(str)) {
      throw new Error(
        `${q.key} invalide « ${str} » — ${q.patternHint ?? q.pattern}`,
      );
    }
    answers[q.key] = str;
  }
  return answers;
}

/** Rend un layer de templates (`*.tpl`) dans `destDir` via eta. */
function renderLayer(
  eta: Eta,
  srcDir: string,
  destDir: string,
  data: Record<string, unknown>,
  written: string[],
): void {
  const entries = readdirSync(srcDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tpl")) {
      continue;
    }
    const abs = path.join(entry.parentPath, entry.name);
    const relDir = path.relative(srcDir, entry.parentPath);
    const base = entry.name.replace(/\.tpl$/u, "");
    const rel = path.join(relDir, RENAMES[base] ?? base);
    const rendered = eta.renderString(readFileSync(abs, "utf8"), data);
    // Garantie zéro résidu : un tag eta non fermé/écrit à la main qui survit au
    // rendu = template cassé, on refuse d'écrire un projet corrompu.
    if (rendered.includes("<%")) {
      throw new Error(`tag eta résiduel dans ${rel}`);
    }
    const target = path.join(destDir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, rendered);
    written.push(rel);
  }
}

/**
 * Exécute un scaffold : layers de templates (`base/` commun, puis overlay du
 * preset, puis overlay du framework front) rendus avec le MÊME contexte eta.
 *
 * @returns fichiers écrits + paquets liés — l'appelant décide du rendu (CLI ou JSON)
 * @throws Error si réponses invalides, dossier non vide sans force, ou template cassé
 */
export function runScaffold(
  request: IScaffoldRequest,
  version: string,
): IScaffoldResult {
  const [spec] = getScaffoldSpec(request.type);
  if (!spec) {
    throw new Error(`type de scaffold inconnu : ${request.type}`);
  }
  const packageRoot = findPackageRoot();
  const workspaces = resolveLocalWorkspaces(packageRoot);
  const answers = resolveAnswers(spec, request.answers, {
    hasCheckout: workspaces !== null,
  });
  const dest = path.resolve(request.dir);
  if (existsSync(dest) && readdirSync(dest).length > 0 && !request.force) {
    throw new Error(
      `le dossier ${dest} existe et n'est pas vide (--force pour écraser)`,
    );
  }
  const preset = answers.preset as TPresetChoice;
  const frontend = answers.frontend as TFrontendChoice;
  const front = frontend !== "none" ? FRONTEND_PARAMS[frontend] : null;
  const data = {
    appName: answers.name,
    nodefonyVersion: version,
    preset,
    complete: preset === "complete",
    frontend,
    front,
  };
  // autoEscape false : on génère du CODE, pas du HTML — l'échappement des
  // entités corromprait chaque fichier. useWith false = accès via `it.` strict.
  const eta = new Eta({ useWith: false, varName: "it", autoEscape: false });
  const templates = path.join(packageRoot, "templates", request.type);
  const written: string[] = [];
  renderLayer(eta, path.join(templates, "base"), dest, data, written);
  if (preset === "complete") {
    renderLayer(eta, path.join(templates, "complete"), dest, data, written);
  }
  if (front) {
    // `shared/` = ce qui est commun aux 3 frameworks (controller HTML+CSP) ;
    // le layer du framework n'apporte que son entry/App.
    renderLayer(
      eta,
      path.join(templates, "frontend", "shared"),
      dest,
      data,
      written,
    );
    renderLayer(
      eta,
      path.join(templates, "frontend", frontend),
      dest,
      data,
      written,
    );
  }
  let linked: string[] = [];
  if (answers.link === true) {
    if (!workspaces) {
      throw new Error(
        "link exige un CHECKOUT de nodefony-core (paquet installé détecté) — " +
          "sans checkout, attends la release npm puis installe sans --link",
      );
    }
    linked = linkLocalDeps(dest, workspaces);
  }
  return { dest, files: written.sort(), linked };
}
