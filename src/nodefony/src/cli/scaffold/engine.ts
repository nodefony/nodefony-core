import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";
import { pick, SCAFFOLD_VERSIONS } from "./versions";
import {
  getScaffoldSpec,
  CONTROLLER_KIND_CHOICES,
  type IScaffoldTypeSpec,
  type TControllerKindChoice,
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
  /** Points d'entrée utiles du scaffold (routes, canaux…) — affichés tels quels. */
  notes?: string[];
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
    const target = path.join(destDir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, rendered);
    written.push(rel);
  }
}

/**
 * Racine du PROJET Nodefony courant (app générée / app utilisateur) : remonte
 * depuis `from` jusqu'au premier dossier portant `nodefony.config.ts` +
 * `package.json`. C'est la cible des scaffolds IN-PROJECT (controller, entity,
 * module) — par opposition à `create app` qui crée un dossier neuf.
 *
 * @returns racine absolue, ou `null` hors projet.
 */
export function findProjectRoot(from: string): string | null {
  let dir = path.resolve(from);
  for (;;) {
    if (
      existsSync(path.join(dir, "nodefony.config.ts")) &&
      existsSync(path.join(dir, "package.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

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
export function listTargets(projectRoot: string): IScaffoldTarget[] {
  const readName = (dir: string): string | null => {
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: string };
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
  if (existsSync(modulesDir)) {
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      const dir = path.join(modulesDir, entry.name);
      if (!entry.isDirectory() || !existsSync(path.join(dir, "index.ts"))) {
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
): void {
  const source = readFileSync(indexPath, "utf8");
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
  writeFileSync(indexPath, wired);
}

/**
 * Exécute un scaffold — point d'entrée UNIQUE des trois fronts (CLI rapide,
 * CLI interactif, Studio), dispatché par type :
 *  - `app` : projet NEUF dans `request.dir` (layers base/preset/frontend) ;
 *  - `controller` : IN-PROJECT — `request.dir` est le point de départ de la
 *    détection de racine (cwd de l'appelant), la cible réelle vient de
 *    `answers.module` (vide = app racine).
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
  if (request.type === "controller") {
    return runControllerScaffold(request, answers, packageRoot);
  }
  if (request.type === "front") {
    return runFrontScaffold(request, answers, packageRoot);
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
  renderLayer(eta, path.join(templates, "base"), dest, data, written);
  if (preset === "complete") {
    renderLayer(eta, path.join(templates, "complete"), dest, data, written);
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
    );
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
    // Briques par-framework partagées avec `create front` (source unique).
    if (frontend === "angular") {
      renderLayer(
        eta,
        path.join(packageRoot, "templates", "shared", "ng-app-tsconfig"),
        dest,
        data,
        written,
      );
    }
    if (frontend === "vue") {
      renderLayer(
        eta,
        path.join(packageRoot, "templates", "shared", "vue-shim"),
        dest,
        data,
        written,
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
    linked = linkLocalDeps(dest, workspaces);
  }
  return { dest, files: written.sort(), linked };
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
): IScaffoldResult {
  const projectRoot = findProjectRoot(request.dir);
  if (!projectRoot) {
    throw new Error(
      "aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant) — " +
        "lance la commande depuis une app (créée par `nodefony create app`)",
    );
  }
  const targets = listTargets(projectRoot);
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
    readFileSync(path.join(target.dir, "package.json"), "utf8"),
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
    { __NAME__: nameClass },
  );
  wireDecoratorList(
    path.join(target.dir, "index.ts"),
    "controllers",
    nameClass,
    `./nodefony/controllers/${nameClass}`,
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
): IScaffoldResult {
  const projectRoot = findProjectRoot(request.dir);
  if (!projectRoot) {
    throw new Error(
      "aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant) — " +
        "lance la commande depuis une app (créée par `nodefony create app`)",
    );
  }
  const targets = listTargets(projectRoot);
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
  if (existsSync(path.join(target.dir, "frontend", "index.html"))) {
    throw new Error(
      `${target.name} porte déjà un front (frontend/index.html) — ce scaffold ` +
        `pose la coquille et l'entry INITIALES ; pour une page de plus, ajoute ` +
        `une entry au registerEntry existant et un controller de page`,
    );
  }
  const manifestPath = path.join(target.dir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
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
    tokens,
  );
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "front", "base"),
    target.dir,
    data,
    written,
    tokens,
  );
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "front", frontend),
    target.dir,
    data,
    written,
    tokens,
  );
  if (frontend === "angular") {
    renderLayer(
      eta,
      path.join(packageRoot, "templates", "shared", "ng-app-tsconfig"),
      target.dir,
      data,
      written,
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
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    written.push("package.json");
  }
  const indexPath = path.join(target.dir, "index.ts");
  wireDecoratorList(
    indexPath,
    "controllers",
    nameClass,
    `./nodefony/controllers/${nameClass}`,
  );
  const wireNote = wireKernelBootCall(
    indexPath,
    `register${pascal}Entry`,
    `./nodefony/frontend/register${pascal}Entry`,
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
): string | null {
  const source = readFileSync(indexPath, "utf8");
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
    writeFileSync(indexPath, withImport);
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
    writeFileSync(indexPath, withImport);
    return (
      `fin de classe introuvable dans index.ts — ajoute à la main le hook :\n` +
      `  override async onKernelBoot(): Promise<this> { ${fnName}(this); return this; }`
    );
  }
  const wired =
    withImport.slice(0, closer.index) +
    hook +
    withImport.slice(closer.index + 1);
  writeFileSync(indexPath, wired);
  return null;
}
