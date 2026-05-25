/**
 * Types & constantes PARTAGÉS du dashboard ORM (`/nodefony/orm`) et de la page
 * drill par worker (`/nodefony/orm/:pid`). Extraits d'`OrmOverview` (2500+ lignes)
 * pour partager le contrat sans copie et alléger le coût de relecture (cache).
 *
 * Frontière isomorphe : ces types MIROIRENT le data plane `/nodefony/orm/api/*` —
 * jamais d'import runtime serveur (cf `utils/realtimeHealth.ts` pour `realtime:health`).
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
  orm: string;
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
  sequelize: "Sequelize",
  mongoose: "Mongoose",
  mikroorm: "MikroORM",
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

/** Flux d'un connecteur (canal `orm:flow` / `GET /orm/api/flow`) — sous-ensemble consommé. */
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
