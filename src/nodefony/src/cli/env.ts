import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { pathToFileURL } from "node:url";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { envFileOrder } from "../runtime/loadEnv";
import { renderEnvExample } from "../config/envExample";
import { getEnvCatalog, type NamedEnvVarMeta } from "../config/defineEnv";
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
 * Ce qu'elle répare : la cascade `loadEnv` est correcte mais INVISIBLE — elle
 * n'était écrite que dans un commentaire du framework. Un agent, comme un
 * humain, ne pouvait que la deviner, et deviner produit toujours la même erreur :
 * poser la variable dans un fichier de rang inférieur à celui qui la définit
 * déjà, puis conclure que « ça ne marche pas ».
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
      const value = rest[++i];
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
    "la cascade des fichiers .env, la valeur effective de chaque variable, " +
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
 * Lit les niveaux de fichiers de la cascade — l'ORDRE vient de `envFileOrder`,
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

/** Rend une variable : valeur, provenance, et ce qui la rend suspecte. */
function renderVar(v: IEnvVarReport): string {
  const value = v.value === null ? "(absente)" : v.value;
  const origin = v.origin === null ? "" : `← ${v.origin}`;
  const flags: string[] = [];
  if (v.missing) flags.push("REQUISE ET ABSENTE");
  // Dire OÙ elle est exigée, et pas seulement qu'elle l'est : sans ce mot, une
  // variable absente sur un poste de développement se lit comme une panne
  // locale, alors que c'est le déploiement visé qui la réclame.
  if (v.requiredIn?.length) flags.push(`requise en ${v.requiredIn.join("/")}`);
  if (v.value === null && v.default !== undefined) {
    flags.push(`défaut ${JSON.stringify(v.default)}`);
  }
  if (v.secret) flags.push("secret");
  if (v.values) flags.push(v.values.join("|"));
  for (const s of v.shadowed) flags.push(`ignoré dans ${s.source}`);
  return (
    `  ${pad(v.name, 24)} ${pad(v.kind, 8)} ${pad(value, 24)} ${pad(origin, 22)}` +
    (flags.length ? `  ${flags.join(" · ")}` : "")
  ).trimEnd();
}

/** Rendu humain — l'ordre des sections suit l'ordre des questions qu'on se pose. */
function render(report: IEnvReport, projectRoot: string | null): string {
  const out: string[] = [];
  out.push(
    `\nEnvironnement — mode ${report.runtimeEnv}` +
      (report.appEnv ? ` · déploiement ${report.appEnv}` : "") +
      // L'environnement ÉVALUÉ s'annonce en tête : un rapport qui exige des
      // variables de production sans dire qu'il regarde la production ferait
      // croire à une panne du poste.
      (report.targetEnv
        ? ` · exigences évaluées pour ${report.targetEnv}`
        : "") +
      (projectRoot ? `\n${projectRoot}` : ""),
  );
  out.push(`\nCascade — du plus FORT au plus faible (le premier posé gagne)`);
  for (const l of report.levels) {
    const state = !l.exists
      ? "absent"
      : `${l.count} variable${l.count > 1 ? "s" : ""}`;
    out.push(
      (
        `  ${l.rank}. ${pad(l.source, 28)} ${pad(state, 16)}` +
        (l.rank === 1 ? "  ← shell / orchestrateur : gagne TOUJOURS" : "") +
        (l.skipped ? `  (${l.skipped})` : "")
      ).trimEnd(),
    );
  }
  if (report.vars.length > 0) {
    out.push(`\nVariables déclarées par l'application (env.ts)`);
    for (const v of report.vars) out.push(renderVar(v));
  }
  if (report.overrides.length > 0) {
    out.push(
      `\nSurcharges de configuration (NF__<MODULE>__<CHEMIN>) — visent une clé de module,` +
        `\nsans passer par env.ts`,
    );
    for (const o of report.overrides) {
      out.push(
        `  ${pad(o.envKey, 34)} → ${o.module}.${o.path.join(".")} = ${o.value}` +
          (o.origin ? `  ← ${o.origin}` : ""),
      );
    }
  }
  if (report.unknown.length > 0) {
    out.push(
      `\nVariables NF_ présentes mais NON déclarées — sans effet (une faute de frappe` +
        `\nsur une variable ne se voit jamais : le défaut s'applique en silence)`,
    );
    for (const u of report.unknown) {
      out.push(
        `  ${pad(u.name, 34)}${u.origin ? `← ${pad(u.origin, 20)}` : ""}` +
          (u.suggestion ? `  vouliez-vous dire ${u.suggestion} ?` : ""),
      );
    }
  }
  if (report.reserved.length > 0) {
    out.push(
      `\nVariables posées par le FRAMEWORK — ni à déclarer, ni à écrire soi-même`,
    );
    for (const r of report.reserved) {
      out.push(`  ${pad(r.name, 34)}${r.role}`);
    }
  }
  const missing = report.vars.filter((v) => v.missing);
  if (missing.length > 0) {
    out.push(
      `\n⚠ ${missing.length} variable(s) REQUISE(S) manquante(s) — l'application ne démarrera pas :` +
        `\n  ${missing.map((v) => v.name).join(", ")}`,
    );
  }
  for (const note of report.notes) out.push(`\n⚠ ${note}`);
  out.push("");
  return out.join("\n");
}

/**
 * Commande `nodefony env` — orchestre : résout le projet, lit la cascade et le
 * catalogue, délègue le calcul au module pur, rend.
 *
 * @returns exit code sémantique (`OK`, `USAGE`, `CONFIG` si une requise manque)
 */
/**
 * Compose le rapport d'environnement d'un projet — la MÊME donnée pour tous ses
 * lecteurs.
 *
 * Extraite de {@link runEnvCommand} pour que `nodefony doctor` puisse dire « il
 * manque une variable REQUISE » sans réimplémenter la cascade : deux définitions
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
  return buildEnvReport({
    runtimeEnv,
    appEnv,
    targetEnv,
    processEnv: process.env,
    // La CASCADE reste celle d'ici : viser un autre environnement ne fait pas
    // lire des fichiers qui ne sont pas sur cette machine. Ce que la commande
    // répond, c'est « avec ce que j'ai sous la main, qu'est-ce qui manquera
    // là-bas ? » — et un `.env.production` présent localement compte, puisqu'il
    // partira avec le dépôt.
    files: readLevels(root, runtimeEnv, appEnv),
    catalog: projectRoot ? await readCatalog(projectRoot) : null,
  });
}

/**
 * En-tête GÉNÉRIQUE du `.env.example` d'une application — la version curée du
 * dépôt self-hosted vit, elle, dans son script (`scripts/gen-env-example.ts`) :
 * même `renderEnvExample` en dessous, seuls le préambule et le chemin diffèrent.
 */
const EXAMPLE_HEADER = `# .env.example — MODÈLE d'onboarding (committé, 0 secret réel).
#
# ⚙️  GÉNÉRÉ depuis env.ts (catalogue defineEnv) — NE PAS éditer à la main.
#     Régénérer : npx nodefony env --example
#     Vérifier  : npx nodefony env --example --check   (pre-commit, CI)
#
# Toutes les variables sont COMMENTÉES (le framework a des défauts) : décommenter
# celles que ton déploiement surcharge, dans .env.local (secrets/machine,
# gitignoré) ou .env / .env.<env> (défauts non-secrets). Précédence, du plus
# fort au plus faible :
#   process.env > .env.<appEnv>.local > .env.<env>.local > .env.local
#               > .env.<appEnv> > .env.<env> > .env
#
# Override GÉNÉRIQUE de config (hors catalogue) : NF__<MODULE|APP>__<CHEMIN>=valeur
#   ex. NF__APP__SERVERS__HTTP__PORT=8080
# Secret monté en conteneur : toute variable accepte aussi <NOM>_FILE (Docker/K8s).`;

/**
 * Compose le contenu de `.env.example` d'une application — PUR.
 *
 * @param catalog - catalogue des variables (via `getEnvCatalog`).
 * @returns le texte complet du fichier.
 */
export function composeEnvExample(
  catalog: readonly NamedEnvVarMeta[],
  customHeader: string | null = null,
): string {
  return renderEnvExample(catalog, { header: customHeader ?? EXAMPLE_HEADER });
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
      composeEnvExample(catalog, readExampleHeader(projectRoot)),
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
      : render(report, projectRoot),
  );
  // Une variable requise absente n'est pas un avis : l'application ne démarrera
  // pas. Le code de sortie le dit, pour qu'un script s'arrête là.
  return report.vars.some((v) => v.missing) ? SysExit.CONFIG : SysExit.OK;
}
