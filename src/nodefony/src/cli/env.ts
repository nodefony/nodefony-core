import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { pathToFileURL } from "node:url";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import {
  appEnvironment,
  configInconsistencies,
} from "../kernel/checks/projectScope";
import {
  declaredModuleEntries,
  type IDeclaredModule,
} from "../kernel/checks/readiness";
import {
  diskManifestReader,
  readManifestCode,
} from "../kernel/checks/sourceText";
import { envFileOrder } from "../runtime/loadEnv";
import { renderEnvExample } from "../config/envExample";
import {
  envVarPlacement,
  getEnvCatalog,
  type NamedEnvVarMeta,
} from "../config/defineEnv";
import { frameworkEnvCatalog } from "../config/reservedEnv";
import { stripGlobalCliFlags } from "./globalFlags";
import { collectEnvShortcuts } from "../config/envShortcuts";
import {
  CONFIG_SCHEMA_EXPORT,
  CONFIG_SCHEMA_FIELD,
  declaredPackageEntry,
  resolveInside,
} from "./packageManifest";
import { renderEnvReport } from "./envRender";
import { isTerminal } from "../runtime/isTerminal";
import { shouldColorize, usableWidth } from "../kernel/checks/report";
import {
  buildEnvReport,
  type IEnvFileInput,
  type IEnvReport,
  type IModuleShortcut,
} from "./envReport";

/**
 * `nodefony env [--json]` — dit TOUT de l'environnement d'une application :
 * quels fichiers sont lus et dans quel ordre, quelles variables sont déclarées,
 * quelle valeur est effective, d'OÙ elle vient, et ce qui est ignoré.
 *
 * Pourquoi une commande à part, et non un sujet d'`inspect` : `inspect`
 * interroge une application BOOTÉE (routes, services, configuration résolue).
 * Or on cherche une variable d'environnement précisément quand l'application
 * NE démarre pas — variable requise manquante, valeur qui ne prend pas, fichier
 * qu'on croit lu. Cette commande est donc standalone, comme `status` et `check` :
 * elle ne lit que des fichiers, et répond même sur une application cassée.
 *
 * Ce qu'elle répare : le chargement `loadEnv` est correct mais INVISIBLE. Un
 * agent, comme un humain, ne pouvait que le deviner, et deviner produit toujours
 * la même erreur : poser la variable dans `.env` alors que le shell en pose déjà
 * une, puis conclure que « ça ne marche pas ».
 */

/** Ce que la ligne de commande demande. */
interface IEnvRequest {
  json: boolean;
  /** `--example` : générer/vérifier `.env.example` au lieu du rapport. */
  example: boolean;
  /** `--check` : ne rien écrire, échouer si `.env.example` diverge. */
  check: boolean;
  /** Racine de recherche (défaut : le cwd). */
  cwd: string;
  /**
   * `--env <e>` : évaluer les exigences sous CET environnement plutôt que celui
   * d'ici. Les valeurs restent celles de la machine — on ne simule pas un
   * déploiement, on demande « qu'est-ce qui manquera là-bas ? ».
   */
  targetEnv: string | null;
  /** `true` si l'on veut seulement la page d'aide. */
  help: boolean;
}

/** Parse l'argv après le mot `env`. */
export function parseEnvArgv(argv: string[]): IEnvRequest | { error: string } {
  const at = argv.indexOf("env");
  const rest = stripGlobalCliFlags(at === -1 ? [] : argv.slice(at + 1));
  let json = false;
  let example = false;
  let check = false;
  let cwd = process.cwd();
  let targetEnv: string | null = null;
  let help = false;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--help" || word === "-h") {
      // Une commande qui répond « option inconnue : --help » apprend au
      // lecteur à ne plus croire le pied de l'aide, qui promet ce drapeau.
      help = true;
    } else if (word === "--json" || word === "-j") {
      json = true;
    } else if (word === "--example") {
      example = true;
    } else if (word === "--check") {
      check = true;
    } else if (word === "--cwd") {
      cwd = path.resolve(rest[++i] ?? "");
    } else if (word === "--env") {
      const value = rest.at(++i);
      // Un `--env` sans valeur avalerait l'option suivante et évaluerait sous
      // un environnement nommé « --json » : autant le refuser tout de suite.
      if (value === undefined || value.startsWith("-")) {
        return {
          error: "--env attend un environnement (ex. --env production)",
        };
      }
      targetEnv = value;
    } else {
      return { error: `option inconnue : ${word}` };
    }
  }
  // Le contrôle de cohérence ne vaut PAS contre `--help` : demander l'aide
  // d'une commande dont on ne connaît pas encore les combinaisons valides ne
  // doit jamais rendre un refus.
  if (check && !example && !help) {
    return { error: "--check n'a de sens qu'avec --example" };
  }
  return { json, example, check, cwd, targetEnv, help };
}

/** La page d'aide — `nodefony env --help`, et le rappel après un refus. */
export const ENV_USAGE: IUsagePage = {
  command: "nodefony env",
  tagline:
    "le fichier .env lu, la valeur effective de chaque variable, " +
    "et d'où elle vient",
  synopsis: [
    "nodefony env [--json] [--env <e>] [--cwd <chemin>]",
    "nodefony env --example [--check] [--cwd <chemin>]",
  ],
  sections: [
    {
      title: "CE QU'ELLE MONTRE",
      paragraph:
        "L'ordre dans lequel les fichiers .env sont lus, les variables que " +
        "l'application DÉCLARE, la valeur retenue pour chacune et SA " +
        "PROVENANCE — puis ce qui est présent dans l'environnement et que " +
        "personne ne lit. Elle ne démarre pas l'application : on cherche une " +
        "variable précisément quand celle-ci ne démarre PAS, et la faire " +
        "booter la rendrait muette au seul moment où elle sert.",
    },
  ],
  options: [
    { term: "-j, --json", text: "la même réponse, exploitable par un script" },
    {
      term: "--env <e>",
      text:
        "évalue les exigences sous CET environnement (ex. production) depuis " +
        "ce poste — les valeurs restent celles d'ici",
    },
    {
      term: "--example",
      text: "dérive .env.example du catalogue déclaré dans env.ts",
    },
    {
      term: "--check",
      text:
        "avec --example : vérifie sans écrire, et sort en erreur si le " +
        "fichier diverge (pre-commit, intégration continue)",
    },
    {
      term: "--cwd <chemin>",
      text: "point de départ (la racine de l'app est résolue en remontant)",
    },
  ],
  examples: [
    { term: "nodefony env", text: "l'environnement d'ici, en entier" },
    {
      term: "nodefony env --env production",
      text: "ce qui manquera là-bas, sans y aller",
    },
    {
      term: "nodefony env --example --check",
      text: "le .env.example est-il encore à jour ?",
    },
  ],
  exitCodes: [
    { term: "66", text: "aucune application ici (EX_NOINPUT)" },
    {
      term: "78",
      text:
        "une variable requise manque, ou .env.example diverge sous --check " +
        "(EX_CONFIG)",
    },
  ],
};

/**
 * Lit les fichiers chargés — la LISTE vient de `envFileOrder`,
 * jamais d'une copie locale : afficher un ordre qui différerait de celui
 * réellement appliqué tromperait sur le seul point qu'on vient vérifier.
 */
function readLevels(
  cwd: string,
  runtimeEnv: string,
  appEnv: string | null,
): IEnvFileInput[] {
  const wanted = envFileOrder({
    runtimeEnv,
    ...(appEnv ? { appEnv } : {}),
  });
  return wanted.map((source) => {
    try {
      return {
        source,
        vars: parseEnv(readFileSync(path.join(cwd, source), "utf8")) as Record<
          string,
          string
        >,
      };
    } catch {
      return { source, vars: null };
    }
  });
}

/**
 * Catalogue des variables déclarées par l'application.
 *
 * Il vit dans `env.ts`, réexporté par l'`index.ts` de l'app — donc lisible en
 * important son build. Pas de build, pas d'export `env` : on rend `null` plutôt
 * que d'échouer, et le rapport le DIT. Une commande de diagnostic qui refuse de
 * répondre quand le projet va mal est une commande inutile.
 */
async function readCatalog(
  projectRoot: string,
): Promise<readonly NamedEnvVarMeta[] | null> {
  // La SOURCE d'abord : Node (≥ 24 chez Nodefony) importe un `env.ts` erasable
  // nativement, et `env.ts` importe "nodefony" — résolu vers la MÊME instance
  // de module que ce CLI (même chemin réel), donc le symbole du catalogue est
  // reconnu. C'est ce qui rend `--example --check` honnête en pre-commit : un
  // `env.ts` modifié se voit IMMÉDIATEMENT, quand le build, lui, peut être en
  // retard d'un commit — un gate qui compare à un vieux dist dirait vert sur
  // une dérive réelle. Le dist reste le REPLI (Node plus ancien, TS non
  // erasable).
  for (const candidate of [
    path.join(projectRoot, "env.ts"),
    path.join(projectRoot, "dist", "index.js"),
  ]) {
    try {
      const mod = (await import(pathToFileURL(candidate).href)) as {
        env?: unknown;
      };
      if (mod.env === undefined) continue;
      const catalog = getEnvCatalog(mod.env);
      if (catalog.length > 0) return catalog;
    } catch {
      // Candidat illisible (absent, Node sans strip-types, pas de build) : le
      // suivant tentera — et `null` final le DIT à l'appelant.
    }
  }
  return null;
}

/** Un module dont on n'a pas pu lire les réglages, et pourquoi. */
export interface IUnreadableModule {
  module: string;
  reason: string;
}

/**
 * Les raccourcis d'environnement que déclarent les schémas des modules de
 * l'application (`.meta({ env })`), lus SANS démarrer l'application.
 *
 * Le module DÉCLARE où vit son schéma — `package.json` →
 * `"nodefony": { "configSchema": "./dist/…" }`, un fichier qui exporte
 * `configJsonSchema()` et n'importe que le schéma. Rien n'est deviné : un
 * paquet tiers range ses fichiers comme il veut, et seul ce qu'il déclare
 * l'engage. Un module qui ne déclare rien ne propose pas de nom court — c'est
 * normal, pas une erreur.
 *
 * Tout ce qui empêche de lire un schéma DÉCLARÉ est nommé, jamais tu : sans
 * schéma, les variables du module ressortiraient « lues par personne ».
 *
 * @param projectRoot - racine de l'application.
 * @returns les raccourcis trouvés, et les modules illisibles avec leur raison.
 */
export async function readModuleShortcuts(
  projectRoot: string,
): Promise<{ shortcuts: IModuleShortcut[]; unreadable: IUnreadableModule[] }> {
  const shortcuts: IModuleShortcut[] = [];
  const unreadable: IUnreadableModule[] = [];
  for (const { name, condition } of readManifestEntries(projectRoot) ?? []) {
    const dir = path.join(projectRoot, "node_modules", ...name.split("/"));
    const declared = declaredPackageEntry(dir, CONFIG_SCHEMA_FIELD);
    if (declared === null) continue;
    let file: string;
    try {
      file = resolveInside(dir, declared.replace(/^\.\//u, ""));
    } catch (e) {
      unreadable.push({
        module: name,
        reason: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    if (!existsSync(file)) {
      unreadable.push({
        module: name,
        reason: `non construit — ${declared} absent (npm run build)`,
      });
      continue;
    }
    try {
      const mod: unknown = await import(pathToFileURL(file).href);
      const producer: unknown =
        typeof mod === "object" && mod !== null
          ? Reflect.get(mod, CONFIG_SCHEMA_EXPORT)
          : undefined;
      if (typeof producer !== "function") {
        unreadable.push({
          module: name,
          reason: `${declared} n'exporte pas ${CONFIG_SCHEMA_EXPORT}()`,
        });
        continue;
      }
      const schema: unknown = Reflect.apply(producer, undefined, []);
      for (const s of collectEnvShortcuts(schema)) {
        shortcuts.push(
          condition === null
            ? { ...s, module: name }
            : { ...s, module: name, condition },
        );
      }
    } catch (e) {
      unreadable.push({
        module: name,
        reason: `lecture de ${declared} impossible (${e instanceof Error ? e.message : String(e)})`,
      });
    }
  }
  return { shortcuts, unreadable };
}

/** Nom et version de l'application, pour l'en-tête — `null` si illisible. */
function readAppIdentity(
  projectRoot: string,
): { name: string; version?: string } | null {
  try {
    const pkg: unknown = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    );
    if (typeof pkg !== "object" || pkg === null) return null;
    const name: unknown = Reflect.get(pkg, "name");
    const version: unknown = Reflect.get(pkg, "version");
    if (typeof name !== "string") return null;
    return typeof version === "string" ? { name, version } : { name };
  } catch {
    return null;
  }
}

/**
 * Commande `nodefony env` — orchestre : résout le projet, lit `.env` et le
 * catalogue, délègue le calcul au module pur, rend.
 *
 * @returns exit code sémantique (`OK`, `USAGE`, `CONFIG` si une requise manque)
 */
/**
 * Compose le rapport d'environnement d'un projet — la MÊME donnée pour tous ses
 * lecteurs.
 *
 * Extraite de {@link runEnvCommand} pour que `nodefony doctor` puisse dire « il
 * manque une variable REQUISE » sans réimplémenter le chargement : deux définitions
 * de « quelle valeur est effective » divergeraient, et chacune passerait ses
 * propres tests. Le second lecteur ne rend d'ailleurs pas le rapport, il n'en
 * lit que les manquantes — raison de plus pour qu'il ne le RECALCULE pas.
 *
 * @param projectRoot - racine de l'application, ou `null` hors projet (le
 *   catalogue des variables déclarées est alors inconnu : il se lit dans le
 *   `dist/` de l'application).
 * @param cwd - dossier de départ, utilisé comme racine hors projet.
 * @returns le rapport complet (fichiers lus, variables, provenance, notes).
 */
export async function buildProjectEnvReport(
  projectRoot: string | null,
  cwd: string,
  targetEnv: string | null = null,
): Promise<IEnvReport> {
  const runtimeEnv = process.env.NODE_ENV ?? "development";
  const rawAppEnv = process.env.APP_ENV ?? process.env.NF_ENV ?? null;
  const appEnv = rawAppEnv && rawAppEnv !== runtimeEnv ? rawAppEnv : null;
  const root = projectRoot ?? cwd;
  // Ce que l'état du projet CONTREDIT. Le calcul est celui du vérificateur,
  // APPELÉ et non recopié : deux implémentations de « ce dialecte est-il
  // cohérent ? » rendraient des verdicts différents sur le même projet.
  // Il lit le disque, donc il se fait ICI — `buildEnvReport` reste pure.
  const inconsistencies = configInconsistencies({
    cwd: root,
    ...(projectRoot ? { projectRoot } : {}),
  });
  const modules = projectRoot
    ? await readModuleShortcuts(projectRoot)
    : { shortcuts: [], unreadable: [] };
  const report = buildEnvReport({
    inconsistencies,
    moduleSettings: modules.shortcuts,
    runtimeEnv,
    appEnv,
    targetEnv,
    // L'environnement de l'application de `root`, pas celui du processus : ce
    // dernier porte le `.env` du dossier où la commande a été tapée — rien
    // depuis un sous-dossier, celui d'un AUTRE projet avec `--cwd`.
    processEnv: appEnvironment(root),
    // Le fichier lu reste celui d'ici : viser un autre environnement ne fait pas
    // lire ce qui n'est pas sur cette machine. Ce que la commande répond, c'est
    // « avec ce que j'ai sous la main, qu'est-ce qui manquera là-bas ? ».
    files: readLevels(root, runtimeEnv, appEnv),
    catalog: projectRoot ? await readCatalog(projectRoot) : null,
  });
  for (const u of modules.unreadable) {
    report.notes.push(
      `réglages de ${u.module} illisibles : ${u.reason} — ses noms courts ressortent « lus par personne » tant que ce n'est pas réglé`,
    );
  }
  return report;
}

/**
 * En-tête GÉNÉRIQUE du `.env.example` d'une application — le même pour le dépôt
 * self-hosted et pour toute application générée : la règle des fichiers
 * d'environnement ne dépend pas du projet. Un projet peut le remplacer par un
 * `.env.example.head` (cf {@link readExampleHeader}).
 */
const EXAMPLE_HEADER = `# ══════════════════════════════════════════════════════════════════════
#  .env.example — la NOTICE des variables d'environnement
# ══════════════════════════════════════════════════════════════════════
#
#  Commitée, jamais lue au démarrage, aucun secret.
#
#  Pour démarrer :
#
#    cp .env.example .env
#
#  puis, dans .env, retire le « # » devant ce dont tu as besoin.
#
#    .env         TES valeurs, sur ton poste. JAMAIS commité.
#    production   aucun fichier : l'hébergeur fournit les variables.
#
#  Une variable posée dans le terminal l'emporte sur .env.
#  Ce que l'application lit vraiment, et d'où :  npx nodefony env
#
#  Sous chaque variable :
#    @required / @optional   faut-il la poser ?
#    @requiredWhen           exigée sous condition : sans elle, refus de démarrer
#    @sensitive              c'est un secret : jamais dans git
#    @placement              où la poser en production :
#                              platform     variables du déploiement (hébergeur)
#                              secrets      gestionnaire de secrets
#                              workstation  le poste seulement, sans objet en prod
#    @default                ce qui s'applique si tu ne poses rien
#
#  Avancé : NF__<MODULE>__<CHEMIN>=valeur règle n'importe quelle clé de
#  configuration ; <NOM>_FILE=/chemin lit un secret monté (Docker, k8s).
#
#  ⚙️  Généré depuis env.ts — ne pas éditer à la main :
#      npx nodefony env --example`;

/**
 * Compose le contenu de `.env.example` d'une application — PUR.
 *
 * Le catalogue de l'application d'abord, puis les réglages du FRAMEWORK
 * qu'elle ne déclare pas elle-même ({@link frameworkEnvCatalog}) : une
 * variable lue par le framework se pose comme une autre, la notice doit donc
 * la nommer. Une variable que l'application redéclare garde SA déclaration.
 *
 * @param catalog - catalogue des variables (via `getEnvCatalog`).
 * @param customHeader - en-tête du projet (`.env.example.head`), sinon le générique.
 * @param modules - modules du manifeste (cf {@link readManifestModules}) ;
 *   `null` nomme les réglages de tous les modules.
 * @returns le texte complet du fichier.
 */
export function composeEnvExample(
  catalog: readonly NamedEnvVarMeta[],
  customHeader: string | null = null,
  modules: readonly string[] | null = null,
  moduleSettings: readonly IModuleShortcut[] = [],
): string {
  const names = new Set(catalog.map((v) => v.name));
  const framework = frameworkEnvCatalog(modules).filter(
    (v) => !names.has(v.name),
  );
  // Les réglages que les schémas des modules déclarent (`.meta({ env })`) :
  // leur titre, leur défaut et leur description viennent du schéma, aucune
  // copie n'est tenue ici.
  const fromModules = moduleSettings
    .filter((m) => !names.has(m.env))
    // oxlint-disable-next-line no-map-spread -- objet CONSTRUIT champ par champ ; le seul spread est un littéral conditionnel, forme imposée par `exactOptionalPropertyTypes`
    .map((m): NamedEnvVarMeta => ({
      name: m.env,
      kind:
        m.kind === "enum"
          ? "enum"
          : m.kind === "integer" || m.kind === "number"
            ? "number"
            : m.kind === "boolean"
              ? "boolean"
              : "string",
      ...(m.values ? { values: m.values } : {}),
      optional: true,
      section: `Module ${m.module}`,
      title: `${m.module} — ${m.path.join(".")}`,
      ...(m.description ? { description: m.description } : {}),
      defaultNote:
        m.default === undefined
          ? "aucun"
          : m.secret
            ? "défini par le module"
            : typeof m.default === "string"
              ? m.default
              : JSON.stringify(m.default),
      // La règle de l'application (`envVarPlacement`) : le schéma décide,
      // sinon un secret va au gestionnaire de secrets, le reste à la plateforme.
      placement: envVarPlacement({
        name: m.env,
        sensitive: m.secret,
        ...(m.placement ? { placement: m.placement } : {}),
      }),
      sensitive: m.secret,
    }));
  return renderEnvExample([...catalog, ...framework, ...fromModules], {
    header: customHeader ?? EXAMPLE_HEADER,
  });
}

/**
 * Les briques que déclare le manifeste de l'application — racine et
 * fragments, `use("…")` et chaîne nue —, avec ce qui borne leur chargement,
 * lues sans l'évaluer (cf {@link declaredModuleEntries}). `null` si le
 * manifeste est illisible : la notice nomme alors les réglages de tous les
 * modules plutôt que d'en taire un.
 *
 * @param projectRoot - racine de l'application.
 * @returns les briques déclarées, ou `null`.
 */
export function readManifestEntries(
  projectRoot: string,
): IDeclaredModule[] | null {
  const code = readManifestCode(projectRoot, diskManifestReader);
  return code === "" ? null : declaredModuleEntries(code);
}

/**
 * Les NOMS des briques déclarées — projection de {@link readManifestEntries}.
 *
 * @param projectRoot - racine de l'application.
 * @returns les noms déclarés, ou `null`.
 */
export function readManifestModules(projectRoot: string): string[] | null {
  return readManifestEntries(projectRoot)?.map((e) => e.name) ?? null;
}

/**
 * L'en-tête curé du projet, s'il en a un — convention `.env.example.head` à la
 * racine (versionné). Il PRIME sur l'en-tête générique : un projet qui a écrit
 * son onboarding le garde, le corps reste dérivé du catalogue dans tous les
 * cas. C'est ce qui a permis au dépôt self-hosted de MIGRER de son script
 * `gen-env-example.ts` vers cette commande sans perdre sa prose.
 *
 * @param projectRoot - racine de l'application.
 * @returns le contenu du fichier, ou `null` s'il n'existe pas.
 */
export function readExampleHeader(projectRoot: string): string | null {
  try {
    return readFileSync(
      path.join(projectRoot, ".env.example.head"),
      "utf8",
    ).trimEnd();
  } catch {
    return null;
  }
}

/**
 * Applique (ou vérifie) le contenu sur le `.env.example` du projet — I/O seul,
 * la composition appartient à {@link composeEnvExample}.
 *
 * Idempotence FORTE : un fichier déjà identique n'est pas réécrit — même
 * doctrine qu'`ai:sync`, un outil qui salit l'horodatage est un outil qu'on
 * hésite à lancer.
 *
 * @param projectRoot - racine de l'application.
 * @param content - contenu attendu, composé en amont.
 * @param check - `true` : ne rien écrire, seulement comparer.
 * @returns `synced` : le fichier correspond (déjà, ou après écriture) ;
 *   `wrote` : une écriture a eu lieu.
 */
export function applyEnvExample(
  projectRoot: string,
  content: string,
  check: boolean,
): { synced: boolean; wrote: boolean } {
  const target = path.join(projectRoot, ".env.example");
  let current: string | null = null;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // Absent : désynchronisé par définition.
  }
  if (current === content) return { synced: true, wrote: false };
  if (check) return { synced: false, wrote: false };
  writeFileSync(target, content, "utf8");
  return { synced: true, wrote: true };
}

export async function runEnvCommand(argv: string[]): Promise<number> {
  const parsed = parseEnvArgv(argv);
  if ("error" in parsed) {
    return printUsageError(ENV_USAGE, parsed.error);
  }
  if (parsed.help) {
    return printUsage(ENV_USAGE);
  }
  const projectRoot = findProjectRoot(parsed.cwd);

  if (parsed.example) {
    // Générer un modèle hors projet n'a pas de sens — contrairement au rapport,
    // qui décrit au moins l'environnement du shell.
    if (projectRoot === null) {
      process.stderr.write(
        `env: aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant).\n`,
      );
      return SysExit.NOINPUT;
    }
    const catalog = await readCatalog(projectRoot);
    if (catalog === null) {
      // Le catalogue se lit dans le build de l'app (cf `readCatalog`) : sans
      // lui, rien à dériver — et le DIRE vaut mieux qu'un fichier vide.
      process.stderr.write(
        `env: catalogue introuvable — l'app n'est pas construite, ou son index\n` +
          `n'exporte pas \`env\` (env.ts). Lancer d'abord : npm run build\n`,
      );
      return SysExit.UNAVAILABLE;
    }
    const { synced, wrote } = applyEnvExample(
      projectRoot,
      composeEnvExample(
        catalog,
        readExampleHeader(projectRoot),
        readManifestModules(projectRoot),
        (await readModuleShortcuts(projectRoot)).shortcuts,
      ),
      parsed.check,
    );
    if (!synced) {
      process.stderr.write(
        `❌ .env.example désynchronisé de env.ts — lancer : npx nodefony env --example\n`,
      );
      return SysExit.CONFIG;
    }
    process.stdout.write(
      `✅ .env.example ${wrote ? "régénéré depuis" : "synchronisé avec"} env.ts ` +
        `(${catalog.length} variable(s))\n`,
    );
    return SysExit.OK;
  }
  const report = await buildProjectEnvReport(
    projectRoot,
    parsed.cwd,
    parsed.targetEnv,
  );
  if (projectRoot === null) {
    report.notes.push(
      "aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant) — " +
        "seul l'environnement du shell est décrit",
    );
  }
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderEnvReport(report, {
          projectRoot,
          app: projectRoot ? readAppIdentity(projectRoot) : null,
          width: usableWidth(process.stdout.columns),
          color: shouldColorize(process.env, isTerminal(process.stdout)),
        }),
  );
  // Une variable requise absente n'est pas un avis : l'application ne démarrera
  // pas. Le code de sortie le dit, pour qu'un script s'arrête là.
  return report.vars.some((v) => v.missing) ? SysExit.CONFIG : SysExit.OK;
}
