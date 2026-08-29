import type { SqlDialect } from "../../config/config";
import type { ISchemaReader } from "./catalog";

/**
 * Contrats de l'applicateur de migrations — verdicts, entrées de journal,
 * historique, plan, et le pilote à connexion unique dont il a besoin.
 *
 * **Pourquoi un fichier de types séparé** : ces formes traversent la frontière
 * npm (CLI, data plane d'administration, sonde de disponibilité, porte MCP) —
 * quatre consommateurs pour un seul producteur. Les tenir à part évite qu'un
 * import de l'applicateur tire les pilotes de base de données avec lui.
 */

/**
 * Nom de la table d'historique — **jamais qualifié d'un schéma**.
 *
 * Elle suit donc le `search_path` de la connexion, exactement comme les tables
 * d'entités. Écrire `public.nodefony_migrations` exclurait à vie le patron
 * PostgreSQL d'isolation par schéma sur une base mutualisée : déplacer ensuite
 * la table d'historique chez un utilisateur serait une migration de données,
 * pas un correctif.
 */
export const HISTORY_TABLE = "nodefony_migrations";

/**
 * Marqueur de format que porte la première ligne de chaque fichier `.sql`.
 *
 * Le format de découpe est celui de drizzle-kit, adopté à vie ; un défaut
 * découvert après publication ne pourrait plus être corrigé sans changer le
 * SENS de fichiers déjà livrés. Le marqueur donne la porte de sortie : un
 * fichier d'un autre format est **refusé en le nommant**, jamais lu au mieux.
 */
export const FORMAT_MARKER = "-- nodefony:migration format=1";

/** Séparateur de statements produit par drizzle-kit. */
export const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/**
 * Codes de refus stables de l'applicateur.
 *
 * Ils sont le contrat lu par une machine — un agent lit `code`, jamais une
 * phrase française. Ajouter un code est additif ; en changer un est une
 * rupture, au même titre qu'un code de sortie.
 */
export type MigrationVerdictCode =
  /** Historique vide alors que les tables du schéma existent déjà. */
  | "NF_MIGRATE_BASELINE_REQUIRED"
  /** Une migration a échoué (ou n'a jamais fini) : réparer avant de reprendre. */
  | "NF_MIGRATE_FAILED_MARKER"
  /** Le fichier d'une migration appliquée a changé depuis son application. */
  | "NF_MIGRATE_HASH_MISMATCH"
  /** Une migration en attente se range AVANT la dernière appliquée de sa source. */
  | "NF_MIGRATE_OUT_OF_ORDER"
  /** Une migration appliquée n'a plus de fichier dans une source pourtant présente. */
  | "NF_MIGRATE_MISSING_FILE"
  /** Un fichier ne porte pas le format que cet applicateur sait lire. */
  | "NF_MIGRATE_UNKNOWN_FORMAT"
  /** Le verrou n'a pas pu être obtenu dans le délai imparti. */
  | "NF_MIGRATE_LOCK_TIMEOUT"
  /** Le tag demandé (`--up-to`) ne désigne aucune migration connue. */
  | "NF_MIGRATE_UNKNOWN_TAG"
  /** La source demandée (`--source`) n'est pas déclarée par cette application. */
  | "NF_MIGRATE_UNKNOWN_SOURCE"
  /** Le journal d'une source annonce un fichier que le dossier ne contient pas. */
  | "NF_MIGRATE_JOURNAL_MISMATCH";

/** Commande à exécuter pour lever un refus — l'agent lit `nextActions[0]`. */
export interface IMigrationAction {
  /** Commande complète, prête à copier. */
  command: string;
  /** Arguments, séparés pour un appel programmatique. */
  args: string[];
}

/**
 * Verdict structuré : **la source**, dont la prose n'est qu'un rendu.
 *
 * Un producteur, quatre rendus (phrase de la CLI, `--json`, data plane,
 * indication dans un corps d'erreur). Écrire le message pour l'humain ET un
 * JSON pour la machine ferait deux implémentations d'une même règle, qui
 * divergeraient.
 */
export interface IMigrationVerdict {
  /** Code stable du refus. */
  code: MigrationVerdictCode;
  /** Connecteur concerné. */
  connector: string;
  /** Source de migrations concernée, quand le refus en désigne une. */
  source?: string;
  /** Tag concerné, quand le refus en désigne un. */
  tag?: string;
  /** Faits constatés, sans mise en forme — de quoi rendre la phrase. */
  facts: Record<string, string | number | boolean | readonly string[]>;
  /** Ce qu'il faut faire ensuite, du plus direct au plus assumé. */
  nextActions: IMigrationAction[];
}

/**
 * Une source de migrations : un espace de noms OUVERT.
 *
 * `framework` et `app` sont deux valeurs **réservées**, pas une énumération :
 * le registre d'entités est déjà ouvert à N modules, et un modèle à deux
 * valeurs casserait APRÈS publication (un module tiers n'aurait d'autre choix
 * que de se déverser dans `app`, et désinstaller un module bloquerait toute
 * migration ultérieure, pour toujours).
 */
export interface IMigrationSource {
  /** Nom logique, découplé du paquet qui livre le dossier. */
  name: string;
  /** Dossier RACINE des migrations ; le sous-dossier de dialecte est dérivé. */
  dir: string;
  /** Rang d'application : `framework` = 0, modules ensuite, `app` en dernier. */
  rank: number;
}

/** Un fichier de migration chargé depuis une source. */
export interface IMigrationFile {
  /** Source qui le livre. */
  source: string;
  /** Identité immuable du fichier (`0000_framework_init`). */
  tag: string;
  /** Rang dans le journal de SA source. */
  idx: number;
  /** Empreinte auto-descriptive `sha256:<hex>` du contenu normalisé. */
  hash: string;
  /** Statements découpés, dans l'ordre, sans les vides. */
  statements: readonly string[];
  /** Chemin du fichier — pour nommer un refus. */
  path: string;
}

/** Une ligne de la table d'historique, colonnes lues NOMMÉMENT. */
export interface IAppliedMigration {
  source: string;
  tag: string;
  hash: string;
  runId: string;
  startedAt: number;
  finishedAt: number | null;
  executionMs: number | null;
  success: boolean;
  error: string | null;
  appliedBy: string | null;
}

/** Une dérive constatée : le fichier a changé après avoir été appliqué. */
export interface IMigrationDrift {
  source: string;
  tag: string;
  /** Empreinte enregistrée au moment de l'application. */
  expected: string;
  /** Empreinte du fichier tel qu'il est aujourd'hui. */
  actual: string;
}

/**
 * État complet, calculé en LECTURE SEULE.
 *
 * Même producteur pour la CLI, le data plane, la porte d'agent et la sonde de
 * disponibilité — quatre consommateurs, une seule vérité.
 */
export interface IMigrationPlan {
  connector: string;
  dialect: SqlDialect;
  /** Migrations appliquées avec succès, ordre d'application. */
  applied: readonly IAppliedMigration[];
  /** Migrations à appliquer, dans l'ordre (rang de source, puis journal). */
  pending: readonly IMigrationFile[];
  /** Fichiers modifiés après application. */
  drifted: readonly IMigrationDrift[];
  /** Marqueurs d'échec, ou migrations jamais terminées. */
  failed: readonly IAppliedMigration[];
  /** Appliquées en base mais sans fichier, dans une source PRÉSENTE. */
  missing: readonly { source: string; tag: string }[];
  /** Sources vues en base mais absentes du registre — ignorées, jamais bloquantes. */
  ignoredSources: readonly string[];
  /** Historique vide alors que les tables du schéma existent déjà. */
  baselineRequired: boolean;
}

/** Résultat de l'application d'une migration. */
export interface IMigrationApplied {
  source: string;
  tag: string;
  executionMs: number;
}

/** Résultat d'un `migrate()`. */
export interface IMigrationRun {
  /** Identifiant du run — groupe les migrations d'un même déploiement. */
  runId: string;
  /** Migrations effectivement appliquées, dans l'ordre. */
  applied: readonly IMigrationApplied[];
}

/**
 * Pilote de base de données de l'applicateur — **une connexion, pas un pool**.
 *
 * `pg_advisory_lock` et `GET_LOCK` sont des verrous de SESSION : un pool les
 * rend inopérants (verrou pris sur une connexion, DDL exécuté sur une autre,
 * libération sur une troisième). L'applicateur tient donc sa propre connexion,
 * du verrou jusqu'à sa libération, avec les mêmes pilotes chargés en lazy que
 * l'adapter — aucune dépendance nouvelle.
 */
export interface IMigrationDriver extends ISchemaReader {
  /** Dialecte servi. */
  readonly dialect: SqlDialect;
  /**
   * Le DDL de ce dialecte est-il transactionnel ?
   *
   * MySQL répond `false` : un `CREATE TABLE` y valide implicitement. C'est ce
   * qui interdit toute reprise aveugle après un échec — la réparation tranche.
   */
  readonly transactionalDdl: boolean;
  /** Exécute un statement sans résultat. */
  exec(sql: string): Promise<void>;
  /** Exécute une requête paramétrée ; les paramètres s'écrivent `?`. */
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  /** Ouvre une transaction (`BEGIN IMMEDIATE` en sqlite). */
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /**
   * Prend le verrou d'applicateur, ou lève au bout de `timeoutMs`.
   *
   * L'identité du verrou est un **contrat inter-versions** : deux versions du
   * framework qui ne s'excluent plus, c'est pendant un déploiement que ça se
   * paie — le seul moment qui compte.
   */
  lock(timeoutMs: number): Promise<void>;
  /** Libère le verrou. Sans effet s'il n'était pas tenu. */
  unlock(): Promise<void>;
  /** Ferme la connexion. */
  close(): Promise<void>;
}

/** Erreur portant un {@link IMigrationVerdict} — le message n'est qu'un rendu. */
export class MigrationVerdictError extends Error {
  /**
   * @param verdict - verdict structuré, seule source de la décision.
   * @param message - phrase française destinée à un humain.
   */
  constructor(
    readonly verdict: IMigrationVerdict,
    message: string,
  ) {
    super(message);
    this.name = "MigrationVerdictError";
  }
}
