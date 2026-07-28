import { existsSync, readdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";
import { findProjectRoot } from "../projectRoot";
// L'infra déclarée et l'ordre de la cascade `.env` ont chacun UNE
// implémentation, celle qu'exécute le kernel. Le scaffold les emprunte : une
// seconde lecture divergerait au premier alias ou au premier fichier ajouté.
import { resolveInfra } from "../../config/infra";
import { envFileOrder } from "../../runtime/loadEnv";
import {
  parseEntityFields,
  parseEntityIndexes,
  buildEntityCodegen,
  describeColumnTypes,
  toSnakeCase,
  COLUMN_CASES,
  ENTITY_DIALECTS,
  ENTITY_ID_KINDS,
  type TColumnCase,
  type TEntityDialect,
  type TEntityIdKind,
  type IEntityField,
} from "./entityFields";
import { findReservedEntity } from "./reservedEntities";
import { pick, SCAFFOLD_VERSIONS } from "./versions";
import { ScaffoldWriter, type IScaffoldChange } from "./writer";
import {
  getScaffoldSpec,
  CONTROLLER_KIND_CHOICES,
  type IScaffoldTypeSpec,
  type TCommandPhaseChoice,
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

/**
 * Réponses d'un scaffold, complétées et validées contre la spec.
 *
 * Le tableau de chaînes sert les questions de type `"list"` — plusieurs valeurs
 * qui doivent rester DISTINCTES. Les fondre dans le type texte reviendrait à les
 * concaténer, et deux index de deux colonnes deviendraient un index de quatre.
 */
export type TScaffoldAnswers = Record<string, string | boolean | string[]>;

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
  "oxlintrc.json": ".oxlintrc.json",
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
      // Un specifier `file:` est une donnée qui VOYAGE (le `package.json` généré est lu
      // par npm, commité, partagé) — pas un chemin qu'on redonne au système de fichiers.
      // Il s'écrit donc avec des `/` sur toutes les plateformes, là où `workspace` porte
      // le séparateur natif (`D:\a\checkout\src\nodefony` sous Windows).
      deps[name] = `file:${workspace.split(path.sep).join("/")}`;
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
    if (q.type === "list") {
      // Chaque valeur reste ENTIÈRE. Les passer par `String()` comme les autres
      // les souderait en une seule, et l'appelant récupérerait un index de quatre
      // colonnes là où il en avait demandé deux de deux.
      answers[q.key] = Array.isArray(value)
        ? value.map(String).filter((v) => v.length > 0)
        : typeof value === "string" && value.length > 0
          ? [value]
          : [];
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

/** Marqueurs de la zone préservée d'`AGENTS.md` — le contrat du merge borné. */
const APP_NOTES_START = "<!-- app-notes:start -->";
const APP_NOTES_END = "<!-- app-notes:end -->";

/**
 * Réinjecte la zone `app-notes` du contenu précédent dans le rendu neuf.
 *
 * C'est TOUT le merge que le scaffold sait faire, et c'est voulu : `AGENTS.md`
 * est 100 % dérivé (réécrit en entier à chaque régénération — il ne peut pas
 * mentir), SAUF cette zone, où l'humain et l'agent accumulent les leçons
 * propres à l'app. Un marqueur absent ou inversé (fichier retravaillé à la
 * main) → le rendu neuf part tel quel : mieux vaut perdre des notes déplacées
 * qu'écrire un fichier recousu de façon imprévisible.
 */
function preserveAppNotes(previous: string, next: string): string {
  const start = previous.indexOf(APP_NOTES_START);
  const end = previous.indexOf(APP_NOTES_END);
  if (start === -1 || end === -1 || end < start) {
    return next;
  }
  const notes = previous.slice(start + APP_NOTES_START.length, end);
  const ns = next.indexOf(APP_NOTES_START);
  const ne = next.indexOf(APP_NOTES_END);
  if (ns === -1 || ne === -1 || ne < ns) {
    return next;
  }
  return next.slice(0, ns + APP_NOTES_START.length) + notes + next.slice(ne);
}

/** Ce que le template `AGENTS.md` de l'app a besoin de savoir du projet. */
interface IAgentsData {
  appName: string;
  nodefonyVersion: string;
  hasSecurity: boolean;
  hasOrm: boolean;
  hasRealtime: boolean;
  hasStudio: boolean;
  front: boolean;
  /** Modules du projet (`modules/*`), chemin relatif à la racine. */
  modules: { name: string; dir: string }[];
}

/**
 * Rend `AGENTS.md` (+ le pointeur `CLAUDE.md`) à la racine du projet.
 *
 * Appelé par `create app` ET re-appelé par les scaffolds in-project qui
 * changent l'inventaire décrit (`create module`) : régénération BORNÉE —
 * réécriture complète depuis l'état RÉEL du projet, seule la zone `app-notes`
 * est réinjectée (cf {@link preserveAppNotes}). Le moteur ne sait pas rejouer
 * des templates sur de l'existant, et n'essaie pas : seuls ces fichiers
 * 100 % dérivés sont régénérables.
 *
 * `CLAUDE.md` n'est écrit QUE s'il n'existe pas : c'est un pointeur d'une
 * ligne, et un `CLAUDE.md` remplacé par l'utilisateur lui appartient.
 */
function renderProjectAgents(
  eta: Eta,
  packageRoot: string,
  projectRoot: string,
  data: IAgentsData,
  written: string[],
  writer: ScaffoldWriter,
): void {
  const tplDir = path.join(packageRoot, "templates", "app", "agents");
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  let rendered = eta.renderString(
    readFileSync(path.join(tplDir, "AGENTS.md.tpl"), "utf8"),
    data as unknown as Record<string, unknown>,
  );
  if (rendered.includes("<%")) {
    throw new Error("tag eta résiduel dans AGENTS.md");
  }
  if (writer.exists(agentsPath)) {
    rendered = preserveAppNotes(writer.read(agentsPath), rendered);
  }
  writer.write(agentsPath, rendered);
  written.push("AGENTS.md");
  const claudePath = path.join(projectRoot, "CLAUDE.md");
  if (!writer.exists(claudePath)) {
    const pointer = eta.renderString(
      readFileSync(path.join(tplDir, "CLAUDE.md.tpl"), "utf8"),
      data as unknown as Record<string, unknown>,
    );
    writer.write(claudePath, pointer);
    written.push("CLAUDE.md");
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

/**
 * Ce que le PROJET RÉEL offre comme choix à un scaffold, sans démarrer le noyau.
 *
 * Une question dont les réponses valides dépendent du projet ne peut pas être
 * décrite par la spec seule : les connecteurs déclarés, les entités déjà créées
 * et les types de colonnes réellement disponibles varient d'une application à
 * l'autre. Sans ce contexte, chaque front redemande la même chose en texte
 * libre — et une faute de frappe ne se voit qu'au démarrage suivant.
 *
 * Le calcul vit ici, au moteur, et pas dans Studio : un formulaire intelligent
 * écrit côté navigateur ne profiterait ni au terminal ni à un agent, et
 * dériverait du projet réel à la première évolution.
 */
export interface IScaffoldContext {
  /** Cibles possibles : l'application racine et ses modules locaux. */
  targets: IScaffoldTarget[];
  /** Connecteurs déclarés, avec le moteur SQL de chacun. */
  connectors: IScaffoldConnector[];
  /**
   * Types de champ disponibles, et ce qu'ils deviennent dans CHAQUE moteur.
   *
   * La traduction est montrée plutôt que promise : `json` devient `jsonb` en
   * PostgreSQL et une colonne texte en SQLite, et c'est une information dont
   * dépend le choix de celui qui modélise.
   */
  columnTypes: Array<{
    /** Nom du type dans le vocabulaire Nodefony. */
    type: string;
    /** Colonne Drizzle produite, par dialecte. */
    byDialect: Record<string, string>;
  }>;
  /** Entités existantes par cible — ce que `ref:` peut viser. */
  entities: Record<string, string[]>;
  /** Stratégies de clé primaire proposées. */
  idKinds: readonly string[];
}

/**
 * Lit le contexte du projet contenant `dir`.
 *
 * @param dir - un dossier quelconque du projet (la racine est retrouvée seule).
 * @param writer - accès fichiers (injectable pour les tests).
 * @returns le contexte, ou `null` si `dir` n'est pas dans un projet Nodefony.
 */
export function getScaffoldContext(
  dir: string,
  writer: ScaffoldWriter = new ScaffoldWriter(),
): IScaffoldContext | null {
  const projectRoot = findProjectRoot(dir);
  if (!projectRoot) return null;
  const targets = listTargets(projectRoot, writer);
  const entities: Record<string, string[]> = {};
  for (const target of targets) {
    entities[target.name] = readEntities(target.dir, writer);
  }
  return {
    targets,
    connectors: readConnectors(projectRoot, writer),
    columnTypes: describeColumnTypes(),
    entities,
    idKinds: ENTITY_ID_KINDS,
  };
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
 * (`@controllers([...])`, `@entities([...])`, `@services([...])`) : ajoute
 * l'import après le dernier import existant + insère le nom dans le tableau du
 * décorateur. Édition TEXTUELLE gardée — toute ambiguïté = throw actionnable,
 * jamais un fichier corrompu (le fichier n'est écrit que si les insertions
 * tiennent).
 *
 * `controllers`/`entities` sont TOUJOURS rendus par les scaffolds qui les
 * consomment (`@controllers([])` inconditionnel dans `app`/`module` ; les
 * entités passent par {@link wireEntitiesDecorator}, qui crée déjà sa propre
 * liste) — le décorateur introuvable y reste un refus. `services` diffère : le
 * layer `module/base` ne le rend que si la question « service » a répondu
 * `true`, et la racine d'une app n'en déclare JAMAIS un — le cas nominal d'un
 * `create service` est donc une cible qui n'a PAS encore de `@services([...])`.
 * Pour ce seul décorateur, l'absence n'est pas un refus : on le CRÉE, juste
 * au-dessus de la classe (même position que le gabarit quand il le rend lui-même),
 * en import ant `services` depuis `"nodefony"` s'il ne l'est pas déjà.
 *
 * @throws si la classe y est déjà, si aucun import n'ancre l'insertion, ou —
 *   pour `controllers`/`entities` seulement — si le décorateur est introuvable
 *   (le message donne l'édition manuelle exacte).
 */
export function wireDecoratorList(
  indexPath: string,
  decorator: "controllers" | "entities" | "services",
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
  // `@services(...)` peut ne pas être encore importé du tout (cible sans
  // service) : on l'ajoute dans la MÊME passe que l'import de la classe, pour
  // ne recalculer l'offset qu'une fois.
  const needsServicesImport =
    decorator === "services" &&
    !/\bservices\b[^\n]*from "nodefony"/u.test(source);
  const extraImport = needsServicesImport
    ? `\nimport { services } from "nodefony";`
    : "";
  const withImport =
    source.slice(0, importAt) +
    `\n${importLine}${extraImport}` +
    source.slice(importAt);
  const decoRe = new RegExp(`@${decorator}\\(\\[([^\\]]*)\\]\\)`, "u");
  const match = decoRe.exec(withImport);
  if (match && match.index !== undefined) {
    const list = match[1].trim();
    const wired = withImport.replace(
      decoRe,
      `@${decorator}([${list ? `${list.replace(/,\s*$/u, "")}, ` : ""}${className}])`,
    );
    writer.write(indexPath, wired);
    return;
  }
  if (decorator !== "services") {
    throw new Error(
      `@${decorator}([...]) introuvable dans ${indexPath} — ajoute à la main :\n` +
        `  ${importLine}\n  @${decorator}([${className}]) sur la classe Module`,
    );
  }
  // `export` est TOLÉRÉ devant la classe : nos gabarits exportent en bas de
  // fichier, mais `export class X extends Module` est la forme que la doc du
  // kernel montre — et c'est celle qu'une app écrite à la main portera. Un
  // décorateur inséré AVANT `export` reste valide (`@services([X])\nexport
  // class …`), donc l'ancre d'insertion ne bouge pas.
  const classRe =
    /^(?:export\s+(?:default\s+)?)?class\s+\w+\s+extends\s+Module\b/mu;
  const classMatch = classRe.exec(withImport);
  if (!classMatch || classMatch.index === undefined) {
    throw new Error(
      `« class … extends Module » introuvable dans ${indexPath} — ajoute à la main :\n` +
        `  ${importLine}\n  @services([${className}]) juste au-dessus de la classe`,
    );
  }
  const wired =
    withImport.slice(0, classMatch.index) +
    `@services([${className}])\n` +
    withImport.slice(classMatch.index);
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
  if (request.type === "service") {
    return runServiceScaffold(request, answers, packageRoot, writer);
  }
  if (request.type === "front") {
    return runFrontScaffold(request, answers, packageRoot, writer);
  }
  if (request.type === "entity") {
    return runEntityScaffold(request, answers, packageRoot, writer);
  }
  if (request.type === "command") {
    return runCommandScaffold(request, answers, packageRoot, writer);
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
    // Nom de la fonction de déclaration d'entry, et nom de l'entry Vite —
    // mêmes clés que `create front`, puisque c'est le MÊME template qui les rend.
    pascal: toPascalCase(String(answers.name)),
    entryName: answers.name,
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
  // AGENTS.md + pointeur CLAUDE.md : l'app naît PARLANTE pour un agent —
  // c'était le trou n°1 du scaffold (mutité totale). Régénéré ensuite par
  // `create module` (l'inventaire des modules y vit).
  renderProjectAgents(
    eta,
    packageRoot,
    dest,
    {
      appName: String(answers.name),
      nodefonyVersion: version,
      hasSecurity: preset === "complete",
      hasOrm: preset === "complete",
      hasRealtime: preset === "complete",
      hasStudio: preset === "complete",
      front: front !== null,
      modules: [],
    },
    written,
    writer,
  );
  // Accueil `GET /` : une app sans frontend répondait 404 à sa propre racine.
  // Rendu SEULEMENT sans front — avec un front, `AppController` tient `/`.
  if (!front) {
    renderLayer(eta, path.join(templates, "home"), dest, data, written, writer);
  }
  // Controller d'accueil : rendu par le template de `create controller --kind
  // hello`, PAS par une copie propre à l'app. Le premier exemple que
  // l'utilisateur lit est ainsi celui que la commande lui régénérera — et
  // corriger cet exemple le corrige aux deux endroits à la fois.
  //
  // Data DÉDIÉE (et non le `data` de l'app) : ce layer parle le vocabulaire
  // d'un controller ; mélanger les deux jeux de clés ferait qu'un renommage
  // dans l'un casserait l'autre en silence.
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "controller", "hello"),
    dest,
    {
      nameClass: "HelloController",
      kebab: "hello",
      route: "/api",
      // L'action d'index reste sur `/api/hello` (et non `/api`) : c'est l'URL
      // que le README, le test e2e généré et les trois vitrines montrent.
      indexPath: "/hello",
      helloName: answers.name,
      // Route protégée seulement si le manifeste généré déclare la zone
      // `secure` — c'est le preset complete qui embarque @nodefony/security.
      secureRoute: preset === "complete",
    },
    written,
    writer,
    { __NAME__: "HelloController" },
  );
  if (preset === "complete") {
    renderLayer(
      eta,
      path.join(templates, "complete"),
      dest,
      data,
      written,
      writer,
    );
    // Controller temps réel de la vitrine : rendu par le template de `create
    // controller --kind realtime` (même principe que HelloController — le
    // premier exemple realtime lu est celui que la commande régénérera).
    // C'est LUI que la carte « Temps réel » des vitrines consomme via la
    // façade client (RealtimeClient / hooks nodefony/react) : canal
    // `live:ticker`, actions `live:ping` / `live:snapshot`.
    renderLayer(
      eta,
      path.join(packageRoot, "templates", "controller", "realtime"),
      dest,
      {
        nameClass: "LiveController",
        kebab: "live",
        route: "/api/live",
        channel: "live",
        hasSecurity: true,
      },
      written,
      writer,
      { __NAME__: "LiveController" },
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
    // le layer du framework n'apporte que son App.
    renderLayer(
      eta,
      path.join(templates, "frontend", "shared"),
      dest,
      data,
      written,
      writer,
    );
    // Point de montage du framework — brique PARTAGÉE avec `create front`
    // (`shared/front-entry/`) : ces trois fichiers ne dépendent que du
    // framework, jamais de ce qui les entoure. Les tenir en deux exemplaires
    // faisait qu'une correction n'atteignait qu'une commande sur deux.
    renderLayer(
      eta,
      path.join(packageRoot, "templates", "shared", "front-entry", frontend),
      dest,
      data,
      written,
      writer,
    );
    // Déclaration de l'entry auprès du FrontendService — UN fichier documenté,
    // le même pour une app et pour un module. L'app l'inlinait dans son
    // `index.ts` : deux rédactions du même geste, dont une seule portait le
    // TSDoc qui explique `apiProxyPaths` (le piège n°1 du dev multi-origine).
    renderLayer(
      eta,
      path.join(packageRoot, "templates", "shared", "front-registrar"),
      dest,
      data,
      written,
      writer,
      { __PASCAL__: toPascalCase(String(answers.name)) },
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
    controller,
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
  // AGENTS.md du module — TOUJOURS rendu : la précédence « le plus proche
  // gagne » du standard fait qu'un agent travaillant dans `modules/<nom>/` lit
  // le contexte du module, pas l'index global de l'app. (L'ancien couple
  // CLAUDE.md/MEMORY.md conditionné à un CLAUDE.md racine — que `create app`
  // ne créait jamais — était du contenu mort.)
  renderLayer(
    eta,
    path.join(templates, "ai"),
    dest,
    data,
    written,
    writer,
    tokens,
  );
  const notes: string[] = [];
  // Le module existe sur le disque → il est désormais une CIBLE (`listTargets`) :
  // les scaffolds command/controller/front peuvent le viser, sans un template dupliqué.
  if (data.command) {
    const sub = runScaffold(
      {
        type: "command",
        answers: {
          name: "hello",
          description: `Salue depuis le module ${name}`,
          phase: "onReady",
          module: pkgName,
          // Le module vient de rendre son service : c'est le seul appelant qui
          // SAIT que l'appel généré compilera.
          service: data.service,
        },
        dir: projectRoot,
        force: request.force,
      },
      version,
      { writer },
    );
    written.push(...sub.files);
    notes.push(...(sub.notes ?? []));
  }
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
  // Régénération BORNÉE de l'AGENTS.md de l'app : l'inventaire des modules y
  // vit, et un AGENTS.md qui ignore le module qu'on vient de créer ment. Tout
  // est re-DÉRIVÉ de l'état réel (deps de l'app, cibles du projet — la
  // transaction voit le module en attente) ; seule la zone `app-notes` survit.
  // Une app née avant ce mécanisme y gagne son AGENTS.md au premier module.
  renderProjectAgents(
    eta,
    packageRoot,
    projectRoot,
    {
      appName,
      nodefonyVersion: version,
      hasSecurity: appDeps.has("@nodefony/security"),
      hasOrm: appDeps.has("@nodefony/orm-core"),
      hasRealtime: appDeps.has("@nodefony/realtime"),
      hasStudio: appDeps.has("@nodefony/studio"),
      front: appDeps.has("@nodefony/frontend"),
      modules: listTargets(projectRoot, writer)
        .filter((t) => t.kind === "module")
        .map((t) => ({
          name: t.name,
          // Ce chemin est RENDU dans `AGENTS.md` — un document que lisent des agents et
          // des humains, pas un chemin qu'on redonne au système de fichiers. Il s'écrit
          // donc `modules/blog` partout, jamais `modules\blog`.
          dir: path.relative(projectRoot, t.dir).split(path.sep).join("/"),
        })),
    },
    written,
    writer,
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
    // Le controller créé à la demande monte son index à la racine de SON
    // préfixe (`/api/blog`), et n'expose pas de route protégée : celle-ci
    // n'aurait aucune zone firewall qui la couvre (cf le template `hello`).
    indexPath: "",
    helloName: kebab,
    secureRoute: false,
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

/**
 * Scaffold IN-PROJECT d'un service injectable : résout la cible (app racine ou
 * module), rend la classe (`@injectable`, `extends Service`) + son interface
 * dans `<cible>/nodefony/{service,interfaces}/`, puis câble la classe dans le
 * `@services([...])` de l'`index.ts` cible — CRÉÉ s'il n'existe pas encore
 * (cf {@link wireDecoratorList}, seul cas où l'absence du décorateur n'est pas
 * un refus).
 *
 * Volontairement AUTONOME : contrairement au service PRINCIPAL d'un module
 * (`create module`, gabarit `templates/module/service/`), celui-ci ne dépend
 * d'aucun `nodefony/config/config.ts` — une cible existante (app racine, ou
 * module créé avec `--no-service`) n'en a pas forcément un, et le résultat
 * doit compiler tel quel, sans édition manuelle.
 *
 * @throws hors projet, cible inconnue (le message liste les cibles), ou nom
 *   déjà référencé dans l'`index.ts` cible.
 */
function runServiceScaffold(
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
  // Nom normalisé : suffixe Service strippé s'il est déjà donné (même
  // tolérance que `Controller` pour `create controller`), classe en
  // PascalCase, clé de conteneur en camelCase (`super("billing", …)`).
  const base = String(answers.name).replace(/[-_]?[Ss]ervice$/u, "");
  const pascal = toPascalCase(base);
  const nameClass = `${pascal}Service`;
  const camel = pascal[0].toLowerCase() + pascal.slice(1);
  const eta = new Eta({ useWith: false, varName: "it", autoEscape: false });
  const written: string[] = [];
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "service"),
    target.dir,
    {
      pascal,
      camel,
      description:
        String(answers.description) || `Service ${pascal} de ${target.name}`,
    },
    written,
    writer,
    { __PASCAL__: pascal },
  );
  wireDecoratorList(
    path.join(target.dir, "index.ts"),
    "services",
    nameClass,
    `./nodefony/service/${nameClass}`,
    writer,
  );
  written.push("index.ts");
  return {
    dest: target.dir,
    files: written.sort(),
    linked: [],
    notes: [
      `DI   container.get("${camel}")  — clé du conteneur (super("${camel}", …))`,
      `DI   @inject("${nameClass}")    — nom de classe (@injectable)`,
    ],
  };
}

/**
 * Nom Nodefony déclaré par le premier `super("…", …)` d'un fichier — celui d'un
 * `Module` (`index.ts`) ou d'un `Service`.
 *
 * C'est la CLÉ du conteneur, et pour un module le préfixe de ses commandes CLI
 * (`<module>:<action>`). Elle ne se déduit ni du nom npm du paquet ni du nom de
 * la classe : les trois peuvent différer, et seule celle-ci existe au runtime.
 *
 * @returns le nom déclaré, ou `null` si le fichier ne suit pas la forme attendue.
 */
function readNodefonyName(file: string, writer: ScaffoldWriter): string | null {
  try {
    return /\bsuper\(\s*"([^"]+)"/u.exec(writer.read(file))?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Service appelable de la cible : sa classe et sa clé de conteneur.
 *
 * `greet` est exigée parce que c'est la méthode que la commande générée appelle :
 * mieux vaut refuser l'option que produire un appel qui ne compile pas. Un
 * service écrit à la main porte d'autres méthodes — l'utilisateur adaptera le
 * fichier généré, ce qui reste plus honnête qu'un exemple faux.
 *
 * @returns `{ pascal, key }`, ou `null` si la cible n'a aucun service de cette forme.
 */
function findTargetService(
  targetDir: string,
  writer: ScaffoldWriter,
): { pascal: string; key: string } | null {
  const dir = path.join(targetDir, "nodefony", "service");
  if (!writer.exists(dir)) {
    return null;
  }
  for (const entry of writer.listDir(dir)) {
    if (entry.isDirectory || !entry.name.endsWith("Service.ts")) {
      continue;
    }
    const file = path.join(dir, entry.name);
    const key = readNodefonyName(file, writer);
    if (key === null || !/\bgreet\s*\(/u.test(writer.read(file))) {
      continue;
    }
    return { pascal: entry.name.replace(/\.ts$/u, ""), key };
  }
  return null;
}

/**
 * Câble `this.addCommand(<Classe>)` dans le constructeur du Module d'un
 * `index.ts` : ajoute l'import après le dernier import, insère l'appel juste
 * après le `super(…)` du constructeur.
 *
 * L'ancre est le `super(…)` et non l'accolade du constructeur : c'est la seule
 * ligne dont l'existence est GARANTIE (un `Module` doit appeler `super`), et
 * insérer après elle vaut pour un constructeur vide comme pour un constructeur
 * déjà rempli. Édition textuelle gardée, même contrat que
 * {@link wireDecoratorList} : toute ambiguïté = throw actionnable, jamais un
 * fichier corrompu.
 *
 * @throws si la classe y est déjà, si aucun import n'ancre l'insertion, ou si
 *   le `super(…)` du constructeur est introuvable (le message donne l'édition
 *   manuelle exacte).
 */
export function wireCommandCall(
  indexPath: string,
  className: string,
  importPath: string,
  writer: ScaffoldWriter,
): void {
  const source = writer.read(indexPath);
  const importLine = `import ${className} from "${importPath}";`;
  const callLine = `this.addCommand(${className});`;
  if (new RegExp(`\\b${className}\\b`, "u").test(source)) {
    throw new Error(
      `${className} est déjà référencé dans ${indexPath} — choisis un autre nom`,
    );
  }
  const imports = [...source.matchAll(/^import [^\n]*$/gmu)];
  const last = imports.at(-1);
  if (!last || last.index === undefined) {
    throw new Error(
      `aucun import trouvé dans ${indexPath} — ajoute à la main :\n` +
        `  ${importLine}\n  ${callLine} dans le constructeur`,
    );
  }
  const importAt = last.index + last[0].length;
  const withImport =
    source.slice(0, importAt) + `\n${importLine}` + source.slice(importAt);
  // Pas de parenthèse imbriquée attendue dans un `super(nom, kernel, url, config)` :
  // si la forme est autre, on REFUSE plutôt que de deviner où finit l'appel.
  const superRe = /super\([^()]*\);/u;
  const match = superRe.exec(withImport);
  if (!match || match.index === undefined) {
    throw new Error(
      `super(…) du constructeur introuvable dans ${indexPath} — ajoute à la main :\n` +
        `  ${importLine}\n  ${callLine} après le super(…) du constructeur`,
    );
  }
  const lineStart = withImport.lastIndexOf("\n", match.index) + 1;
  const indent =
    /^[ \t]*/u.exec(withImport.slice(lineStart, match.index))?.[0] ?? "    ";
  const at = match.index + match[0].length;
  writer.write(
    indexPath,
    `${withImport.slice(0, at)}\n${indent}${callLine}${withImport.slice(at)}`,
  );
}

/**
 * Scaffold IN-PROJECT d'une commande CLI : rend la classe dans
 * `<cible>/nodefony/command/` puis la câble dans le constructeur du Module
 * cible (`this.addCommand(…)`).
 *
 * Le nom complet est DÉRIVÉ : `<module>:<action>`, où le module est celui que
 * l'`index.ts` de la cible déclare (`super("blog", …)`) — pas le nom npm du
 * paquet, qui peut différer. Écrire le préfixe soi-même est toléré (il est
 * strippé), jamais exigé.
 *
 * @throws hors projet, cible inconnue (le message liste les cibles), action
 *   vide, phase inconnue, `--service` sans service appelable, ou wiring
 *   impossible (actionnable).
 */
function runCommandScaffold(
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
  const indexPath = path.join(target.dir, "index.ts");
  const prefix =
    readNodefonyName(indexPath, writer) ??
    (target.name.split("/").pop() as string);
  // L'action seule suffit — mais `create command blog:publish` est le réflexe
  // naturel de qui lit `nodefony blog:publish` dans l'aide. On strippe le
  // préfixe redondant au lieu de refuser (même tolérance que le suffixe
  // `Controller` de `create controller`).
  let action = String(answers.name).trim().toLowerCase();
  if (action === prefix) {
    // Nommer la commande d'après son module (`create command blog` dans `blog`)
    // est une confusion, pas une intention : `blog:blog` n'est la commande de
    // personne. On dit ce qui manque plutôt que de la produire.
    action = "";
  } else if (action.startsWith(`${prefix}:`)) {
    action = action.slice(prefix.length + 1);
  }
  if (action === "") {
    throw new Error(
      `action requise (le préfixe « ${prefix} » est ajouté seul) — ` +
        `ex : nodefony create command publish${moduleName ? ` --module ${moduleName}` : ""}`,
    );
  }
  // La phase est un `choice` de la spec : `resolveAnswers` a déjà refusé une
  // valeur hors liste — inutile de la revalider ici.
  const phase = String(answers.phase) as TCommandPhaseChoice;
  const commandName = `${prefix}:${action}`;
  const nameClass = `${toPascalCase(action.replaceAll(":", "-"))}Command`;
  const service =
    answers.service === true ? findTargetService(target.dir, writer) : null;
  if (answers.service === true && service === null) {
    throw new Error(
      `--service : aucun service appelable dans ${target.name} ` +
        `(attendu : nodefony/service/*Service.ts exposant greet()) — relance sans --service`,
    );
  }
  const eta = new Eta({ useWith: false, varName: "it", autoEscape: false });
  const written: string[] = [];
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "command"),
    target.dir,
    {
      nameClass,
      commandName,
      phase,
      description:
        String(answers.description) || `Commande ${commandName} de ${prefix}`,
      service,
    },
    written,
    writer,
    { __NAME__: nameClass },
  );
  wireCommandCall(
    indexPath,
    nameClass,
    `./nodefony/command/${nameClass}`,
    writer,
  );
  written.push("index.ts");
  return {
    dest: target.dir,
    files: written.sort(),
    linked: [],
    notes: [
      `CLI  nodefony ${commandName} [who] [-j]  (phase ${phase})`,
      `visible dans \`nodefony --help\` une fois le module construit`,
    ],
  };
}

/**
 * Valeur d'exemple d'un champ — VALIDE au regard du schéma de l'entité.
 *
 * Un échantillon n'est pas une décoration : les tests générés s'en servent pour
 * insérer, et la documentation pour montrer un appel qui marche. S'il viole le
 * schéma, l'entité naît avec un test rouge, et la première impression du
 * générateur est qu'il produit du code cassé.
 *
 * Ce piège s'est présenté trois fois, sur trois types ajoutés à trois moments
 * différents — l'énumération, puis le décimal et le caractère fixe. Chaque fois,
 * la valeur générique `nom-1` passait à côté d'une contrainte que le schéma, lui,
 * faisait respecter. D'où cette fonction unique : tout type qui restreint ses
 * valeurs doit dire ici ce qu'il accepte, sinon rien ne le rappellera.
 *
 * @param field - le champ à illustrer.
 * @param id - stratégie de clé primaire (une référence vers une clé numérique
 *   attend un nombre, pas une chaîne).
 * @returns `fixed` pour le JSON de la documentation, `expr` pour la fabrique
 *   paramétrée des tests (une expression TypeScript où `n` varie).
 */
export function sampleValue(
  field: IEntityField,
  id: TEntityIdKind,
): { fixed: unknown; expr: string } {
  const { name, type } = field;
  if (type === "int" || type === "float") return { fixed: 1, expr: "n" };
  if (type === "bool") return { fixed: true, expr: "true" };
  if (type === "json") return { fixed: {}, expr: "{}" };
  if (type === "date") {
    return { fixed: "2026-01-01T00:00:00.000Z", expr: "new Date()" };
  }
  if (type === "enum") {
    // Une énumération n'accepte que ses propres valeurs. Le défaut déclaré
    // d'abord, sinon la première — jamais une valeur inventée.
    const value = field.defaultValue ?? field.values?.[0] ?? "";
    return { fixed: value, expr: JSON.stringify(value) };
  }
  if (type === "ref") {
    // Une référence vers une clé auto-incrémentée est un NOMBRE : le schéma la
    // valide comme tel, une chaîne y serait refusée.
    return id === "serial"
      ? { fixed: 1, expr: "n" }
      : { fixed: `${name}-1`, expr: `\`${name}-\${n}\`` };
  }
  if (type === "uuid") {
    // Le schéma exige un identifiant bien formé (`z.string().uuid()`), donc pas
    // `nom-1`. On fabrique une version 4 valide dont seule la fin varie.
    const tail = (n: string): string =>
      `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
    return {
      fixed: tail("1"),
      expr: `\`00000000-0000-4000-8000-\${String(n).padStart(12, "0")}\``,
    };
  }
  if (type === "decimal") {
    // Le schéma impose une écriture décimale : `nom-1` la viole.
    return { fixed: "12.34", expr: "`${n}.50`" };
  }
  if (type === "char") {
    // Longueur EXACTE : ni plus, ni moins. On répète un caractère, et la
    // variation se loge dans les derniers rangs quand la place le permet.
    const size = field.length ?? 1;
    const fixed = "A".repeat(size);
    return {
      fixed,
      expr: `String(n).padStart(${size}, "A").slice(-${size})`,
    };
  }
  // `string` bornée : le libellé habituel, tronqué à la longueur permise — un
  // nom de champ long dépasserait une petite colonne, et le schéma le refuserait.
  const max = field.length;
  if (type === "string" && max !== undefined) {
    return {
      fixed: `${name}-1`.slice(0, max),
      expr: `\`${name}-\${n}\`.slice(0, ${max})`,
    };
  }
  return { fixed: `${name}-1`, expr: `\`${name}-\${n}\`` };
}

/** Pluriel simple, suffisant pour un nom de table (`Post` → `posts`, `Story` → `stories`). */
function pluralize(word: string): string {
  if (/[^aeiou]y$/u.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/u.test(word)) return `${word}es`;
  return `${word}s`;
}

/**
 * `BlogPost` → `blog_posts` — nom de table SQL par DÉFAUT.
 *
 * Par défaut seulement : `--table` impose un nom littéral, seul moyen d'épouser une
 * table qui existe déjà (`website`, `session`) — la pluralisation ne se devine pas à
 * l'envers, et une table réelle ne demande la permission à personne.
 *
 * La casse vient de {@link toSnakeCase}, la même que celle des colonnes : deux
 * grammaires auraient fini par diverger sur un nom composé.
 */
function tableName(pascal: string): string {
  return pluralize(toSnakeCase(pascal));
}

/**
 * Identifiant SQL acceptable — minuscules, chiffres, tiret bas.
 *
 * Volontairement plus strict que ce que les moteurs tolèrent entre guillemets : un
 * nom qui exige d'être cité voyage mal d'un dialecte à l'autre, et le générateur
 * l'écrirait sans les guillemets qui le sauvent.
 */
const SQL_NAME_RE = /^[a-z_][a-z0-9_]*$/u;

/** Refuse un identifiant SQL AVANT toute écriture, en nommant ce qui est attendu. */
function assertSqlName(value: string, option: string): string {
  if (!SQL_NAME_RE.test(value)) {
    throw new Error(
      `${option} invalide « ${value} » — un identifiant SQL commence par une lettre ` +
        `minuscule ou « _ », puis minuscules, chiffres et « _ » (ex : website_id)`,
    );
  }
  return value;
}

/**
 * Dialecte SQL du connecteur visé — **l'infra déclarée d'abord**, le fichier ensuite.
 *
 * L'ordre n'est pas un détail de confort : c'est celui du RUNTIME. Une
 * application déclare sa base par URL (`NF_DATABASE_URL`, modèle « infra
 * déclarée » — docker, conteneur, CI, production), et `nodefony.config.ts` ne
 * porte alors aucun dialecte. Le scaffold, qui ne lisait que le fichier,
 * retombait sur `sqlite` et générait du Drizzle SQLite pour une application qui
 * tourne sur PostgreSQL. Le DDL de développement créait ensuite les colonnes
 * telles quelles : chaînes bornées devenues `text`, identifiants `uuid` devenus
 * `text` — et là c'est structurel, PostgreSQL refuse `text = uuid`, donc toute
 * jointure écrite ensuite échoue.
 *
 * Mesuré sur un schéma réel (banc de schéma, umami) : **18 identifiants
 * dégradés et 32 longueurs perdues** sur 83 colonnes, sans un mot.
 *
 * La déduction depuis l'URL n'est pas réécrite ici : {@link resolveInfra} en est
 * la source unique, la même que celle qu'exécute le kernel. Un scaffold qui
 * dériverait son propre scheme divergerait au premier alias ajouté.
 *
 * Le fichier reste consulté ensuite : un connecteur qui déclare explicitement
 * son dialecte l'emporte sur un défaut, et une app multi-connecteurs n'a pas
 * qu'une base.
 */
function detectDialect(
  projectRoot: string,
  writer: ScaffoldWriter,
  connector = "default",
): TEntityDialect {
  const connectors = readConnectors(projectRoot, writer);
  const found = connectors.find((c) => c.name === connector);
  // Un dialecte ÉCRIT dans la configuration est une intention explicite : elle
  // prime. C'est l'ABSENCE de déclaration qui doit interroger l'environnement,
  // et non l'inverse.
  if (found && declaresDialect(projectRoot, writer, connector)) {
    return found.dialect;
  }
  const declared = infraDialect(projectRoot);
  if (declared) return declared;
  if (found) return found.dialect;
  // Connecteur inconnu du fichier de configuration : on garde le repli
  // historique plutôt que d'échouer — le scaffold ANNONCE le dialecte retenu,
  // donc une déduction fausse se voit tout de suite au lieu de produire une
  // table du mauvais moteur en silence.
  return connectors[0]?.dialect ?? "sqlite";
}

/**
 * Le dialecte du connecteur est-il ÉCRIT dans `nodefony.config.ts` ?
 *
 * {@link readConnectors} ne peut pas répondre : il rend `sqlite` aussi bien pour
 * un `dialect: "sqlite"` assumé que pour une absence de déclaration. Distinguer
 * les deux est tout l'enjeu — sans cela, l'infra déclarée ne pourrait jamais
 * s'appliquer, puisqu'un défaut lui ressemblerait toujours à un choix.
 */
function declaresDialect(
  projectRoot: string,
  writer: ScaffoldWriter,
  connector: string,
): boolean {
  const configPath = path.join(projectRoot, "nodefony.config.ts");
  if (!writer.exists(configPath)) return false;
  const block = extractBlock(writer.read(configPath), "connectors");
  if (block === null) return false;
  const entry = /(\w+)\s*:\s*\{([^{}]*)\}/gu;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(block)) !== null) {
    if (match[1] !== connector) continue;
    return /dialect\s*:\s*["'](\w+)["']/u.test(match[2] ?? "");
  }
  return false;
}

/**
 * Dialecte de l'infra DÉCLARÉE du projet, cascade `.env` comprise.
 *
 * `process.env` seul ne suffit pas : une URL posée dans `.env.local` (le cas
 * nominal en développement — le fichier est gitignoré, c'est là qu'on met sa
 * base) n'est pas dans l'environnement du terminal qui lance le scaffold. On
 * emprunte donc l'ORDRE de la cascade au runtime ({@link envFileOrder}) plutôt
 * que d'en inventer un : un ordre affiché qui différerait de l'ordre appliqué
 * serait pire que pas d'ordre du tout.
 *
 * @returns le dialecte SQL, ou `null` si aucune base n'est déclarée (ou si elle
 *   n'est pas SQL — une base mongo ne dicte aucun dialecte à `create entity`).
 */
function infraDialect(projectRoot: string): TEntityDialect | null {
  const env: Record<string, string | undefined> = {};
  try {
    // `envFileOrder` rend des NOMS, pas des chemins — et sans mode d'exécution
    // il rend les deux niveaux universels (`.env.local` puis `.env`), qui sont
    // exactement ceux qu'un scaffold peut connaître : il tourne hors de tout
    // boot, donc hors de tout `NODE_ENV` résolu.
    for (const name of envFileOrder()) {
      const file = path.join(projectRoot, name);
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m =
          /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
        if (!m?.[1]) continue;
        // La cascade est ordonnée du plus fort au plus faible : le premier
        // fichier qui pose une clé la garde.
        if (env[m[1]] === undefined) {
          env[m[1]] = m[2]?.trim().replace(/^["']|["']$/gu, "");
        }
      }
    }
  } catch {
    /* cascade illisible — l'environnement du process reste consultable */
  }
  try {
    // Le shell l'emporte sur les fichiers, comme au runtime.
    const infra = resolveInfra({ ...env, ...process.env });
    const dialect = infra.database?.dialect;
    return dialect && (ENTITY_DIALECTS as readonly string[]).includes(dialect)
      ? (dialect as TEntityDialect)
      : null;
  } catch {
    // URL non supportée : ce n'est pas au scaffold de rendre ce verdict — le
    // boot le fera, avec le bon message.
    return null;
  }
}

/**
 * Contenu de l'objet qui suit `<clé>:`, borné par son accolade APPARIÉE.
 *
 * Sans appariement, une expression régulière lâche continue de trouver des
 * entrées bien après la fin du bloc visé — elle ramasserait alors tout le reste
 * du fichier de configuration.
 *
 * @returns le corps du bloc (accolades exclues), ou `null` si la clé est absente.
 */
function extractBlock(source: string, key: string): string | null {
  const at = source.indexOf(key);
  if (at < 0) return null;
  const open = source.indexOf("{", at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Un connecteur de base de données, tel que déclaré dans la configuration. */
export interface IScaffoldConnector {
  /** Nom sous lequel les entités le désignent (`default`, `analytics`…). */
  name: string;
  /** Moteur SQL visé — décide des types de colonnes générés. */
  dialect: TEntityDialect;
}

/**
 * Connecteurs déclarés par l'application, lus SANS démarrer le noyau.
 *
 * Lecture TEXTUELLE assumée : `nodefony.config.ts` est du TypeScript, et
 * l'exécuter pour lire une clé coûterait un boot complet. On isole donc le bloc
 * `connectors: { … }` puis chaque entrée `<nom>: { … dialect: "…" }`.
 *
 * Pourquoi ne pas se contenter de chercher le premier `dialect:` du fichier :
 * une application qui déclare deux connecteurs de moteurs différents ferait
 * générer TOUTES ses entités dans le dialecte du premier, sans un mot.
 *
 * @param projectRoot - racine du projet (là où vit `nodefony.config.ts`).
 * @param writer - accès fichiers transactionnel du scaffold.
 * @returns les connecteurs trouvés, dans l'ordre de déclaration (vide si aucun).
 */
function readConnectors(
  projectRoot: string,
  writer: ScaffoldWriter,
): IScaffoldConnector[] {
  const configPath = path.join(projectRoot, "nodefony.config.ts");
  if (!writer.exists(configPath)) return [];
  const source = writer.read(configPath);
  const asDialect = (value: string | undefined): TEntityDialect =>
    (ENTITY_DIALECTS as readonly string[]).includes(value ?? "")
      ? (value as TEntityDialect)
      : "sqlite";

  const connectors: IScaffoldConnector[] = [];
  const block = extractBlock(source, "connectors");
  if (block !== null) {
    // On s'appuie sur la forme `<nom>: { … dialect: "x" }` DANS le bloc, borné
    // par son accolade appariée. Une analyse syntaxique complète du TypeScript
    // n'est pas le métier d'un scaffold — et le dialecte retenu est annoncé.
    const entry = /(\w+)\s*:\s*\{([^{}]*)\}/gu;
    let match: RegExpExecArray | null;
    while ((match = entry.exec(block)) !== null) {
      const [, name, body] = match;
      if (!name) continue;
      connectors.push({
        name,
        dialect: asDialect(
          /dialect\s*:\s*["'](\w+)["']/u.exec(body ?? "")?.[1],
        ),
      });
    }
  }
  if (connectors.length > 0) return connectors;
  // Aucun connecteur déclaré : le module ORM en fournit un, nommé `default`.
  // On expose CELUI-LÀ plutôt qu'une liste vide — c'est celui que l'application
  // utilise réellement, et une liste vide ferait croire qu'il n'y a rien à choisir.
  return [
    {
      name: "default",
      dialect: asDialect(/dialect\s*:\s*["'](\w+)["']/u.exec(source)?.[1]),
    },
  ];
}

/**
 * Entités déjà déclarées dans une cible, lues au disque.
 *
 * Sert à transformer `ref:` d'un texte libre en un CHOIX : le formulaire de
 * Studio comme le dialogue du terminal peuvent proposer ce qui existe vraiment,
 * au lieu de laisser deviner un nom qui fera échouer le démarrage.
 */
function readEntities(targetDir: string, writer: ScaffoldWriter): string[] {
  const dir = path.join(targetDir, "nodefony", "entity");
  if (!writer.exists(dir)) return [];
  return writer
    .listDir(dir)
    .filter(
      (file) =>
        !file.isDirectory &&
        file.name.endsWith(".ts") &&
        !file.name.endsWith(".schema.ts"),
    )
    .map((file) => file.name.slice(0, -".ts".length))
    .sort();
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

  // `drizzle-orm` est une dépendance DE L'APPLICATION : l'entité produite ici
  // importe `drizzle-orm/<dialecte>-core` en direct. Une app générée avant que le
  // gabarit ne la déclare — ou liée au checkout (`--link`, où npm n'installe rien
  // à la racine de l'app) — compile jusqu'ici puis échoue sur un import
  // introuvable, loin de la cause. On la déclare, et on dit qu'il faut installer.
  const ormRuntimeNote: string[] = [];
  if (!projectDeps.has("drizzle-orm")) {
    const rootManifestPath = path.join(projectRoot, "package.json");
    const rootManifest = JSON.parse(writer.read(rootManifestPath)) as Record<
      string,
      Record<string, string>
    >;
    rootManifest["dependencies"] ??= {};
    rootManifest["dependencies"]["drizzle-orm"] =
      SCAFFOLD_VERSIONS["drizzle-orm"];
    writer.write(
      rootManifestPath,
      `${JSON.stringify(rootManifest, null, 2)}\n`,
    );
    ormRuntimeNote.push(
      `dépendance manquante ajoutée au package.json : drizzle-orm@${SCAFFOLD_VERSIONS["drizzle-orm"]} ` +
        `(l'entité l'importe en direct) → lance \`npm install\` avant de compiler`,
    );
  }

  // `PostEntity` / `Post.ts` → `Post` (le suffixe donné n'est jamais redoublé).
  const base = String(answers.name).replace(/[-_]?[Ee]ntity$/u, "");
  const pascal = toPascalCase(base);
  // Le registre ORM est PLAT : une entité du même nom qu'un module déjà chargé le
  // dépossède. La panne ne survient qu'au démarrage suivant, dans une requête du
  // module victime, sous la forme d'une colonne inconnue — rien ne pointe le
  // doublon. Refuser ici, en nommant le propriétaire et l'issue.
  const reserved = findReservedEntity(pascal);
  if (reserved) {
    throw new Error(
      `create entity ${pascal} : ce nom appartient au module « ${reserved.module} » ` +
        `(entité « ${reserved.name} ») — deux entités du même nom ne cohabitent pas dans ` +
        `le registre ORM, et l'application ne démarrerait plus.\n  → ${reserved.advice}`,
    );
  }
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  const kebab = toKebabCase(base);
  // Nom SQL de la table : le pluriel du nom de l'entité, sauf si une table
  // EXISTANTE impose le sien. Les noms d'index en dérivent (`<table>_<cols>_idx`),
  // donc ils suivent sans qu'on ait à le dire.
  const tableAnswer = String(answers.table ?? "").trim();
  const table = tableAnswer
    ? assertSqlName(tableAnswer, "--table")
    : tableName(pascal);
  // Casse des colonnes et nom de la clé primaire — la PROPRIÉTÉ TypeScript ne bouge
  // dans aucun des deux cas : le service CRUD, le controller et les tests générés
  // nomment `id` et `siteId`, quel que soit le nom que porte la colonne en base.
  const columnCase = String(answers.columnCase ?? "camel") as TColumnCase;
  if (!(COLUMN_CASES as readonly string[]).includes(columnCase)) {
    throw new Error(
      `--column-case invalide « ${columnCase} » — attendus : ${COLUMN_CASES.join(" | ")}`,
    );
  }
  const idName = assertSqlName(
    String(answers.idName ?? "id").trim() || "id",
    "--id-name",
  );

  // Le connecteur est résolu AVANT le dialecte : c'est LUI qui décide du moteur.
  // Sans cela, une entité posée sur un second connecteur héritait du dialecte du
  // premier — une table PostgreSQL générée en SQLite, sans un mot.
  const connector = String(answers.connector || "default");
  const dialect =
    (String(answers.dialect || "") as TEntityDialect) ||
    detectDialect(projectRoot, writer, connector);
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
  // Une entité sans champ produit un CRUD qui « marche » et ne sert à rien : une
  // table réduite à sa clé primaire, un schéma Zod vide qui accepte tout, des
  // routes qui ne transportent rien. C'est un oubli dans presque tous les cas, et
  // le refus coûte moins cher que le détour par cinq fichiers à jeter.
  if (fields.length === 0) {
    throw new Error(
      `create entity ${pascal} : aucun champ déclaré — passe-les en arguments ` +
        `(ex : nodefony create entity ${pascal} title:string! body:text? views:int=0)`,
    );
  }
  const timestamps = answers.timestamps !== false;
  const softDelete = answers.softDelete === true;
  // Index de TABLE : les seuls capables de porter plusieurs colonnes, donc les
  // seuls qui expriment la façon dont une table réelle est interrogée. Analysés
  // APRÈS les champs, dont ils empruntent les noms pour se valider.
  const toList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map(String)
      : typeof value === "string" && value.length > 0
        ? [value]
        : [];
  const indexes = [
    ...parseEntityIndexes(toList(answers.index), fields, {
      timestamps,
      softDelete,
    }),
    ...parseEntityIndexes(
      toList(answers.uniqueIndex),
      fields,
      { timestamps, softDelete },
      true,
    ),
  ];
  const codegen = buildEntityCodegen(fields, {
    dialect,
    id,
    timestamps,
    softDelete,
    table,
    indexes,
    columnCase,
    idName,
  });

  // Colonnes qu'un client a le droit de trier. Une allowlist, pas la liste des
  // champs : un tri libre laisse le client nommer n'importe quelle colonne, et
  // l'ORM lève sur un nom inconnu — un 500 offert à qui tape au hasard. Le JSON
  // en est exclu (aucun ordre naturel, et les moteurs divergent).
  const sortable = [
    "id",
    ...fields.filter((f) => f.type !== "json").map((f) => f.name),
    ...(timestamps ? ["createdAt", "updatedAt"] : []),
  ];
  // Tri PAR DÉFAUT — une liste sans ordre déterministe rend la pagination fausse
  // par intermittence : deux pages consécutives peuvent montrer la même ligne, ou
  // en sauter une, sans que rien ne le signale. `id` départage les ex æquo (uuid7
  // est chronologique, serial est croissant : dans les deux cas l'ordre est stable).
  const defaultOrder = timestamps
    ? '[["createdAt", "DESC"], ["id", "DESC"]]'
    : '[["id", "DESC"]]';
  // Relations déclarées — nourrissent `defineEntity({ relations })` (ERD Studio et
  // eager-load les consomment déjà) et l'allowlist d'`?include=` du controller.
  // Une relation vers une entité absente n'est pas une imprécision : l'ORM la
  // résout au moment de se connecter et LÈVE. L'application ne démarrerait pas,
  // avec un message qui parle de registre d'entités et pas du champ fautif. On
  // refuse ici, tant qu'on peut encore nommer la cause et la solution.
  for (const field of fields) {
    if (field.type !== "ref" || !field.target) continue;
    const targetFile = path.join(
      target.dir,
      "nodefony",
      "entity",
      `${field.target}.ts`,
    );
    if (!writer.exists(targetFile)) {
      throw new Error(
        `create entity ${pascal} : la relation « ${field.name}:ref:${field.target} » ` +
          `vise une entité qui n'existe pas dans ${target.name} — crée-la d'abord ` +
          `(nodefony create entity ${field.target} …), puis relance`,
      );
    }
  }

  const relations = fields
    .filter((f) => f.type === "ref" && f.target)
    .map((f) => ({
      field: f.name,
      target: f.target as string,
      // Le champ porte la clé étrangère → c'est le côté « plusieurs » du lien.
      type: "many-to-one" as const,
      // `foreignKey` est écrit EXPLICITEMENT, jamais laissé à la dérivation :
      // l'adapter déduirait `<cible>Id` (`userId` pour `target: "User"`) alors
      // que la colonne porte le nom du CHAMP (`author:ref:User` → colonne
      // `author`). Une relation dérivée pointerait une colonne inexistante.
      foreignKey: f.name,
    }));

  const route = String(answers.route) || `/api/${pluralize(kebab)}`;

  // Exemple de charge utile — un exemple faux serait pire que pas d'exemple.
  // Deux formes, pour deux usages :
  //  - `curlBody` : JSON figé, collé dans le `curl` de la documentation ;
  //  - `sampleFactory` : fabrique paramétrée par un entier, utilisée par les tests.
  //    Elle est indispensable dès qu'un champ est UNIQUE : deux insertions du même
  //    échantillon violeraient la contrainte, et le test généré échouerait sur
  //    lui-même (vécu).
  //
  // Les deux formes sortent de {@link sampleValue}, et c'est le point : elles
  // doivent obéir au MÊME schéma de validation que l'entité. Un échantillon qui
  // le viole produit un test généré rouge à la naissance — vécu trois fois, sur
  // trois types différents, chacun ajouté après coup.
  const sample: Record<string, unknown> = {};
  const factory: string[] = [];
  for (const f of fields) {
    if (f.nullable) continue;
    const { fixed, expr } = sampleValue(f, id);
    sample[f.name] = fixed;
    factory.push(`${f.name}: ${expr}`);
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
    // Un champ dont la valeur voyage telle quelle en JSON ET varie d'un
    // échantillon à l'autre : le test HTTP généré compare ce qu'il a envoyé à ce
    // qu'il relit. Sont exclus les dates (envoyées en `Date`, relues en chaîne
    // ISO — l'égalité serait fausse pour une bonne raison) et les énumérations
    // (valeur constante : comparer deux fois la même chose ne prouve rien).
    comparableField:
      fields.find(
        (f) =>
          !f.nullable &&
          f.type !== "date" &&
          f.type !== "json" &&
          f.type !== "ref" &&
          f.type !== "enum",
      )?.name ?? null,
    // Sans champ unique, aucun doublon n'est possible : le cas 409 n'existe pas
    // pour cette entité, et un test qui l'attendrait échouerait à jamais.
    hasUnique: fields.some((f) => f.unique),
    // Entités visées par les relations — le test généré doit les enregistrer,
    // sinon l'ORM lève en résolvant les relations au moment de se connecter.
    relationTargets: [
      ...new Set(
        fields
          .filter((f) => f.type === "ref" && f.target)
          .map((f) => f.target as string),
      ),
    ],
    timestamps,
    softDelete,
    sortable,
    defaultOrder,
    relations,
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
    ...ormRuntimeNote,
    `table ${table} (${dialect}) — créée au prochain boot en développement`,
    `⚠ modifier l'entité ensuite n'altère PAS la table (pas d'ALTER en dev) — supprime la base de dev, ou passe par une migration`,
    `⚠ production : aucune migration générée (orm:migrate n'existe pas encore)`,
  ];
  if (controller) {
    notes.push(
      `REST ${route} (GET liste paginée/POST) · ${route}/{id} (GET/PUT/PATCH/DELETE) — les lectures répondent AUSSI par la socket`,
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
/**
 * Position d'insertion devant la classe `… extends Module` — décorateurs de
 * classe COMPRIS, puisque `@entities([…])` doit se poser au-dessus d'eux.
 *
 * Volontairement PAS une expression régulière. Le motif naturel
 * (`(?:@\w+\([\s\S]*?\)\s*)*class …`) est ambigu — le contenu paresseux d'un
 * décorateur peut se découper de plusieurs façons entre deux itérations — donc
 * exponentiel au backtracking : mesuré ici, 26 décorateurs sans classe à trouver
 * coûtaient 636 ms, et chaque paire supplémentaire multipliait par ~3,5. Or le
 * pire cas EST le cas d'échec prévu par l'appelant (ancre introuvable) : la
 * commande figeait au lieu de rendre son geste manuel.
 *
 * Le balayage ci-dessous remonte les décorateurs un par un en appariant les
 * parenthèses — linéaire, et correct sur un décorateur qui en contient
 * lui-même (`@entities([defineEntity(x)])`).
 *
 * @param source - contenu de l'`index.ts` de la cible.
 * @returns l'index d'insertion, ou `undefined` si aucune classe `extends Module`.
 */
export function findModuleClassAnchor(source: string): number | undefined {
  const match = /^class\s+\w+\s+extends\s+Module\b/mu.exec(source);
  if (!match || match.index === undefined) {
    return undefined;
  }
  let at = match.index;
  for (;;) {
    // Blancs qui séparent le décorateur de ce qui le suit.
    let end = at - 1;
    while (end >= 0 && /\s/u.test(source[end])) {
      end--;
    }
    if (end < 0 || source[end] !== ")") {
      return at;
    }
    // Parenthèse ouvrante APPARIÉE (un décorateur peut en contenir).
    let depth = 0;
    let open = end;
    for (; open >= 0; open--) {
      const char = source[open];
      if (char === ")") {
        depth++;
      } else if (char === "(") {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    if (open < 0) {
      return at; // parenthèses non appariées → on ne remonte pas plus haut
    }
    // `@nom` collé à l'ouvrante, sinon ce n'est pas un décorateur.
    let name = open - 1;
    while (name >= 0 && /[\w.]/u.test(source[name])) {
      name--;
    }
    if (name < 0 || source[name] !== "@" || name === open - 1) {
      return at;
    }
    at = name;
  }
}

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
  const anchorAt =
    anchorRe.exec(source)?.index ?? findModuleClassAnchor(source);
  if (anchorAt === undefined) {
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
  const shiftedAt =
    anchorRe.exec(withImports)?.index ?? findModuleClassAnchor(withImports);
  if (shiftedAt === undefined) {
    throw new Error(
      `point d'insertion perdu dans ${indexPath} — ajoute à la main :\n${manual}`,
    );
  }
  const wired =
    withImports.slice(0, shiftedAt) +
    `@entities([${className}])\n` +
    withImports.slice(shiftedAt);
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
    // Nom de l'entry Vite (même clé que `create app` — le registrar est partagé).
    entryName: kebab,
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
  // Même déclaration d'entry que `create app` (source unique).
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "shared", "front-registrar"),
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
  // Même point de montage que `create app` (source unique).
  renderLayer(
    eta,
    path.join(packageRoot, "templates", "shared", "front-entry", frontend),
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
