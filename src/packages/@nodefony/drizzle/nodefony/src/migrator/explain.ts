import type { SqlDialect } from "../../config/config";
import type {
  IAppliedMigration,
  IMigrationAction,
  IMigrationDrift,
  IMigrationFile,
  IMigrationPlan,
  IMigrationVerdict,
} from "./types";
import { HISTORY_TABLE } from "./types";

/**
 * Le RENDU des migrations : un seul producteur, quatre destinataires.
 *
 * La ligne de commande, la sortie `--json`, le plan d'administration et
 * l'assistance affichée dans un corps d'erreur disent tous la même chose. Écrire
 * la phrase pour l'humain d'un côté et l'objet pour la machine de l'autre
 * ferait deux implémentations d'une même règle — et elles divergeraient, comme
 * toutes les copies.
 *
 * ## Ce que ce fichier garantit, et qui n'est pas cosmétique
 *
 * **Aucune sortie ne laisse l'utilisateur sans geste suivant.** Chaque situation
 * — succès, attente, refus, panne — produit trois choses :
 *
 * 1. **le FAIT**, en français, sans terme d'art (« le fichier `0002_x.sql` a
 *    changé après avoir été appliqué ») ;
 * 2. **ce que ça veut dire**, c'est-à-dire la cause la plus probable ;
 * 3. **la commande exacte à copier**, jamais une allusion à une option qu'il
 *    faudrait deviner.
 *
 * Un agent lit `nextActions[0].command` et sait quoi faire sans comprendre le
 * français ; un humain lit les mêmes mots sous une forme lisible. C'est la même
 * donnée.
 */

/**
 * Version de la charge utile `--json` **et** du plan d'administration.
 *
 * Contrat public : ajouter un champ est une évolution mineure, en retirer ou en
 * renommer un est interdit sur toute la série majeure. Un `jq` écrit par un
 * utilisateur ne doit jamais casser sur une mise à jour de correctif.
 */
export const MIGRATION_FORMAT_VERSION = 1;

/**
 * Verdicts possibles — **énumération GELÉE** avec {@link MIGRATION_FORMAT_VERSION}.
 *
 * Y ajouter une valeur après publication casserait tout consommateur qui les
 * traite exhaustivement (`case` sans `default`, `match` d'un agent). Une
 * situation nouvelle se range donc dans la famille existante qui lui convient,
 * et se détaille dans les champs — jamais dans un huitième mot.
 */
export type MigrationVerdictName =
  /** Rien à faire : l'historique est complet et les fichiers concordent. */
  | "up-to-date"
  /** Des migrations restent à appliquer. */
  | "pending"
  /**
   * Les fichiers ne correspondent plus à ce que l'historique enregistre :
   * empreinte changée après application, ou fichier disparu. Le cas du fichier
   * disparu se range ici — l'énumération est gelée, et c'est bien la même
   * famille : ce qui est écrit dans l'historique ne se retrouve plus sur le
   * disque. Le détail reste lisible dans `sources[].drifted` et `[].missing`.
   */
  | "drift"
  /** Une migration a échoué, ou n'a jamais fini : réparation requise. */
  | "failed"
  /** La base a déjà les tables mais aucun historique : adoption requise. */
  | "adopt"
  /**
   * L'historique est complet, rien n'est en attente — et la base ne correspond
   * pourtant pas au schéma déclaré dans le code.
   */
  | "divergent";

/** Ce qu'une source de migrations donne à voir. */
export interface IMigrationSourceReport {
  /** Nom logique de la source (`framework`, `app`, un module tiers). */
  name: string;
  /** Migrations appliquées avec succès. */
  applied: number;
  /** Migrations restant à appliquer. */
  pending: number;
  /** Marqueurs d'échec à lever. */
  failed: number;
  /** Identités en attente, dans l'ordre d'application. */
  pendingTags: string[];
  /** Fichiers modifiés après avoir été appliqués. */
  drifted: { tag: string; expected: string; actual: string }[];
  /** Identités enregistrées dont le fichier a disparu. */
  missing: string[];
}

/**
 * La charge utile figée — cœur NEUTRE au premier niveau, spécifique du pilote
 * sous `driver`.
 *
 * Ce découpage est la seule chose qui permettra à un second ORM de remplir la
 * même structure sans casser un `jq` d'utilisateur. Si `dialect` vivait au
 * premier niveau, chaque script le graverait — et un ORM sans dialecte n'aurait
 * plus de place dans la structure.
 */
export interface IMigrationReport {
  formatVersion: typeof MIGRATION_FORMAT_VERSION;
  /** Connecteur observé. */
  connector: string;
  /** Situation d'ensemble — énumération gelée. */
  verdict: MigrationVerdictName;
  /** Code de sortie que cette situation produit sur la ligne de commande. */
  exitCode: 0 | 1 | 2;
  /** Le fait constaté, en une phrase française. */
  summary: string;
  /** Ce qu'il faut faire, du plus direct au plus assumé. Peut être vide. */
  nextActions: IMigrationAction[];
  /** Une source par entrée, dans l'ordre d'application. */
  sources: IMigrationSourceReport[];
  /** Tout ce qui est propre au pilote SQL vit ici, et nulle part ailleurs. */
  driver: {
    kind: "sql";
    dialect: SqlDialect;
    ddl: string;
    historyTable: string;
  };
}

/** Grille des codes de sortie — **figée, jamais réaffectée**. */
export const EXIT = {
  /** À jour, ou appliqué avec succès. */
  ok: 0,
  /** Une action humaine est requise sur la base ou sur les fichiers. */
  actionRequired: 1,
  /** La commande n'a pas pu faire son travail (verrou, connexion, usage). */
  error: 2,
} as const;

/** Fabrique une action affichable et exécutable. */
export function action(command: string): IMigrationAction {
  return { command, args: command.split(" ").slice(1) };
}

/**
 * Situation d'ensemble d'un plan, dans l'ordre de gravité.
 *
 * L'ordre n'est pas esthétique : il dit quel geste vient EN PREMIER. Une
 * migration en échec doit être réparée avant qu'on parle de ce qui reste à
 * appliquer, sinon l'utilisateur lance une commande qui va refuser.
 *
 * @param plan - plan calculé en lecture seule.
 * @param divergent - la base a-t-elle divergé du schéma déclaré ?
 * @returns le verdict, énumération gelée.
 */
export function verdictOf(
  plan: IMigrationPlan,
  divergent = false,
): MigrationVerdictName {
  if (plan.failed.length > 0) {
    return "failed";
  }
  if (plan.drifted.length > 0 || plan.missing.length > 0) {
    return "drift";
  }
  if (plan.baselineRequired) {
    return "adopt";
  }
  if (plan.pending.length > 0) {
    return "pending";
  }
  return divergent ? "divergent" : "up-to-date";
}

/**
 * Le code de sortie d'un verdict.
 *
 * **`divergent` ne fait pas tomber un déploiement** quand la configuration le
 * laisse en observation : superviser n'est pas bloquer. C'est ce qui rend le
 * constat utilisable — une application qui écrit des migrations libres a une
 * base légitimement différente du schéma déclaré, en permanence.
 *
 * @param verdict - situation d'ensemble.
 * @param divergenceBlocks - `true` quand `migrations.divergence` vaut `fail`.
 * @returns `0`, `1` ou `2`.
 */
export function exitCodeOf(
  verdict: MigrationVerdictName,
  divergenceBlocks = false,
): 0 | 1 | 2 {
  if (verdict === "up-to-date") {
    return EXIT.ok;
  }
  if (verdict === "divergent") {
    return divergenceBlocks ? EXIT.actionRequired : EXIT.ok;
  }
  return EXIT.actionRequired;
}

/** Regroupe les entrées d'un plan par source, en gardant l'ordre. */
function groupSources(plan: IMigrationPlan): IMigrationSourceReport[] {
  const byName = new Map<string, IMigrationSourceReport>();
  const ensure = (name: string): IMigrationSourceReport => {
    let entry = byName.get(name);
    if (!entry) {
      entry = {
        name,
        applied: 0,
        pending: 0,
        failed: 0,
        pendingTags: [],
        drifted: [],
        missing: [],
      };
      byName.set(name, entry);
    }
    return entry;
  };
  for (const row of plan.applied as readonly IAppliedMigration[]) {
    ensure(row.source).applied += 1;
  }
  for (const file of plan.pending as readonly IMigrationFile[]) {
    const entry = ensure(file.source);
    entry.pending += 1;
    entry.pendingTags.push(file.tag);
  }
  for (const row of plan.failed as readonly IAppliedMigration[]) {
    ensure(row.source).failed += 1;
  }
  for (const d of plan.drifted as readonly IMigrationDrift[]) {
    ensure(d.source).drifted.push({
      tag: d.tag,
      expected: d.expected,
      actual: d.actual,
    });
  }
  for (const m of plan.missing) {
    ensure(m.source).missing.push(m.tag);
  }
  return [...byName.values()];
}

/** Ce que le rendu doit savoir en plus du plan lui-même. */
export interface IReportContext {
  /** Mode de schéma effectif du connecteur. */
  ddl: string;
  /** La base a-t-elle divergé du schéma déclaré ? */
  divergent?: boolean;
  /** `migrations.divergence` vaut-il `fail` ? */
  divergenceBlocks?: boolean;
}

/**
 * Compose la charge utile complète d'un état de migration.
 *
 * @param plan - plan calculé en lecture seule.
 * @param ctx - mode de schéma et conduite face à la divergence.
 * @returns la charge utile, identique pour la ligne de commande, `--json`, le
 *   plan d'administration et la sonde.
 */
export function buildReport(
  plan: IMigrationPlan,
  ctx: IReportContext,
): IMigrationReport {
  const verdict = verdictOf(plan, ctx.divergent === true);
  const sources = groupSources(plan);
  return {
    formatVersion: MIGRATION_FORMAT_VERSION,
    connector: plan.connector,
    verdict,
    exitCode: exitCodeOf(verdict, ctx.divergenceBlocks === true),
    summary: summaryOf(plan, verdict),
    nextActions: actionsOf(plan, verdict),
    sources,
    driver: {
      kind: "sql",
      dialect: plan.dialect,
      ddl: ctx.ddl,
      historyTable: HISTORY_TABLE,
    },
  };
}

/** Le FAIT, en une phrase, sans terme d'art. */
function summaryOf(
  plan: IMigrationPlan,
  verdict: MigrationVerdictName,
): string {
  const c = plan.connector;
  switch (verdict) {
    case "up-to-date":
      return `Le connecteur « ${c} » est à jour : tout ce qui est enregistré a été appliqué, et les fichiers n'ont pas bougé depuis.`;
    case "pending": {
      const n = plan.pending.length;
      const noms = plan.pending
        .slice(0, 3)
        .map((f) => `${f.source}/${f.tag}`)
        .join(", ");
      const reste = n > 3 ? `, et ${n - 3} de plus` : "";
      return `Le connecteur « ${c} » a ${n} migration${n > 1 ? "s" : ""} à appliquer : ${noms}${reste}.`;
    }
    case "drift": {
      const parts: string[] = [];
      if (plan.drifted.length > 0) {
        const d = plan.drifted[0] as IMigrationDrift;
        parts.push(
          `le fichier « ${d.source}/${d.tag} » a été modifié APRÈS avoir été appliqué (son empreinte a changé)`,
        );
      }
      if (plan.missing.length > 0) {
        const m = plan.missing[0] as { source: string; tag: string };
        parts.push(
          `la migration « ${m.source}/${m.tag} » est enregistrée comme appliquée mais son fichier n'existe plus`,
        );
      }
      return `Le connecteur « ${c} » ne concorde plus avec son historique : ${parts.join(" ; ")}.`;
    }
    case "failed": {
      const f = plan.failed[0] as IAppliedMigration;
      const quand = f.startedAt
        ? new Date(f.startedAt).toISOString()
        : "à une date inconnue";
      const pourquoi = f.error ? ` (erreur : ${f.error})` : "";
      return `Le connecteur « ${c} » porte ${plan.failed.length} migration${plan.failed.length > 1 ? "s" : ""} qui n'a pas abouti : « ${f.source}/${f.tag} », commencée le ${quand}${pourquoi}.`;
    }
    case "adopt":
      return `La base du connecteur « ${c} » contient déjà des tables, mais aucune migration n'y est enregistrée. Nodefony ne devine pas : appliquer les migrations sur une base déjà peuplée écraserait peut-être une base qui n'est pas la bonne.`;
    case "divergent":
      return `Le connecteur « ${c} » a son historique complet et rien en attente — mais la base ne correspond pas au schéma déclaré dans le code. Quelqu'un a modifié la base directement, ou un correctif d'urgence n'a pas été reporté.`;
  }
}

/** Ce qu'il faut TAPER, du plus direct au plus assumé. */
function actionsOf(
  plan: IMigrationPlan,
  verdict: MigrationVerdictName,
): IMigrationAction[] {
  const c = plan.connector;
  const suffixe = c === "default" ? "" : ` --connector ${c}`;
  switch (verdict) {
    case "up-to-date":
      return [];
    case "pending":
      return [
        action(`nodefony orm:migrate${suffixe}`),
        action(`nodefony orm:migrate${suffixe} --dry-run`),
      ];
    case "drift": {
      const out: IMigrationAction[] = [];
      if (plan.drifted.length > 0) {
        out.push(action(`git checkout -- migrations/`));
        out.push(
          action(`nodefony orm:migrate:repair${suffixe} --update-hashes`),
        );
      }
      if (plan.missing.length > 0) {
        out.push(action(`nodefony orm:migrate${suffixe} --ignore-missing`));
      }
      return out;
    }
    case "failed":
      return [
        action(`nodefony orm:migrate:status${suffixe} --json`),
        action(`nodefony orm:migrate:repair${suffixe}`),
        action(`nodefony orm:migrate${suffixe}`),
      ];
    case "adopt":
      return [
        action(`nodefony orm:migrate:baseline${suffixe}`),
        action(`nodefony orm:migrate:status${suffixe}`),
      ];
    case "divergent":
      // 🔴 On ne propose QUE des commandes qui existent. La génération d'une
      // migration correctrice côté application n'a pas encore son verbe : la
      // suggérer enverrait l'utilisateur taper une commande inconnue, ce qui
      // détruit la confiance dans TOUTES les autres actions rendues ici.
      return [
        action(`nodefony orm:migrate:status${suffixe} --json`),
        action(`nodefony orm:reset${suffixe}`),
      ];
  }
}

/**
 * Ce que le verdict veut dire — la CAUSE, entre le fait et le geste.
 *
 * C'est le bloc qu'on omet d'habitude, et c'est celui qui évite l'appel au
 * collègue : l'utilisateur sait ce qui s'est passé, donc il sait si le geste
 * proposé lui convient.
 *
 * @param verdict - situation d'ensemble.
 * @returns une ou deux phrases, ou une chaîne vide si le fait se suffit.
 */
export function meaningOf(verdict: MigrationVerdictName): string {
  switch (verdict) {
    case "up-to-date":
      return "";
    case "pending":
      return "C'est la situation normale après avoir tiré du code qui change le schéma, ou avant un déploiement. Rien n'a encore été modifié dans la base.";
    case "drift":
      return "Un fichier de migration ne se modifie jamais après avoir été appliqué : d'autres bases ont reçu l'ancienne version, et elles ne recevront jamais la nouvelle. Le geste normal est de restaurer le fichier et d'écrire une NOUVELLE migration. Ré-aligner les empreintes ne se fait que si l'on sait que la modification était sans effet.";
    case "failed":
      return "La migration s'est arrêtée en cours de route. Selon la base, elle a pu laisser un état partiel : MySQL valide chaque instruction de schéma sans possibilité de retour, PostgreSQL et SQLite annulent la migration fautive entière. Regarde l'état réel de la base AVANT de lever le marqueur — c'est ce que « réparer » veut dire ici, et rien d'autre.";
    case "adopt":
      return "Cela arrive quand on branche Nodefony sur une base qui existait déjà, ou quand on a créé les tables autrement (schéma dérivé du code en développement). Déclarer la base à niveau enregistre les migrations comme appliquées SANS les exécuter. Vérifie d'abord que c'est bien la base attendue.";
    case "divergent":
      return "Aucun outil de migration ne regarde la base elle-même : ils comparent les fichiers à l'historique et concluent. Nodefony compare aussi au schéma déclaré dans le code, ce qui rend ce cas visible. Il n'est PAS bloquant par défaut, parce qu'une application qui écrit des migrations libres a légitimement une base différente du schéma déclaré.";
  }
}

/** Codes ANSI, neutralisés hors terminal (un `| jq` ne doit rien recevoir). */
export interface IStyle {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
}

/**
 * Construit le styliste : couleurs en terminal, texte nu ailleurs.
 *
 * @param tty - la sortie est-elle un terminal ?
 * @returns les fonctions de mise en forme.
 */
export function styleFor(tty: boolean): IStyle {
  const wrap =
    (code: string) =>
    (s: string): string =>
      tty ? `\x1b[${code}m${s}\x1b[0m` : s;
  return {
    bold: wrap("1"),
    dim: wrap("2"),
    green: wrap("32"),
    yellow: wrap("33"),
    red: wrap("31"),
  };
}

/** Rend les trois blocs — le fait, ce que ça veut dire, ce qu'il faut taper. */
function renderBlocks(
  style: IStyle,
  summary: string,
  meaning: string,
  actions: readonly IMigrationAction[],
  actionTitle = "À faire",
): string {
  let out = `${summary}\n`;
  if (meaning) {
    out += `\n${style.dim(meaning)}\n`;
  }
  if (actions.length > 0) {
    out += `\n${style.bold(`${actionTitle} :`)}\n`;
    for (const a of actions) {
      out += `  ${style.green(a.command)}\n`;
    }
  }
  return out;
}

/**
 * Rendu humain d'un état de migration — l'écran que voit celui qui tape
 * `orm:migrate:status`.
 *
 * @param report - charge utile complète.
 * @param style - mise en forme (couleurs ou texte nu).
 * @returns le texte prêt à écrire sur la sortie standard.
 */
export function renderStatus(report: IMigrationReport, style: IStyle): string {
  const badge: Record<MigrationVerdictName, string> = {
    "up-to-date": style.green("✓ à jour"),
    pending: style.yellow("→ en attente"),
    drift: style.red("⚠ ne concorde plus"),
    failed: style.red("✗ migration interrompue"),
    adopt: style.yellow("? base à déclarer"),
    divergent: style.yellow("≠ base différente du code"),
  };
  let out =
    `${style.bold(`Connecteur ${report.connector}`)} ` +
    `${style.dim(`(${report.driver.dialect}, schéma : ${report.driver.ddl}, historique : ${report.driver.historyTable})`)}\n` +
    `  ${badge[report.verdict]}\n\n`;
  for (const s of report.sources) {
    const bits = [
      `${s.applied} appliquée${s.applied > 1 ? "s" : ""}`,
      `${s.pending} en attente`,
    ];
    if (s.failed > 0) {
      bits.push(style.red(`${s.failed} interrompue(s)`));
    }
    if (s.drifted.length > 0) {
      bits.push(style.red(`${s.drifted.length} modifiée(s) après coup`));
    }
    if (s.missing.length > 0) {
      bits.push(style.red(`${s.missing.length} fichier(s) disparu(s)`));
    }
    out += `  ${style.bold(s.name.padEnd(12))} ${bits.join(" · ")}\n`;
    if (s.pendingTags.length > 0) {
      out += `  ${" ".repeat(12)} ${style.dim(`→ ${s.pendingTags.join(", ")}`)}\n`;
    }
  }
  if (report.sources.length === 0) {
    out += `  ${style.dim("aucune source de migrations")}\n`;
  }
  out += `\n${renderBlocks(style, report.summary, meaningOf(report.verdict), report.nextActions)}`;
  return out;
}

/**
 * Rendu humain d'un REFUS de l'applicateur.
 *
 * Un refus est un contrat, pas un message : il énonce le fait, ce qu'il
 * signifie, et donne la commande exacte à copier. L'utilisateur ne doit jamais
 * avoir eu connaissance d'une option à l'avance.
 *
 * @param verdict - verdict structuré porté par le refus.
 * @param message - phrase française déjà composée par l'applicateur.
 * @param style - mise en forme.
 * @param ddl - mode de schéma effectif, quand il change la cause (cf {@link refusalInMode}).
 * @returns le texte prêt à écrire sur la sortie d'erreur.
 */
export function renderRefusal(
  verdict: IMigrationVerdict,
  message: string,
  style: IStyle,
  ddl?: string,
): string {
  const enMode = ddl
    ? refusalInMode(verdict.code, ddl, verdict.connector)
    : null;
  const meaning = enMode?.meaning ?? REFUSAL_MEANING[verdict.code] ?? "";
  const actions = enMode?.actions ?? verdict.nextActions;
  return (
    `${style.red(style.bold("Migration refusée"))} ` +
    `${style.dim(`[${verdict.code}]`)}\n\n` +
    renderBlocks(style, message, meaning, actions)
  );
}

/**
 * Ce qu'un refus veut dire QUAND ON CONNAÎT LE MODE DE SCHÉMA.
 *
 * Le même fait mécanique n'a pas la même cause selon le mode, et le geste
 * change avec la cause. Constaté en exécutant la commande pour de vrai : sur une
 * base parfaitement NEUVE, en développement, `orm:migrate` refuse en disant que
 * la base « porte déjà les tables ». C'est exact — et c'est le DÉMARRAGE
 * lui-même qui vient de les créer, quelques millisecondes plus tôt, parce que le
 * mode `auto` dérive le schéma du code. Sans cette précision, l'utilisateur
 * cherche une base ancienne qui n'existe pas.
 *
 * @param code - code du refus.
 * @param ddl - mode de schéma effectif du connecteur.
 * @param connector - connecteur concerné, pour composer les gestes.
 * @returns l'explication et les gestes, ou `null` si le refus se suffit.
 */
export function refusalInMode(
  code: IMigrationVerdict["code"],
  ddl: string,
  connector: string,
): { meaning: string; actions: IMigrationAction[] } | null {
  if (code !== "NF_MIGRATE_BASELINE_REQUIRED" || ddl !== "auto") {
    return null;
  }
  const suffixe = connector === "default" ? "" : ` --connector ${connector}`;
  return {
    meaning:
      "Ce connecteur est en mode `auto` : c'est le DÉMARRAGE qui fabrique le " +
      "schéma à partir du code, et il vient de le faire — les tables existent " +
      "donc déjà, même sur une base créée à l'instant. Ne cherche pas une " +
      "vieille base : les deux façons de fabriquer un schéma se croisent, " +
      "c'est tout. Trois issues, selon ce que tu veux vraiment. Éprouver les " +
      "migrations comme en production : repars d'une base vide avec le mode " +
      "`none`. Repartir de zéro en développement : vide la base. Garder cette " +
      "base et la déclarer à niveau : adopte-la (aucun SQL ne sera exécuté).",
    actions: [
      action(`NODE_ENV=production nodefony orm:migrate${suffixe}`),
      action(`nodefony orm:reset${suffixe}`),
      action(`nodefony orm:migrate:baseline${suffixe}`),
    ],
  };
}

/**
 * Ce que chaque refus de l'applicateur veut dire, en clair.
 *
 * Table complète et exhaustive par construction : le type est indexé par
 * l'union des codes, donc en ajouter un sans écrire sa phrase ne compile pas.
 * C'est le seul moyen d'avoir la garantie qu'aucun refus ne sortira nu.
 */
const REFUSAL_MEANING: Record<IMigrationVerdict["code"], string> = {
  NF_MIGRATE_BASELINE_REQUIRED:
    "La base contient déjà des tables alors qu'aucune migration n'y est enregistrée. Appliquer les migrations maintenant exécuterait des créations de tables qui existent — souvent parce qu'on s'est trompé de base. Déclarer la base à niveau enregistre les migrations comme appliquées sans les exécuter ; à ne faire qu'après avoir vérifié que c'est la bonne base.",
  NF_MIGRATE_FAILED_MARKER:
    "Une migration précédente s'est arrêtée en cours de route. Reprendre à l'aveugle par-dessus un état partiel est le meilleur moyen d'aggraver la situation. Regarde l'état réel de la base, corrige-le si besoin, puis lève le marqueur.",
  NF_MIGRATE_HASH_MISMATCH:
    "Un fichier déjà appliqué a été modifié depuis. Les autres bases ont reçu l'ancienne version et ne recevront jamais la nouvelle : le fichier et la réalité ont divergé. Le geste normal est de restaurer le fichier et d'écrire une nouvelle migration.",
  NF_MIGRATE_OUT_OF_ORDER:
    "Une migration en attente se range avant la dernière appliquée de sa source — c'est la trace d'une fusion de branches. L'appliquer quand même est souvent juste, mais c'est une décision : deux bases pourraient ne pas avoir reçu les mêmes changements dans le même ordre.",
  NF_MIGRATE_MISSING_FILE:
    "Une migration enregistrée comme appliquée n'a plus de fichier, alors que sa source est bien présente. Soit le fichier a été supprimé par erreur, soit la base a connu une version du code que ce dépôt ne contient pas.",
  NF_MIGRATE_UNKNOWN_FORMAT:
    "Un fichier ne porte pas le format que cet applicateur sait lire. Lire au mieux un fichier d'un format inconnu, c'est exécuter du SQL découpé au hasard — donc jamais.",
  NF_MIGRATE_LOCK_TIMEOUT:
    "Un autre processus applique des migrations sur cette base, ou en a laissé le verrou pris. Le verrou est tenu par une connexion : il se libère tout seul quand la connexion meurt. Vérifie qu'aucun autre travail de migration ne tourne, puis relance.",
};
