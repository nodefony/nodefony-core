/**
 * Types & constantes PARTAGÉS du dashboard ORM (`/nodefony/orm`) et de la page
 * drill par worker (`/nodefony/orm/:pid`). Extraits d'`OrmOverview` (2500+ lignes)
 * pour partager le contrat sans copie et alléger le coût de relecture (cache).
 *
 * Frontière isomorphe : ces types MIROIRENT le data plane `/nodefony/orm/api/*` —
 * jamais d'import runtime serveur (cf `utils/realtimeHealth.ts` pour `nodefony:socket`).
 */

/** Résumé d'un connecteur ORM (data plane /nodefony/orm/api/orms). */
export interface OrmSummary {
  name: string;
  vendor?: string;
  default: boolean;
  connected: boolean;
  entityCount: number;
  connection?: {
    driver: string;
    target?: string;
    version?: string;
    ormVersion?: string;
  };
}

/** Relation déclarée entre deux entités (graphe canonique). */
export interface EntityRel {
  type: string;
  target: string;
  field: string;
  foreignKey?: string;
}

/** Entité du graphe canonique (/nodefony/orm/api/graph). */
export interface EntityNode {
  name: string;
  connector: string;
  module?: string;
  domain?: string;
  columns?: { name: string; type: string }[];
  relations?: EntityRel[];
}

export interface OrmGraph {
  orms: OrmSummary[];
  entities: EntityNode[];
}

/** Libellé long d'un vendor ORM. */
export const VENDOR_LABEL: Record<string, string> = {
  drizzle: "Drizzle",
  mongoose: "Mongoose",
};

/** Libellé court d'un type de relation. */
export const REL_LABEL: Record<string, string> = {
  "one-to-many": "1-N",
  "many-to-one": "N-1",
  "one-to-one": "1-1",
  "many-to-many": "N-N",
};

/** Erreur de connexion (data plane connection/health). */
export interface ConnError {
  message: string;
  ts: number;
}

/** Diagnostic d'un connecteur (/nodefony/orm/api/connection/health). */
export interface ConnHealth {
  instanceId: string;
  name: string;
  vendor: string;
  driver: string;
  target?: string;
  version?: string;
  ormVersion?: string;
  connected: boolean;
  connectedSince: number | null;
  uptimeMs: number | null;
  connectCount: number;
  reconnectCount: number;
  errorCount: number;
  lastError: ConnError | null;
  recentErrors: ConnError[];
  lastConnectMs: number | null;
  pingMs: number | null;
  pingOk: boolean;
  pingError: string | null;
  latency: {
    last: number | null;
    min: number | null;
    avg: number | null;
    max: number | null;
    samples: number;
  };
  storage?: {
    sizeBytes?: number;
    pages?: number;
    pageSize?: number;
    journalMode?: string;
    freePages?: number;
  };
  pool?: {
    size?: number;
    available?: number;
    borrowed?: number;
    pending?: number;
  };
  extra?: Record<string, string | number | boolean>;
}

/** Flux d'un connecteur (canal `nodefony:orm:flow` / `GET /orm/api/flow`) — sous-ensemble consommé. */
export interface FlowConn {
  connector: string;
  total: number;
  ewmaMs: number | null;
}
export interface FlowReport {
  ts: number;
  connectors: FlowConn[];
}
/** Vue flux par connecteur (débit instantané + latence EWMA + historique sparkline). */
export interface ConnFlow {
  rate: number;
  ewmaMs: number | null;
  hist: number[];
}
/** Taille de l'historique des sparklines (débit/s) gardé en mémoire. */
export const FLOW_HISTORY = 40;

/** Taux ORM dérivés (delta des cumuls / temps) — `null` tant qu'un seul snapshot. */
export interface OrmRate {
  /** Erreurs ORM par minute (delta `errorTotal`). */
  errPerMin: number | null;
  /** Reconnexions par minute (delta `reconnectTotal`). */
  reconPerMin: number | null;
}

/** Une ligne de classement (barre proportionnelle). */
export interface RankItem {
  key: string;
  label: string;
  value: number;
  href?: string;
}

// ─── Migrations (data plane `/nodefony/orm/api/migrations?connector=`) ────────
//
// Ces types MIROIRENT le cœur NEUTRE publié par `orm-core`
// (`IOrmMigrationStatus`) — pas la forme du pilote SQL. Ce qui est propre à un
// pilote vit sous `driver`, dont l'écran ne lit que `kind` : le jour où un
// second ORM porte des migrations, la page n'a pas à changer d'une ligne.

/** Une commande à taper, telle que le produit la propose. */
export interface MigrationAction {
  command: string;
  args: string[];
}

/** Une migration, telle que l'historique et les fichiers la décrivent. */
export interface MigrationEntry {
  tag: string;
  status: "applied" | "pending" | "failed" | "drifted" | "missing" | string;
  appliedAt?: number;
  durationMs?: number;
  appliedBy?: string;
  runId?: string;
  error?: string;
}

/** Les migrations d'une origine — le framework, l'application, un module. */
export interface MigrationSource {
  name: string;
  applied: number;
  pending: number;
  failed: number;
  pendingTags?: string[];
  drifted?: { tag: string; expected: string; actual: string }[];
  missing?: string[];
  entries: MigrationEntry[];
}

/** Ce qui diverge entre la base et le schéma déclaré, nommé. */
export interface MigrationDivergence {
  missingTables?: string[];
  blocking?: { table: string; column: string; reason?: string }[];
  additive?: { table: string; column: string; reason?: string }[];
}

/** L'état complet d'un connecteur. */
export interface MigrationStatus {
  formatVersion: number;
  connector: string;
  verdict: string;
  exitCode?: 0 | 1 | 2;
  summary: string;
  nextActions: MigrationAction[];
  sources: MigrationSource[];
  divergence?: MigrationDivergence;
  driver: {
    kind: string;
    dialect?: string;
    ddl?: string;
    historyTable?: string;
  };
}

/**
 * Ce que le plan rend quand il n'y a PAS d'état à montrer.
 *
 * Un écran qui reçoit ceci doit MONTRER l'empêchement : un tableau vide
 * ressemble à « tout va bien », et c'est le pire mode de défaillance d'un
 * écran d'exploitation.
 */
export interface MigrationFailure {
  formatVersion: number;
  connector: string;
  error: {
    code: string;
    summary: string;
    meaning: string;
    nextActions: MigrationAction[];
  };
}

/** L'état, ou l'empêchement — jamais les deux. */
export type MigrationReply = MigrationStatus | MigrationFailure;

/**
 * Y a-t-il un empêchement plutôt qu'un état ?
 *
 * @param reply - ce que le plan d'administration a rendu.
 * @returns `true` si c'est un empêchement.
 */
export function isMigrationFailure(
  reply: MigrationReply | MigrationPlanReply | MigrationApplyReply,
): reply is MigrationFailure {
  return "error" in reply;
}

/** Une migration en attente, avec le SQL qu'elle exécuterait. */
export interface PendingMigration {
  source: string;
  tag: string;
  statements: string[];
}

/** Ce qui S'APPLIQUERAIT (data plane `migrations/plan`). */
export interface MigrationPlan {
  formatVersion: number;
  connector: string;
  pending: PendingMigration[];
}

/** Ce qu'une application a fait (data plane `migrations/apply`). */
export interface MigrationApplied {
  formatVersion: number;
  connector: string;
  runId: string;
  applied: { source: string; tag: string; executionMs: number }[];
}

/** Le plan, ou l'empêchement. */
export type MigrationPlanReply = MigrationPlan | MigrationFailure;

/** Le compte rendu, ou l'empêchement. */
export type MigrationApplyReply = MigrationApplied | MigrationFailure;
