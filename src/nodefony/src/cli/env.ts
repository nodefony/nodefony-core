import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { pathToFileURL } from "node:url";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { configInconsistencies } from "../kernel/checks/projectScope";
import { declaredModules } from "../kernel/checks/readiness";
import { envFileOrder } from "../runtime/loadEnv";
import { renderEnvExample } from "../config/envExample";
import { getEnvCatalog, type NamedEnvVarMeta } from "../config/defineEnv";
import { frameworkEnvCatalog } from "../config/reservedEnv";
import { stripGlobalCliFlags } from "./globalFlags";
import {
  buildEnvReport,
  type IEnvFileInput,
  type IEnvReport,
  type IEnvVarReport,
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
const PAGE: IUsagePage = {
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

/** Colonne alignée, sans dépendance de mise en forme. */
const pad = (s: string, n: number): string =>
  s.length >= n ? s : s + " ".repeat(n - s.length);

/**
 * Largeur maximale de la colonne des valeurs : au-delà, la valeur est coupée
 * (`…`) — une URL de 80 caractères repoussait sinon toute la ligne, et la
 * colonne suivante ne s'alignait plus sur rien. La valeur entière reste dans
 * `--json`.
 */
const VALUE_WIDTH = 40;

/** Coupe une valeur trop longue pour sa colonne. */
const clip = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

/** Le nom lisible d'un niveau de la cascade. */
const sourceLabel = (source: string): string =>
  source === "process.env" ? "terminal / orchestrateur" : source;

/** Une ligne du tableau : nom, valeur, provenance, puis remarques. */
interface IRow {
  name: string;
  value: string;
  origin: string;
  notes: string[];
}

/** Rend des lignes alignées sur des colonnes COMMUNES à toute la page. */
function renderRows(rows: IRow[], nameWidth: number): string[] {
  const valueWidth = Math.min(
    VALUE_WIDTH,
    Math.max(0, ...rows.map((r) => r.value.length)),
  );
  const originWidth = Math.max(0, ...rows.map((r) => r.origin.length));
  return rows.map((r) =>
    (
      `  ${pad(r.name, nameWidth)}  ${pad(clip(r.value, valueWidth), valueWidth)}` +
      `  ${pad(r.origin, originWidth)}` +
      (r.notes.length ? `  ${r.notes.join(" · ")}` : "")
    ).trimEnd(),
  );
}

/** Coupe une liste de noms en lignes de largeur bornée. */
function wrapNames(names: string[], width = 76): string[] {
  const lines: string[] = [];
  let line = "";
  for (const n of names) {
    const next = line ? `${line}, ${n}` : n;
    if (next.length > width && line) {
      lines.push(`  ${line},`);
      line = n;
    } else line = next;
  }
  if (line) lines.push(`  ${line}`);
  return lines;
}

/**
 * Ce qu'il faut savoir d'une variable déclarée, hors valeur et provenance :
 * l'exigence (et OÙ elle s'applique), les valeurs admises, les niveaux masqués.
 */
function varNotes(v: IEnvVarReport): string[] {
  const notes: string[] = [];
  if (v.missing) notes.push("REQUISE ET ABSENTE");
  // Dire OÙ elle est exigée, et pas seulement qu'elle l'est : sans ce mot, une
  // variable absente sur un poste de développement se lit comme une panne
  // locale, alors que c'est le déploiement visé qui la réclame.
  else if (v.requiredIn?.length) {
    notes.push(`requise en ${v.requiredIn.join("/")}`);
  }
  if (v.values) notes.push(v.values.join(" | "));
  for (const s of v.shadowed) {
    notes.push(`${sourceLabel(s.source)} l'écrit aussi : ignoré`);
  }
  return notes;
}

/** Une valeur par défaut telle qu'elle s'écrirait dans `.env`. */
const defaultText = (v: IEnvVarReport): string =>
  v.secret
    ? "•••••••• (défaut)"
    : typeof v.default === "string"
      ? v.default
      : JSON.stringify(v.default);

/**
 * Rendu humain du rapport — l'ordre des sections suit l'ordre des questions
 * qu'on se pose : d'où ça vient, ce qui est posé, ce qui s'applique sans
 * l'être, ce qui manque, puis ce qui est SUSPECT.
 *
 * @param report - le rapport calculé par `buildEnvReport`.
 * @param projectRoot - racine de l'application, `null` hors projet.
 * @returns le texte à écrire sur la sortie standard.
 */
export function renderEnvReport(
  report: IEnvReport,
  projectRoot: string | null,
): string {
  const out: string[] = [];
  out.push(
    `\nEnvironnement · mode ${report.runtimeEnv}` +
      (report.appEnv ? ` · déploiement ${report.appEnv}` : "") +
      // L'environnement ÉVALUÉ s'annonce en tête : un rapport qui exige des
      // variables de production sans dire qu'il regarde la production ferait
      // croire à une panne du poste.
      (report.targetEnv
        ? ` · exigences évaluées pour ${report.targetEnv}`
        : "") +
      (projectRoot ? `\n${projectRoot}` : ""),
  );

  const posed = report.vars.filter((v) => v.value !== null);
  const defaulted = report.vars.filter(
    (v) => v.value === null && v.default !== undefined,
  );
  const unset = report.vars.filter(
    (v) => v.value === null && v.default === undefined,
  );
  const tunables = report.reserved.filter((r) => r.tunable);
  const internals = report.reserved.filter((r) => !r.tunable);

  // UNE largeur de nom pour toute la page : des colonnes qui changent de
  // place d'une section à l'autre se lisent comme des tableaux différents.
  const nameWidth = Math.max(
    0,
    ...[...posed, ...defaulted, ...tunables, ...report.unknown].map(
      (v) => v.name.length,
    ),
  );

  // La cascade compte ce que chaque niveau apporte À L'APPLICATION : le
  // terminal porte des dizaines de variables (PATH, HOME…) dont aucune ne la
  // concerne, et ce total ne répondait à aucune question.
  const fromShell = [
    ...report.vars,
    ...report.reserved,
    ...report.unknown,
    ...report.overrides,
  ].filter((v) => v.origin === "process.env").length;
  out.push(`\nSources — la première qui pose une variable gagne`);
  for (const l of report.levels) {
    const count = l.rank === 1 ? fromShell : l.count;
    const state = !l.exists
      ? "absent"
      : `${count} variable${count > 1 ? "s" : ""}`;
    out.push(
      (
        `  ${l.rank}. ${pad(sourceLabel(l.source), 26)} ${pad(state, 14)}` +
        (l.rank === 1 ? "  gagne toujours" : "") +
        (l.skipped ? `  (${l.skipped})` : "")
      ).trimEnd(),
    );
  }

  if (report.vars.length > 0) {
    out.push(
      `\nPosées — ${posed.length} sur ${report.vars.length} variables de l'application (env.ts)`,
    );
    out.push(
      ...renderRows(
        posed.map((v) => ({
          name: v.name,
          value: v.value ?? "",
          origin: sourceLabel(v.origin ?? ""),
          notes: varNotes(v),
        })),
        nameWidth,
      ),
    );
  }
  if (defaulted.length > 0) {
    out.push(`\nNon posées — leur défaut s'applique (${defaulted.length})`);
    out.push(
      ...renderRows(
        defaulted.map((v) => ({
          name: v.name,
          value: defaultText(v),
          origin: "",
          notes: varNotes(v),
        })),
        nameWidth,
      ),
    );
  }
  if (unset.length > 0) {
    out.push(`\nNon posées, sans défaut déclaré (${unset.length})`);
    // Sur une ligne de noms : chacune n'a rien d'autre à dire que son absence,
    // sauf une exigence — qui, elle, se lit à part.
    const quiet = unset.filter((v) => varNotes(v).length === 0);
    out.push(...wrapNames(quiet.map((v) => v.name)));
    const loud = unset.filter((v) => varNotes(v).length > 0);
    out.push(
      ...renderRows(
        loud.map((v) => ({
          name: v.name,
          value: "",
          origin: "",
          notes: varNotes(v),
        })),
        nameWidth,
      ),
    );
  }

  if (tunables.length > 0) {
    out.push(
      `\nRéglages du framework — lus par ses modules, sans passer par env.ts (${tunables.length})`,
    );
    out.push(
      ...renderRows(
        tunables.map((r) => ({
          name: r.name,
          value: r.value,
          origin: sourceLabel(r.origin ?? ""),
          notes: [r.role],
        })),
        nameWidth,
      ),
    );
  }
  if (report.overrides.length > 0) {
    out.push(
      `\nSurcharges de configuration — NF__<MODULE>__<CHEMIN> vise une clé de module`,
    );
    for (const o of report.overrides) {
      out.push(
        `  ${o.envKey}  →  ${o.module}.${o.path.join(".")} = ${o.value}` +
          (o.origin ? `  (${sourceLabel(o.origin)})` : ""),
      );
    }
  }

  if (report.unknown.length > 0) {
    out.push(
      `\n⚠ Lues par PERSONNE — sans effet, faute de frappe probable (${report.unknown.length})`,
    );
    out.push(
      ...renderRows(
        report.unknown.map((u) => ({
          name: u.name,
          value: "",
          origin: sourceLabel(u.origin ?? ""),
          notes: u.suggestion ? [`vouliez-vous dire ${u.suggestion} ?`] : [],
        })),
        nameWidth,
      ),
    );
  }
  if (report.inconsistencies.length > 0) {
    out.push(
      `\n⚠ Valeur prise en compte, mais que l'état du projet contredit — l'application` +
        `\nne fonctionnera pas pour autant`,
    );
    for (const i of report.inconsistencies) {
      out.push(`  ${pad(i.name, nameWidth)}  ${i.message}`);
    }
  }
  if (internals.length > 0) {
    out.push(`\nPosées par le framework lui-même — à ne pas écrire`);
    for (const r of internals) {
      out.push(`  ${pad(r.name, nameWidth)}  ${r.role}`);
    }
  }
  const missing = report.vars.filter((v) => v.missing);
  if (missing.length > 0) {
    out.push(
      `\n⚠ ${missing.length} variable(s) REQUISE(S) manquante(s) — l'application ne démarrera pas :`,
      ...wrapNames(missing.map((v) => v.name)),
    );
  }
  for (const note of report.notes) out.push(`\n⚠ ${note}`);
  out.push("");
  return out.join("\n");
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
  return buildEnvReport({
    inconsistencies,
    runtimeEnv,
    appEnv,
    targetEnv,
    processEnv: process.env,
    // Le fichier lu reste celui d'ici : viser un autre environnement ne fait pas
    // lire ce qui n'est pas sur cette machine. Ce que la commande répond, c'est
    // « avec ce que j'ai sous la main, qu'est-ce qui manquera là-bas ? ».
    files: readLevels(root, runtimeEnv, appEnv),
    catalog: projectRoot ? await readCatalog(projectRoot) : null,
  });
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
): string {
  const names = new Set(catalog.map((v) => v.name));
  const framework = frameworkEnvCatalog(modules).filter(
    (v) => !names.has(v.name),
  );
  return renderEnvExample([...catalog, ...framework], {
    header: customHeader ?? EXAMPLE_HEADER,
  });
}

/**
 * Les modules que déclare le manifeste de l'application (`use("…")` de
 * `nodefony.config.ts`), lus sans l'évaluer — ou `null` s'il est illisible,
 * auquel cas la notice nomme les réglages de tous les modules plutôt que
 * d'en taire un.
 *
 * @param projectRoot - racine de l'application.
 * @returns les noms déclarés, ou `null`.
 */
export function readManifestModules(projectRoot: string): string[] | null {
  try {
    return declaredModules(
      readFileSync(path.join(projectRoot, "nodefony.config.ts"), "utf8"),
    );
  } catch {
    return null;
  }
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
    return printUsageError(PAGE, parsed.error);
  }
  if (parsed.help) {
    return printUsage(PAGE);
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
      : renderEnvReport(report, projectRoot),
  );
  // Une variable requise absente n'est pas un avis : l'application ne démarrera
  // pas. Le code de sortie le dit, pour qu'un script s'arrête là.
  return report.vars.some((v) => v.missing) ? SysExit.CONFIG : SysExit.OK;
}
