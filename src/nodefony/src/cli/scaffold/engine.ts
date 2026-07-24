import { existsSync, readdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";
import { findProjectRoot } from "../projectRoot";
import {
  parseEntityFields,
  buildEntityCodegen,
  ENTITY_DIALECTS,
  ENTITY_ID_KINDS,
  type TEntityDialect,
  type TEntityIdKind,
} from "./entityFields";
import { pick, SCAFFOLD_VERSIONS } from "./versions";
import { ScaffoldWriter, type IScaffoldChange } from "./writer";
import {
  getScaffoldSpec,
  CONTROLLER_KIND_CHOICES,
  type IScaffoldTypeSpec,
  type TControllerKindChoice,
  type TFrontendChoice,
  type TModuleControllerChoice,
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
  /** Points d'entrée utiles du scaffold (routes, canaux…) — affichés tels quels. */
  notes?: string[];
  /**
   * Écritures PRÉVUES, avec l'ancien contenu quand il y en a un — présent
   * uniquement en dry-run (rien n'a touché le disque).
   */
  changes?: IScaffoldChange[];
}

/** Options d'exécution d'un scaffold (cf {@link runScaffold}). */
export interface IScaffoldRunOptions {
  /**
   * Ne rien écrire : le scaffold se déroule entièrement (gardes comprises) et
   * rend son plan dans `result.changes`. Un refus reste un refus — c'est le but,
   * une simulation qui ne validerait pas ne servirait à rien.
   */
  dryRun?: boolean;
  /**
   * Transaction déjà ouverte par un scaffold APPELANT (`create module` délègue
   * à `controller`/`front`). Le sous-scaffold y écrit sans committer : la
   * décision de vider sur disque appartient au scaffold racine, sinon la
   * transaction serait coupée en morceaux et le refus tardif d'une étape
   * laisserait les précédentes écrites.
   */
  writer?: ScaffoldWriter;
}

/** Fichiers dont le nom rendu diffère du template (npm strip les dotfiles publiés). */
const RENAMES: Record<string, string> = {
  gitignore: ".gitignore",
  env: ".env",
  "env.local": ".env.local",
};

/**
 * Paramètres frontend par framework — type registerEntry, entry, nœud de
 * montage, ET les dépendances npm (SOURCE UNIQUE : consommée par le
 * `package.json.tpl` de `create app` ET par `create front` qui les ajoute au
 * package.json d'une cible existante — une version ne vit qu'ici).
 */
export const FRONTEND_PARAMS: Record<
  Exclude<TFrontendChoice, "none">,
  {
    type: string;
    entry: string;
    mountNode: string;
    deps: Record<string, string>;
    devDeps: Record<string, string>;
  }
> = {
  react: {
    type: "react19",
    entry: "./frontend/src/main.tsx",
    mountNode: '<div id="root"></div>',
    deps: pick("react", "react-dom"),
    devDeps: pick(
      "vite",
      "@vitejs/plugin-react",
      "@types/react",
      "@types/react-dom",
    ),
  },
  vue: {
    type: "vue3",
    entry: "./frontend/src/main.ts",
    mountNode: '<div id="app"></div>',
    deps: pick("vue"),
    devDeps: pick("vite", "@vitejs/plugin-vue"),
  },
  angular: {
    type: "angular",
    entry: "./frontend/src/main.ts",
    mountNode: "<app-root></app-root>",
    deps: pick("@angular/core", "@angular/common", "@angular/platform-browser"),
    devDeps: pick(
      "vite",
      "@analogjs/vite-plugin-angular",
      "@angular/build",
      "@angular/compiler-cli",
    ),
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
  writer: ScaffoldWriter,
): string[] {
  const manifestPath = path.join(destDir, "package.json");
  const manifest = JSON.parse(writer.read(manifestPath)) as Record<
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
  writer.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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

/**
 * Rend un layer de templates (`*.tpl`) dans `destDir` via eta. Les noms de
 * fichiers peuvent porter des TOKENS (`__NAME__Controller.ts.tpl`) remplacés
 * par `tokens` — un template ne peut pas mettre de tag eta dans un nom de
 * fichier, le token est l'équivalent côté chemin.
 */
function renderLayer(
  eta: Eta,
  srcDir: string,
  destDir: string,
  data: Record<string, unknown>,
  written: string[],
  writer: ScaffoldWriter,
  tokens?: Record<string, string>,
): void {
  const entries = readdirSync(srcDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tpl")) {
      continue;
    }
    const abs = path.join(entry.parentPath, entry.name);
    const relDir = path.relative(srcDir, entry.parentPath);
    const base = entry.name.replace(/\.tpl$/u, "");
    let rel = path.join(relDir, RENAMES[base] ?? base);
    for (const [token, value] of Object.entries(tokens ?? {})) {
      rel = rel.replaceAll(token, value);
    }
    const rendered = eta.renderString(readFileSync(abs, "utf8"), data);
    // Garantie zéro résidu : un tag eta non fermé/écrit à la main qui survit au
    // rendu = template cassé, on refuse d'écrire un projet corrompu.
    if (rendered.includes("<%")) {
      throw new Error(`tag eta résiduel dans ${rel}`);
    }
    writer.write(path.join(destDir, rel), rendered);
    written.push(rel);
  }
}

/**
 * Racine du PROJET Nodefony courant — cible des scaffolds IN-PROJECT (controller,
 * module, entity), par opposition à `create app` qui crée un dossier neuf.
 *
 * Ré-export : la définition vit dans `../projectRoot` (module sans dépendance),
 * partagée avec le lanceur `bin/nodefony` qui s'en sert pour déléguer au CLI de
 * l'app. Une seule définition de « où commence l'app ».
 */
export { findProjectRoot };

/** Cible d'un scaffold in-project : l'app racine ou un module du projet. */
export interface IScaffoldTarget {
  kind: "app" | "module";
  /** Nom affichable (package.json `name`). */
  name: string;
  /** Dossier du code (contient `index.ts` + `nodefony/`). */
  dir: string;
}

/**
 * Cibles de scaffold du projet : l'app racine + les modules locaux
 * (`modules/<x>/` portant `package.json` + `index.ts` — le layout produit par
 * `create module`). Consommée par le CLI (validation `--module`) et par le
 * futur formulaire Studio (liste de choix dynamique par projet).
 */
/**
 * Capacités de l'environnement, telles que le MOTEUR les voit.
 *
 * Sert aux questions conditionnelles (`askIf`) : `link` (créer une app branchée sur le
 * checkout local du framework, au lieu des paquets npm publiés) n'a de sens que si un
 * checkout est résolvable. Un front ne peut PAS le deviner — seul le serveur sait ce
 * qu'il y a sur le disque. Le figer côté client à `false` reviendrait à supprimer
 * l'option en silence.
 *
 * @returns les capacités passées à {@link resolveAnswers}.
 */
export function scaffoldCaps(): IScaffoldCaps {
  return { hasCheckout: resolveLocalWorkspaces(findPackageRoot()) !== null };
}

export function listTargets(
  projectRoot: string,
  writer: ScaffoldWriter = new ScaffoldWriter(),
): IScaffoldTarget[] {
  const readName = (dir: string): string | null => {
    try {
      const pkg = JSON.parse(writer.read(path.join(dir, "package.json"))) as {
        name?: string;
      };
      return pkg.name ?? null;
    } catch {
      return null;
    }
  };
  const targets: IScaffoldTarget[] = [
    {
      kind: "app",
      name: readName(projectRoot) ?? path.basename(projectRoot),
      dir: projectRoot,
    },
  ];
  const modulesDir = path.join(projectRoot, "modules");
  if (writer.exists(modulesDir)) {
    for (const entry of writer.listDir(modulesDir)) {
      const dir = path.join(modulesDir, entry.name);
      if (!entry.isDirectory || !writer.exists(path.join(dir, "index.ts"))) {
        continue;
      }
      targets.push({
        kind: "module",
        name: readName(dir) ?? entry.name,
        dir,
      });
    }
  }
  return targets;
}

/** `blog-post` / `BlogPost` / `blogPost` → `BlogPost`. */
export function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

/** `BlogPost` / `blog_post` → `blog-post`. */
export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();
}

/**
 * Câble une classe générée dans le décorateur-liste de l'`index.ts` cible
 * (`@controllers([...])`, `@entities([...])`) : ajoute l'import après le
 * dernier import existant + insère le nom dans le tableau du décorateur.
 * Édition TEXTUELLE gardée — toute ambiguïté = throw actionnable, jamais un
 * fichier corrompu (le fichier n'est écrit que si les DEUX insertions tiennent).
 *
 * @throws si la classe y est déjà, si aucun import n'ancre l'insertion, ou si
 *   le décorateur est introuvable (le message donne l'édition manuelle exacte).
 */
export function wireDecoratorList(
  indexPath: string,
  decorator: "controllers" | "entities",
  className: string,
  importPath: string,
  writer: ScaffoldWriter,
): void {
  const source = writer.read(indexPath);
  if (new RegExp(`\\b${className}\\b`, "u").test(source)) {
    throw new Error(
      `${className} est déjà référencé dans ${indexPath} — choisis un autre nom`,
    );
  }
  const importLine = `import ${className} from "${importPath}";`;
  const imports = [...source.matchAll(/^import [^\n]*$/gmu)];
  const last = imports.at(-1);
  if (!last || last.index === undefined) {
    throw new Error(
      `aucun import trouvé dans ${indexPath} — ajoute à la main :\n` +
        `  ${importLine}\n  @${decorator}([..., ${className}])`,
    );
  }
  const importAt = last.index + last[0].length;
  const withImport =
    source.slice(0, importAt) + `\n${importLine}` + source.slice(importAt);
  const decoRe = new RegExp(`@${decorator}\\(\\[([^\\]]*)\\]\\)`, "u");
  const match = decoRe.exec(withImport);
  if (!match || match.index === undefined) {
    throw new Error(
      `@${decorator}([...]) introuvable dans ${indexPath} — ajoute à la main :\n` +
        `  ${importLine}\n  @${decorator}([${className}]) sur la classe Module`,
    );
  }
  const list = match[1].trim();
  const wired = withImport.replace(
    decoRe,
    `@${decorator}([${list ? `${list.replace(/,\s*$/u, "")}, ` : ""}${className}])`,
  );
  writer.write(indexPath, wired);
}

/**
 * Exécute un scaffold — point d'entrée UNIQUE des trois fronts (CLI rapide,
 * CLI interactif, Studio), dispatché par type :
 *  - `app` : projet NEUF dans `request.dir` (layers base/preset/frontend) ;
 *  - `controller` : IN-PROJECT — `request.dir` est le point de départ de la
 *    détection de racine (cwd de l'appelant), la cible réelle vient de
 *    `answers.module` (vide = app racine).
 *
 * Toutes les écritures passent par une TRANSACTION ({@link ScaffoldWriter}) que
 * seul le scaffold RACINE vide sur disque, une fois toutes les étapes passées :
 * un refus, même tardif, ne laisse donc jamais de projet à moitié modifié. Et
 * comme la simulation n'est que « la même exécution sans vidage », `dryRun`
 * décrit exactement ce qui se passerait — pas ce qu'un second code de
 * prévision croirait.
 *
 * @returns fichiers écrits + paquets liés — l'appelant décide du rendu (CLI ou JSON)
 * @throws Error si réponses invalides, dossier non vide sans force, ou template cassé
 */
export function runScaffold(
  request: IScaffoldRequest,
  version: string,
  options: IScaffoldRunOptions = {},
): IScaffoldResult {
  // Transaction du scaffold RACINE (`options.writer` absent) : c'est lui qui
  // commit. Un sous-scaffold hérite de celle de son appelant.
  const writer = options.writer ?? new ScaffoldWriter();
  const result = dispatchScaffold(request, version, writer);
  if (options.writer) {
    return result;
  }
  if (options.dryRun) {
    return { ...result, changes: writer.changes() };
  }
  writer.commit();
  return result;
}

/** Résout la spec puis route vers le scaffold du type demandé. */
function dispatchScaffold(
  request: IScaffoldRequest,
  version: string,
  writer: ScaffoldWriter,
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
  if (request.type === "module") {
    return runModuleScaffold(request, answers, packageRoot, version, writer);
  }
  if (request.type === "controller") {
    return runControllerScaffold(request, answers, packageRoot, writer);
  }
  if (request.type === "front") {
    return runFrontScaffold(request, answers, packageRoot, writer);
  }
  if (request.type === "entity") {
    return runEntityScaffold(request, answers, packageRoot, writer);
  }
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
    // Catalogue de versions tierces (source unique — cf versions.ts).
    pkg: SCAFFOLD_VERSIONS,
    preset,
    complete: preset === "complete",
    frontend,
    front,
    // Secrets PAR-PROJET, générés À LA CRÉATION (jamais au build : un build
    // doit rester pur/reproductible — en CI/prod les secrets viennent du
    // secret-manager). Consommés par `complete/env.local.tpl` (gitignoré) →
    // zéro warning « clé ÉPHÉMÈRE » au premier boot. 32 octets = AES-256-GCM.
    secrets: {
      NF_TOTP_KEY: randomBytes(32).toString("base64"),
      NF_WEBHOOK_KEY: randomBytes(32).toString("base64"),
      NF_CSRF_SECRET: randomBytes(32).toString("base64"),
    },
  };
  // autoEscape false : on génère du CODE, pas du HTML — l'échappement des
  // entités corromprait chaque fichier. useWith false = accès via `it.` strict.
  const eta = new Eta({ useWith: false, varName: "it", autoEscape: false });
  const templates = path.join(packageRoot, "templates", request.type);
  const written: string[] = [];
  renderLayer(eta, path.join(templates, "base"), dest, data, written, writer);
  if (preset === "complete") {
    renderLayer(
      eta,
      path.join(templates, "complete"),
      dest,
      data,
      written,
      writer,
    );
  }
  if (front) {
    // Coquille HTML commune à TOUS les scaffolds à front (`create app` ET
    // `create front`) — une seule source, zéro dérive entre les commandes.
    renderLayer(
      eta,
      path.join(packageRoot, "templates", "shared", "front-shell"),
      dest,
      data,
      written,
      writer,
    );
    // `shared/` = ce qui est commun aux 3 frameworks (controller HTML+CSP) ;
    // le layer du framework n'apporte que son entry/App.
    renderLayer(
      eta,
      path.join(templates, "frontend", "shared"),
      dest,
      data,
      written,
      writer,
    );
    renderLayer(
      eta,
      path.join(templates, "frontend", frontend),
      dest,
      data,
      written,
      writer,
    );
    // Briques par-framework partagées avec `create front` (source unique).
    if (frontend === "angular") {
      renderLayer(
        eta,
        path.join(packageRoot, "templates", "shared", "ng-app-tsconfig"),
        dest,
        data,
        written,
        writer,
      );
    }
    if (frontend === "vue") {
      renderLayer(
        eta,
        path.join(packageRoot, "templates", "shared", "vue-shim"),
        dest,
        data,
        written,
        writer,
      );
    }
  }
  let linked: string[] = [];
  if (answers.link === true) {
    if (!workspaces) {
      throw new Error(
        "link exige un CHECKOUT de nodefony-core (paquet installé détecté) — " +
          "sans checkout, attends la release npm puis installe sans --link",
      );
    }
    linked = linkLocalDeps(dest, workspaces, writer);
  }
  return { dest, files: written.sort(), linked };
}

/**
 * Déclare `modules/*` en workspaces npm de l'app et branche les scripts sur eux.
 *
 * POURQUOI c'est indispensable : le Kernel charge un module par son NOM
 * (`import("@app/blog")`, cf `Kernel.loadModule`) — pas par un chemin. Sans le
 * symlink que npm pose pour un workspace, le boot échoue sur « Cannot find
 * package ». Les scripts sont chaînés dans la foulée, sinon le module ne serait
 * ni construit (le bundler de l'app ne regarde que `index.ts` + `nodefony/**`),
 * ni typé, ni testé : du code mort au premier jour.
 *
 * Idempotent — relancé pour le 2ᵉ module, il ne touche plus à rien.
 *
 * @returns true si le `package.json` de l'app a été modifié.
 */
export function ensureWorkspaces(
  projectRoot: string,
  writer: ScaffoldWriter,
): boolean {
  const manifestPath = path.join(projectRoot, "package.json");
  const manifest = JSON.parse(writer.read(manifestPath)) as {
    workspaces?: string[];
    scripts?: Record<string, string>;
  };
  let changed = false;
  const workspaces = manifest.workspaces ?? [];
  if (!workspaces.includes("modules/*")) {
    manifest.workspaces = [...workspaces, "modules/*"];
    changed = true;
  }
  const scripts = (manifest.scripts ??= {});
  // Chaînage des scripts de l'app vers ses workspaces. `--if-present` : un module
  // sans script `test` ne casse pas la commande de l'app.
  const CHAIN: Record<string, "before" | "after"> = {
    build: "before", // les modules d'abord : l'app peut dépendre de leur dist
    typecheck: "after",
    test: "after",
  };
  for (const [name, when] of Object.entries(CHAIN)) {
    const script = scripts[name];
    if (!script || script.includes("--workspaces")) {
      continue;
    }
    const delegated = `npm run ${name} --workspaces --if-present`;
    scripts[name] =
      when === "before"
        ? `${delegated} && ${script}`
        : `${script} && ${delegated}`;
    changed = true;
  }
  if (changed) {
    writer.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return changed;
}

/**
 * Ajoute le module au manifeste `modules` de `nodefony.config.ts` — c'est CE
 * tableau qui décide de ce qui se charge, et dans quel ordre. Un module local
 * vient à la fin : le socle (http, framework, security…) doit être debout avant.
 *
 * Édition textuelle GARDÉE (même doctrine que `wireDecoratorList`) : on n'écrit
 * que si l'ancre est trouvée sans ambiguïté, sinon on rend une note actionnable —
 * jamais un `nodefony.config.ts` corrompu, qui empêcherait l'app de booter.
 *
 * @returns note à afficher si un geste manuel reste nécessaire, sinon `null`.
 */
export function wireModuleManifest(
  configPath: string,
  pkgName: string,
  writer: ScaffoldWriter,
): string | null {
  const manual = `ajoute à la main dans le manifeste modules de nodefony.config.ts :\n  use("${pkgName}", {}),`;
  if (!writer.exists(configPath)) {
    return manual;
  }
  const source = writer.read(configPath);
  if (source.includes(`"${pkgName}"`)) {
    return null; // déjà câblé (rejeu de la commande) — rien à faire.
  }
  const anchor = /modules\s*:\s*\[/u.exec(source);
  if (!anchor || anchor.index === undefined) {
    return manual;
  }
  // Crochet fermant APPARIÉ du tableau (les configs colocalisées imbriquent des
  // tableaux : `trustedHosts: ["localhost"]`) — un simple `indexOf("]")` couperait
  // au premier sous-tableau.
  let depth = 0;
  let close = -1;
  for (let i = anchor.index + anchor[0].length - 1; i < source.length; i++) {
    const char = source[i];
    if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) {
    return manual;
  }
  // `use()` importé → forme typée (auto-complétion de la config du module) ;
  // sinon string nue, qui reste une entrée valide du manifeste.
  const hasUse = /import\s*\{[^}]*\buse\b[^}]*\}\s*from\s*"nodefony"/u.test(
    source,
  );
  const entry = hasUse ? `  use("${pkgName}", {}),\n` : `  "${pkgName}",\n`;
  const line =
    `\n  // Module local du projet (modules/) — créé par \`nodefony create module\`.\n` +
    entry;
  writer.write(configPath, source.slice(0, close) + line + source.slice(close));
  return null;
}

/**
 * Scaffold IN-PROJECT d'un module applicatif : un WORKSPACE npm sous
 * `modules/<nom>/` (package.json + build rolldown + config Zod + tests + docs),
 * déclaré dans les workspaces de l'app et dans le manifeste `modules`.
 *
 * Ce scaffold pose la COQUILLE et rien d'autre : le controller et le frontend
 * éventuels sont rendus par les scaffolds `controller` et `front` EXISTANTS,
 * ciblés sur le module fraîchement créé. Aucun template n'est dupliqué — la
 * commande qui sait poser un controller reste la seule à savoir le faire.
 *
 * @throws hors projet, module déjà présent (sans `--force`), nom en collision,
 *   ou brique manquante dans l'app (realtime/frontend) — avec le geste exact.
 */
function runModuleScaffold(
  request: IScaffoldRequest,
  answers: TScaffoldAnswers,
  packageRoot: string,
  version: string,
  writer: ScaffoldWriter,
): IScaffoldResult {
  const projectRoot = findProjectRoot(request.dir);
  if (!projectRoot) {
    throw new Error(
      "aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant) — " +
        "lance la commande depuis une app (créée par `nodefony create app`)",
    );
  }
  const name = toKebabCase(String(answers.name));
  const dest = path.join(projectRoot, "modules", name);
  if (
    writer.exists(dest) &&
    writer.listDir(dest).length > 0 &&
    !request.force
  ) {
    throw new Error(
      `le module ${name} existe déjà (modules/${name}) — choisis un autre nom, ou --force`,
    );
  }
  const appManifestPath = path.join(projectRoot, "package.json");
  const appManifest = JSON.parse(writer.read(appManifestPath)) as {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const appName = appManifest.name ?? path.basename(projectRoot);
  // Scope npm dérivé de l'app : `mon-app` → `@mon-app/blog`. Un module naît donc
  // paquet npm — le jour où il doit être publié ou partagé, il n'y a rien à refaire.
  const scope = appName.replace(/^@/u, "").replaceAll("/", "-");
  const pkgName = `@${scope}/${name}`;
  const appDeps = new Set([
    ...Object.keys(appManifest.dependencies ?? {}),
    ...Object.keys(appManifest.devDependencies ?? {}),
  ]);
  const controller = String(answers.controller) as TModuleControllerChoice;
  const frontend = answers.frontend as TFrontendChoice;
  // Gardes AVANT le premier fichier écrit : une brique absente de l'app ne peut
  // pas être « ajoutée » au module seul (le paquet ne serait pas installé).
  if (
    (controller === "realtime" || controller === "duplex") &&
    !appDeps.has("@nodefony/realtime")
  ) {
    throw new Error(
      `le controller ${controller} exige @nodefony/realtime, absent de l'app — ` +
        `ajoute la dep + use("@nodefony/realtime") au manifeste, ou --controller hello`,
    );
  }
  if (frontend !== "none" && !appDeps.has("@nodefony/frontend")) {
    throw new Error(
      `un frontend exige @nodefony/frontend, absent de l'app — ajoute la dep + ` +
        `"@nodefony/frontend" au manifeste, ou --frontend none`,
    );
  }
  const pascal = toPascalCase(name);
  const data = {
    name,
    pkgName,
    appName,
    pascal,
    camel: pascal[0].toLowerCase() + pascal.slice(1),
    upper: name.replaceAll("-", "_").toUpperCase(),
    description: String(answers.description) || `Module ${name} de ${appName}`,
    nodefonyVersion: version,
    pkg: SCAFFOLD_VERSIONS,
    service: answers.service === true,
    command: answers.command === true,
    needsRealtime: controller === "realtime" || controller === "duplex",
    frontend,
    front: frontend !== "none" ? FRONTEND_PARAMS[frontend] : null,
  };
  const eta = new Eta({ useWith: false, varName: "it", autoEscape: false });
  const templates = path.join(packageRoot, "templates", "module");
  const tokens = { __PASCAL__: pascal, __KEBAB__: name };
  const written: string[] = [];
  renderLayer(
    eta,
    path.join(templates, "base"),
    dest,
    data,
    written,
    writer,
    tokens,
  );
  if (data.service) {
    renderLayer(
      eta,
      path.join(templates, "service"),
      dest,
      data,
      written,
      writer,
      tokens,
    );
  }
  if (data.command) {
    renderLayer(
      eta,
      path.join(templates, "command"),
      dest,
      data,
      written,
      writer,
      tokens,
    );
  }
  // Docs IA (CLAUDE.md/MEMORY.md) : seulement si le projet en tient déjà — dans
  // une app qui n'en a pas, ce seraient deux fichiers morts.
  if (writer.exists(path.join(projectRoot, "CLAUDE.md"))) {
    renderLayer(
      eta,
      path.join(templates, "ai"),
      dest,
      data,
      written,
      writer,
      tokens,
    );
  }
  const notes: string[] = [];
  // Le module existe sur le disque → il est désormais une CIBLE (`listTargets`) :
  // les scaffolds controller/front peuvent le viser, sans un template dupliqué.
  if (controller !== "none") {
    const sub = runScaffold(
      {
        type: "controller",
        answers: { name, kind: controller, route: "", module: pkgName },
        dir: projectRoot,
        force: request.force,
      },
      version,
      { writer },
    );
    written.push(...sub.files);
    notes.push(...(sub.notes ?? []));
  }
  if (frontend !== "none") {
    const sub = runScaffold(
      {
        type: "front",
        answers: { name, frontend, route: "", module: pkgName },
        dir: projectRoot,
        force: request.force,
      },
      version,
      { writer },
    );
    written.push(...sub.files);
    notes.push(...(sub.notes ?? []));
  }
  if (ensureWorkspaces(projectRoot, writer)) {
    notes.push(
      "package.json de l'app : workspaces modules/* + scripts build/typecheck/test chaînés",
    );
  }
  const manifestNote = wireModuleManifest(
    path.join(projectRoot, "nodefony.config.ts"),
    pkgName,
    writer,
  );
  notes.push(
    manifestNote ??
      `nodefony.config.ts : use("${pkgName}", {}) ajouté au manifeste modules`,
  );
  return { dest, files: written.sort(), linked: [], notes };
}

/**
 * Scaffold IN-PROJECT d'un controller : résout la cible (app racine ou module),
 * rend le template de la saveur (`hello`/`rest`/`duplex`/`realtime`/`example`)
 * dans `<cible>/nodefony/controllers/` puis câble la classe dans le
 * `@controllers([...])` de l'`index.ts` cible.
 *
 * @throws hors projet, cible inconnue (le message liste les cibles), saveur
 *   realtime/duplex sans dep `@nodefony/realtime`, ou wiring impossible
 *   (actionnable).
 */
function runControllerScaffold(
  request: IScaffoldRequest,
  answers: TScaffoldAnswers,
  packageRoot: string,
  writer: ScaffoldWriter,
): IScaffoldResult {
  const projectRoot = findProjectRoot(request.dir);
  if (!projectRoot) {
    throw new Error(
      "aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant) — " +
        "lance la commande depuis une app (créée par `nodefony create app`)",
    );
  }
  const targets = listTargets(projectRoot, writer);
  const moduleName = String(answers.module ?? "");
  const target = moduleName
    ? targets.find((t) => t.kind === "module" && t.name === moduleName)
    : targets[0];
  if (!target) {
    const known = targets.map((t) => `${t.name} (${t.kind})`).join(" · ");
    throw new Error(
      `module « ${moduleName} » introuvable — cibles du projet : ${known}`,
    );
  }
  const kind = answers.kind as TControllerKindChoice;
  // Nom normalisé : suffixe Controller strippé s'il est déjà donné (évite
  // BlogControllerController), classe en PascalCase, route/canaux en kebab.
  const base = String(answers.name).replace(/[-_]?[Cc]ontroller$/u, "");
  const nameClass = `${toPascalCase(base)}Controller`;
  const kebab = toKebabCase(base);
  const route = String(answers.route) || `/api/${kebab}`;
  // Capacités de la CIBLE (deps de son package.json) : les templates dégradent
  // proprement — la vitrine example ne montre les gardes sécurité que si la brique
  // est là ; la saveur realtime, elle, n'a AUCUNE version dégradée → throw.
  const manifest = JSON.parse(
    writer.read(path.join(target.dir, "package.json")),
  ) as Record<string, Record<string, string>>;
  const targetDeps = new Set(
    ["dependencies", "devDependencies", "peerDependencies"].flatMap((b) =>
      Object.keys(manifest[b] ?? {}),
    ),
  );
  if (!CONTROLLER_KIND_CHOICES.includes(kind)) {
    throw new Error(
      `saveur « ${String(kind)} » inconnue — choix : ${CONTROLLER_KIND_CHOICES.join(" | ")}`,
    );
  }
  if (
    (kind === "realtime" || kind === "duplex") &&
    !targetDeps.has("@nodefony/realtime")
  ) {
    throw new Error(
      `la saveur ${kind} exige @nodefony/realtime dans ${target.name} — ` +
        `ajoute la dep + use("@nodefony/realtime") au manifeste, ou choisis --kind hello`,
    );
  }
  const eta = new Eta({ useWith: false, varName: "it", autoEscape: false });
  const written: string[] = [];
  const data = {
    nameClass,
    kebab,
    route,
    channel: kebab,
    hasSecurity: targetDeps.has("@nodefony/security"),
  };
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "controller", kind),
    target.dir,
    data,
    written,
    writer,
    { __NAME__: nameClass },
  );
  wireDecoratorList(
    path.join(target.dir, "index.ts"),
    "controllers",
    nameClass,
    `./nodefony/controllers/${nameClass}`,
    writer,
  );
  written.push("index.ts");
  const NOTES: Record<TControllerKindChoice, string[]> = {
    hello: [`GET  ${route}`, `WS   ${route}/echo`],
    rest: [`REST ${route} (GET/POST) · ${route}/{id} (GET/PUT/PATCH/DELETE)`],
    duplex: [
      `REST ${route} (GET/POST) · ${route}/{id} (GET/DELETE)`,
      `WS   ${route}/realtime (socket Nodefony — mêmes actions via socket.request/mutate)`,
    ],
    realtime: [
      `WS   ${route}/realtime (socket Nodefony — canal ${kebab}:ticker, action ${kebab}:ping)`,
    ],
    example: [
      `REST ${route} (vitrine décorateurs — voir les curl du TSDoc généré)`,
      `WS   ${route}/echo`,
    ],
  };
  return {
    dest: target.dir,
    files: written.sort(),
    linked: [],
    notes: NOTES[kind],
  };
}

/** Pluriel simple, suffisant pour un nom de table (`Post` → `posts`, `Story` → `stories`). */
function pluralize(word: string): string {
  if (/[^aeiou]y$/u.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/u.test(word)) return `${word}es`;
  return `${word}s`;
}

/** `BlogPost` → `blog_posts` — nom de table SQL. */
function tableName(pascal: string): string {
  return pluralize(toKebabCase(pascal)).replaceAll("-", "_");
}

/**
 * Dialecte SQL du connecteur visé, lu dans `nodefony.config.ts`.
 *
 * Lecture TEXTUELLE assumée (le fichier est du TypeScript : l'exécuter pour lire une
 * clé coûterait un boot). En cas de doute, on retombe sur `sqlite` — et le scaffold
 * ANNONCE le dialecte retenu, pour qu'une déduction fausse se voie tout de suite au
 * lieu de produire une table du mauvais moteur en silence.
 */
function detectDialect(
  projectRoot: string,
  writer: ScaffoldWriter,
): TEntityDialect {
  const configPath = path.join(projectRoot, "nodefony.config.ts");
  if (!writer.exists(configPath)) return "sqlite";
  const source = writer.read(configPath);
  const match = /dialect\s*:\s*["'](\w+)["']/u.exec(source);
  const found = match?.[1];
  return (ENTITY_DIALECTS as readonly string[]).includes(found ?? "")
    ? (found as TEntityDialect)
    : "sqlite";
}

/**
 * Scaffold IN-PROJECT d'une entité (`create entity`) : table Drizzle native, interface
 * de ligne, schémas Zod d'entrée, service CRUD, controller REST + WebSocket, tests.
 *
 * Câble la cible : `@entities([...])` (créé au besoin) et `@controllers([...])`.
 *
 * @throws hors projet · cible inconnue · aucun module ORM dans les dépendances ·
 *   entité déjà déclarée · champ mal formé.
 */
function runEntityScaffold(
  request: IScaffoldRequest,
  answers: TScaffoldAnswers,
  packageRoot: string,
  writer: ScaffoldWriter,
): IScaffoldResult {
  const projectRoot = findProjectRoot(request.dir);
  if (!projectRoot) {
    throw new Error(
      "aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant) — " +
        "lance la commande depuis une app (créée par `nodefony create app`)",
    );
  }
  const targets = listTargets(projectRoot, writer);
  const moduleName = String(answers.module ?? "");
  const target = moduleName
    ? targets.find((t) => t.kind === "module" && t.name === moduleName)
    : targets[0];
  if (!target) {
    const known = targets.map((t) => `${t.name} (${t.kind})`).join(" · ");
    throw new Error(
      `module « ${moduleName} » introuvable — cibles du projet : ${known}`,
    );
  }

  // Garde ORM : générer une entité sans ORM produirait du code mort qui ne compile même
  // pas. On refuse AVANT d'écrire, avec le geste exact.
  //
  // ⚠️ La brique se cherche dans l'APP, pas seulement dans la cible : un module est un
  // workspace de l'app et déclare les paquets Nodefony en `peerDependencies: "*"` —
  // c'est l'app qui les installe et qui charge le module ORM (manifeste `modules`).
  // Exiger la dep dans le module rendait `--module` inutilisable (vécu).
  const manifestPath = path.join(target.dir, "package.json");
  const manifest = JSON.parse(writer.read(manifestPath)) as Record<
    string,
    Record<string, string>
  >;
  const depsOf = (dir: string): Set<string> => {
    const file = path.join(dir, "package.json");
    if (!writer.exists(file)) return new Set();
    const pkg = JSON.parse(writer.read(file)) as Record<
      string,
      Record<string, string>
    >;
    return new Set(
      ["dependencies", "devDependencies", "peerDependencies"].flatMap((b) =>
        Object.keys(pkg[b] ?? {}),
      ),
    );
  };
  const targetDeps = depsOf(target.dir);
  const projectDeps = depsOf(projectRoot);
  if (
    !targetDeps.has("@nodefony/drizzle") &&
    !projectDeps.has("@nodefony/drizzle")
  ) {
    throw new Error(
      `@nodefony/drizzle absent de ${target.name} — ajoute la dep + use("@nodefony/drizzle") ` +
        `au manifeste modules de nodefony.config.ts, puis relance`,
    );
  }

  // `PostEntity` / `Post.ts` → `Post` (le suffixe donné n'est jamais redoublé).
  const base = String(answers.name).replace(/[-_]?[Ee]ntity$/u, "");
  const pascal = toPascalCase(base);
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  const kebab = toKebabCase(base);
  const table = tableName(pascal);

  const dialect =
    (String(answers.dialect || "") as TEntityDialect) ||
    detectDialect(projectRoot, writer);
  if (!(ENTITY_DIALECTS as readonly string[]).includes(dialect)) {
    throw new Error(
      `dialecte invalide « ${dialect} » — attendus : ${ENTITY_DIALECTS.join(" | ")}`,
    );
  }
  const id = String(answers.id) as TEntityIdKind;
  if (!(ENTITY_ID_KINDS as readonly string[]).includes(id)) {
    throw new Error(
      `--id invalide « ${id} » — attendus : ${ENTITY_ID_KINDS.join(" | ")}`,
    );
  }

  const fields = parseEntityFields(String(answers.fields ?? ""));
  const codegen = buildEntityCodegen(fields, {
    dialect,
    id,
    timestamps: answers.timestamps !== false,
    softDelete: answers.softDelete === true,
  });

  const route = String(answers.route) || `/api/${pluralize(kebab)}`;
  const connector = String(answers.connector || "default");

  // Exemple de charge utile — un exemple faux serait pire que pas d'exemple.
  // Deux formes, pour deux usages :
  //  - `curlBody` : JSON figé, collé dans le `curl` de la documentation ;
  //  - `sampleFactory` : fabrique paramétrée par un entier, utilisée par les tests.
  //    Elle est indispensable dès qu'un champ est UNIQUE : deux insertions du même
  //    échantillon violeraient la contrainte, et le test généré échouerait sur
  //    lui-même (vécu).
  const sample: Record<string, unknown> = {};
  const factory: string[] = [];
  for (const f of fields) {
    if (f.nullable) continue;
    const isNumber = f.type === "int" || f.type === "float";
    sample[f.name] = isNumber
      ? 1
      : f.type === "bool"
        ? true
        : f.type === "json"
          ? {}
          : f.type === "date"
            ? "2026-01-01T00:00:00.000Z"
            : `${f.name}-1`;
    factory.push(
      `${f.name}: ` +
        (isNumber
          ? "n"
          : f.type === "bool"
            ? "true"
            : f.type === "json"
              ? "{}"
              : f.type === "date"
                ? "new Date()"
                : `\`${f.name}-\${n}\``),
    );
  }

  const eta = new Eta({ useWith: false, varName: "it", autoEscape: false });
  const written: string[] = [];
  const data = {
    pascal,
    camel,
    kebab,
    table,
    route,
    connector,
    dialect,
    moduleName: target.kind === "app" ? "app" : String(target.name),
    curlBody: JSON.stringify(sample),
    sampleFactory: `{ ${factory.join(", ")} }`,
    ...codegen,
  };

  const templates = path.join(packageRoot, "templates", "entity");
  const tokens = { __PASCAL__: pascal, __KEBAB__: kebab };
  const service = answers.service !== false;
  const controller = service && answers.controller !== false;

  renderLayer(
    eta,
    path.join(templates, "base"),
    target.dir,
    data,
    written,
    writer,
    tokens,
  );
  if (service) {
    renderLayer(
      eta,
      path.join(templates, "service"),
      target.dir,
      data,
      written,
      writer,
      tokens,
    );
  }
  if (controller) {
    renderLayer(
      eta,
      path.join(templates, "controller"),
      target.dir,
      data,
      written,
      writer,
      tokens,
    );
  }
  if (answers.tests !== false) {
    renderLayer(
      eta,
      path.join(templates, "tests"),
      target.dir,
      data,
      written,
      writer,
      tokens,
    );
  }

  // Un MODULE déclare les briques Nodefony qu'il importe en `peerDependencies: "*"`
  // (l'app les installe — c'est le pattern posé par `create module`). Les fichiers
  // générés importent orm-core (defineEntity, service) et drizzle (tests) : sans ces
  // deux entrées, le module compilerait « par chance », via le hoisting de l'app.
  if (target.kind === "module") {
    const peer = (manifest["peerDependencies"] ??= {});
    let touched = false;
    for (const brick of ["@nodefony/orm-core", "@nodefony/drizzle"]) {
      if (!targetDeps.has(brick)) {
        peer[brick] = "*";
        touched = true;
      }
    }
    if (touched) {
      writer.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      written.push("package.json");
    }
  }

  const indexPath = path.join(target.dir, "index.ts");
  wireEntitiesDecorator(
    indexPath,
    `${pascal}Entity`,
    `./nodefony/entity/${pascal}`,
    writer,
  );
  if (controller) {
    wireDecoratorList(
      indexPath,
      "controllers",
      `${pascal}Controller`,
      `./nodefony/controllers/${pascal}Controller`,
      writer,
    );
  }
  written.push("index.ts");

  // Dire la vérité sur la base : le DDL dérivé du mode dev crée la table au boot, mais
  // ne la modifie JAMAIS ensuite, et aucune migration n'est produite.
  const notes = [
    `table ${table} (${dialect}) — créée au prochain boot en développement`,
    `⚠ modifier l'entité ensuite n'altère PAS la table (pas d'ALTER en dev) — supprime la base de dev, ou passe par une migration`,
    `⚠ production : aucune migration générée (orm:migrate n'existe pas encore)`,
  ];
  if (controller) {
    notes.push(
      `REST ${route} (GET/POST) · ${route}/{id} (GET/PUT/DELETE) — les lectures répondent AUSSI par la socket`,
    );
  }
  if (!service) {
    notes.push("service et controller non générés (--no-service)");
  } else if (!controller) {
    notes.push("controller non généré (--no-controller)");
  }

  return { dest: target.dir, files: written.sort(), linked: [], notes };
}

/**
 * Ajoute une entité au décorateur `@entities([...])` de la cible — **en le créant
 * s'il n'existe pas encore**.
 *
 * Différence avec `wireDecoratorList` : une app n'a aucune raison de porter un
 * `@entities([])` vide tant qu'elle n'a pas d'entité, et les apps déjà générées n'en
 * ont pas. Plutôt que d'exiger une ancre (throw) ou de l'imposer à tous les templates,
 * on **pose le décorateur au premier usage**, juste au-dessus de `@controllers` (ou de
 * la déclaration de classe s'il n'y en a pas).
 *
 * Édition textuelle conservatrice : toute ambiguïté fait échouer avec un geste à
 * appliquer à la main, plutôt que de corrompre le fichier.
 *
 * @param indexPath - `index.ts` de la cible.
 * @param className - nom du descripteur (`PostEntity`).
 * @param importPath - chemin relatif du descripteur.
 * @throws si l'entité est déjà référencée, ou si aucun point d'insertion n'est trouvé.
 */
export function wireEntitiesDecorator(
  indexPath: string,
  className: string,
  importPath: string,
  writer: ScaffoldWriter,
): void {
  const source = writer.read(indexPath);
  if (new RegExp(`\\b${className}\\b`, "u").test(source)) {
    throw new Error(
      `${className} est déjà référencé dans ${indexPath} — choisis un autre nom d'entité`,
    );
  }
  // Import NOMMÉ : un descripteur d'entité est une const exportée, pas un default
  // (contrairement à un controller, d'où l'insertion propre à l'entité ici plutôt
  // qu'une délégation à `wireDecoratorList`, qui écrit un import par défaut — vécu :
  // la DEUXIÈME entité d'un projet cassait le build avec `MISSING_EXPORT "default"`).
  const importLine = `import { ${className} } from "${importPath}";`;
  const manual = `  ${importLine}\n  @entities([${className}]) sur la classe Module`;

  const imports = [...source.matchAll(/^import [^\n]*$/gmu)];
  const last = imports.at(-1);
  if (!last || last.index === undefined) {
    throw new Error(
      `aucun import trouvé dans ${indexPath} — ajoute à la main :\n${manual}`,
    );
  }
  const importAt = last.index + last[0].length;

  // Le décorateur existe déjà (une entité a précédé) → compléter SA liste.
  const listRe = /@entities\(\[([^\]]*)\]\)/u;
  if (listRe.test(source)) {
    const withImport =
      source.slice(0, importAt) + `\n${importLine}` + source.slice(importAt);
    const current = (listRe.exec(withImport) as RegExpExecArray)[1].trim();
    const wired = withImport.replace(
      listRe,
      `@entities([${current ? `${current.replace(/,\s*$/u, "")}, ` : ""}${className}])`,
    );
    writer.write(indexPath, wired);
    return;
  }

  // Ancre : `@controllers(` s'il existe, sinon la déclaration de classe.
  const anchorRe = /^@controllers\(/mu;
  const classRe =
    /^(?:@[\w.]+\([\s\S]*?\)\s*)*class\s+\w+\s+extends\s+Module\b/mu;
  const anchor = anchorRe.exec(source) ?? classRe.exec(source);
  if (!anchor || anchor.index === undefined) {
    throw new Error(
      `ni @controllers ni « class … extends Module » dans ${indexPath} — ajoute à la main :\n${manual}`,
    );
  }

  // 1) l'import du descripteur + celui du décorateur (si absent) ;
  // 2) le décorateur lui-même, juste avant l'ancre.
  const needsDecoratorImport = !/\bentities\b[^\n]*@nodefony\/orm-core/u.test(
    source,
  );
  const injected =
    `\n${importLine}` +
    (needsDecoratorImport
      ? `\nimport { entities } from "@nodefony/orm-core";`
      : "");
  const withImports =
    source.slice(0, importAt) + injected + source.slice(importAt);

  // L'ancre est recalculée : les imports viennent de décaler le fichier.
  const shifted = anchorRe.exec(withImports) ?? classRe.exec(withImports);
  if (!shifted || shifted.index === undefined) {
    throw new Error(
      `point d'insertion perdu dans ${indexPath} — ajoute à la main :\n${manual}`,
    );
  }
  const wired =
    withImports.slice(0, shifted.index) +
    `@entities([${className}])\n` +
    withImports.slice(shifted.index);
  writer.write(indexPath, wired);
}

/**
 * Scaffold IN-PROJECT d'un frontend Vite (`create front`) : pose la coquille
 * HTML (la MÊME brique que `create app`), l'entry du framework choisi, le
 * controller de page (`renderDocument` + nonce CSP) et le registrar d'entry ;
 * câble `@controllers` et le hook `onKernelBoot` de la cible ; complète les
 * deps npm du framework (catalogue UNIQUE `FRONTEND_PARAMS`).
 *
 * @throws hors projet, cible inconnue, cible portant DÉJÀ un front
 *   (`frontend/index.html` — ce scaffold pose l'INITIAL, il ne fusionne pas),
 *   ou dep `@nodefony/frontend` absente de la cible.
 */
function runFrontScaffold(
  request: IScaffoldRequest,
  answers: TScaffoldAnswers,
  packageRoot: string,
  writer: ScaffoldWriter,
): IScaffoldResult {
  const projectRoot = findProjectRoot(request.dir);
  if (!projectRoot) {
    throw new Error(
      "aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant) — " +
        "lance la commande depuis une app (créée par `nodefony create app`)",
    );
  }
  const targets = listTargets(projectRoot, writer);
  const moduleName = String(answers.module ?? "");
  const target = moduleName
    ? targets.find((t) => t.kind === "module" && t.name === moduleName)
    : targets[0];
  if (!target) {
    const known = targets.map((t) => `${t.name} (${t.kind})`).join(" · ");
    throw new Error(
      `module « ${moduleName} » introuvable — cibles du projet : ${known}`,
    );
  }
  if (writer.exists(path.join(target.dir, "frontend", "index.html"))) {
    throw new Error(
      `${target.name} porte déjà un front (frontend/index.html) — ce scaffold ` +
        `pose la coquille et l'entry INITIALES ; pour une page de plus, ajoute ` +
        `une entry au registerEntry existant et un controller de page`,
    );
  }
  const manifestPath = path.join(target.dir, "package.json");
  const manifest = JSON.parse(writer.read(manifestPath)) as Record<
    string,
    Record<string, string>
  >;
  const targetDeps = new Set(
    ["dependencies", "devDependencies", "peerDependencies"].flatMap((b) =>
      Object.keys(manifest[b] ?? {}),
    ),
  );
  if (!targetDeps.has("@nodefony/frontend")) {
    throw new Error(
      `@nodefony/frontend manque dans ${target.name} — ajoute la dep + ` +
        `"@nodefony/frontend" au manifeste modules de nodefony.config.ts`,
    );
  }
  const frontend = answers.frontend as Exclude<TFrontendChoice, "none">;
  const front = FRONTEND_PARAMS[frontend];
  const base = String(answers.name);
  const pascal = toPascalCase(base);
  const nameClass = `${pascal}Controller`;
  const kebab = toKebabCase(base);
  const route = String(answers.route) || `/${kebab}`;
  const eta = new Eta({ useWith: false, varName: "it", autoEscape: false });
  const written: string[] = [];
  const data = {
    nameClass,
    pascal,
    kebab,
    route,
    frontend,
    front,
    // Titre de la coquille HTML (même clé que `create app`).
    appName: target.name,
  };
  const tokens = { __NAME__: nameClass, __PASCAL__: pascal };
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "shared", "front-shell"),
    target.dir,
    data,
    written,
    writer,
    tokens,
  );
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "front", "base"),
    target.dir,
    data,
    written,
    writer,
    tokens,
  );
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "front", frontend),
    target.dir,
    data,
    written,
    writer,
    tokens,
  );
  if (frontend === "angular") {
    renderLayer(
      eta,
      path.join(packageRoot, "templates", "shared", "ng-app-tsconfig"),
      target.dir,
      data,
      written,
      writer,
      tokens,
    );
  }
  if (frontend === "vue") {
    renderLayer(
      eta,
      path.join(packageRoot, "templates", "shared", "vue-shim"),
      target.dir,
      data,
      written,
      writer,
      tokens,
    );
  }
  // Deps du framework (catalogue unique) — ajoutées SEULEMENT si absentes
  // (jamais de bump silencieux d'une version choisie par l'utilisateur).
  const added: string[] = [];
  const addDeps = (block: string, entries: Record<string, string>) => {
    const deps = (manifest[block] ??= {});
    for (const [name, version] of Object.entries(entries)) {
      if (!targetDeps.has(name)) {
        deps[name] = version;
        added.push(name);
      }
    }
  };
  addDeps("dependencies", front.deps);
  addDeps("devDependencies", front.devDeps);
  if (added.length > 0) {
    writer.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    written.push("package.json");
  }
  const indexPath = path.join(target.dir, "index.ts");
  wireDecoratorList(
    indexPath,
    "controllers",
    nameClass,
    `./nodefony/controllers/${nameClass}`,
    writer,
  );
  const wireNote = wireKernelBootCall(
    indexPath,
    `register${pascal}Entry`,
    `./nodefony/frontend/register${pascal}Entry`,
    writer,
  );
  written.push("index.ts");
  const notes = [
    `page ${route} (GET — controller ${nameClass}, entry Vite « ${kebab} »)`,
    ...(added.length > 0
      ? [`deps ajoutées : ${added.join(", ")} → lance npm install`]
      : []),
    ...(wireNote ? [wireNote] : []),
  ];
  return { dest: target.dir, files: written.sort(), linked: [], notes };
}

/**
 * Câble un appel dans le hook `onKernelBoot()` de l'`index.ts` cible : import
 * de la fonction + soit INSERTION d'un hook complet (s'il n'existe pas — le
 * layout des index générés est connu), soit note actionnable (un hook existant
 * n'est JAMAIS édité : on ne réécrit pas du code utilisateur).
 *
 * @returns note à afficher si un geste manuel reste nécessaire, sinon `null`.
 */
export function wireKernelBootCall(
  indexPath: string,
  fnName: string,
  importPath: string,
  writer: ScaffoldWriter,
): string | null {
  const source = writer.read(indexPath);
  const importLine = `import { ${fnName} } from "${importPath}";`;
  const imports = [...source.matchAll(/^import [^\n]*$/gmu)];
  const last = imports.at(-1);
  if (!last || last.index === undefined) {
    return `ajoute à la main : ${importLine} + ${fnName}(this); dans onKernelBoot()`;
  }
  const importAt = last.index + last[0].length;
  const withImport =
    source.slice(0, importAt) + `\n${importLine}` + source.slice(importAt);
  if (/onKernelBoot\s*\(/u.test(withImport)) {
    // Hook déjà présent : on pose l'import (inoffensif) mais l'appel est un
    // geste HUMAIN — éditer une méthode existante à l'aveugle = corruption.
    writer.write(indexPath, withImport);
    return `onKernelBoot() existe déjà dans index.ts — ajoute : ${fnName}(this);`;
  }
  const hook =
    `\n  /**\n` +
    `   * Déclare l'entry frontend auprès du FrontendService — AVANT\n` +
    `   * onKernelReady pour que le superviseur Vite démarre avec elle.\n` +
    `   */\n` +
    `  override async onKernelBoot(): Promise<this> {\n` +
    `    ${fnName}(this);\n` +
    `    return this;\n` +
    `  }\n`;
  // Fin de classe = la dernière `}` AVANT `export default` (layout des index
  // générés par create app/module). Introuvable → geste manuel, jamais un
  // fichier corrompu.
  const closer = /\n\}\s*\n+export default /u.exec(withImport);
  if (!closer || closer.index === undefined) {
    writer.write(indexPath, withImport);
    return (
      `fin de classe introuvable dans index.ts — ajoute à la main le hook :\n` +
      `  override async onKernelBoot(): Promise<this> { ${fnName}(this); return this; }`
    );
  }
  const wired =
    withImport.slice(0, closer.index) +
    hook +
    withImport.slice(closer.index + 1);
  writer.write(indexPath, wired);
  return null;
}
