/**
 * Représentation **canonique et sérialisable** du modèle de données multi-ORM.
 *
 * C'est la pièce maîtresse « IA-first » du data plane ORM : un graphe normalisé
 * (ORM-agnostique) qui sert à la fois :
 *  - la **visualisation** (ERD React Flow côté Studio) ;
 *  - l'**IA** (contexte d'un agent : text-to-SQL, RAG schéma-aware) ;
 *  - l'**interop** (export DBML / JSON Schema / SQL DDL).
 *
 * Une source, plusieurs consommateurs. Le diagramme n'est qu'une projection.
 */

import type {
  ILatencyWindow,
  IOrmStorageProbe,
  IOrmPoolProbe,
} from "./IOrmProbe";

/** Colonne/champ normalisé d'une entité (extrait via {@link IOrm.describeEntity}). */
export interface IColumnInfo {
  /** Nom de la colonne. */
  name: string;
  /** Type natif tel que rapporté par le driver (ex. `text`, `integer`, `String`). */
  type: string;
  /** `true` si clé primaire. */
  primaryKey: boolean;
  /** `true` si la colonne accepte `NULL`. */
  nullable: boolean;
  /** `true` si contrainte d'unicité. */
  unique: boolean;
}

/** Relation projetée pour le graphe (sous-ensemble sérialisable de `IEntityRelation`). */
export interface IRelationInfo {
  /** Cardinalité. */
  type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  /** Entité cible (nom logique). */
  target: string;
  /** Champ portant la relation côté entité courante. */
  field: string;
  /** Clé étrangère (explicite ou dérivée déterministe). */
  foreignKey?: string;
}

/** Nœud du graphe : une entité avec ses colonnes et ses relations. */
export interface IEntityGraphNode {
  /** Nom logique de l'entité. */
  name: string;
  /** Connexion nommée qui porte l'entité (clé de `connectors` en config). */
  connector: string;
  /**
   * Module Nodefony propriétaire (regroupement ERD), `""` si non rattaché.
   */
  module: string;
  /**
   * Classification (domaine fonctionnel) — axe de regroupement ERD distinct du
   * `module`, `""` si non renseigné. Rend une grosse base navigable.
   */
  domain: string;
  /** Colonnes normalisées (vide si l'adapter n'implémente pas `describeEntity`). */
  columns: IColumnInfo[];
  /** Relations déclarées. */
  relations: IRelationInfo[];
}

/** Connexion sous-jacente d'un ORM (extrait via {@link IOrm.describeConnection}). */
export interface IConnectionInfo {
  /**
   * Base/driver sous-jacent en minuscules (`sqlite`, `postgres`, `mysql`,
   * `mariadb`, `mongodb`…) — sert à choisir le logo et qualifier le connecteur.
   */
  driver: string;
  /**
   * Cible lisible : chemin du fichier (SQLite, **relatif** — jamais d'absolu),
   * `host:port/base` (serveur) ou URI redactée. **Jamais de credential** (mot de
   * passe retiré côté adapter).
   */
  target?: string;
  /** Version du moteur/base (ex. SQLite `3.45.1`), si l'adapter peut l'obtenir. */
  version?: string;
  /** Version de la lib ORM elle-même (ex. drizzle-orm `0.44.x`), si connue. */
  ormVersion?: string;
}

/** Résumé d'un ORM/connecteur enregistré. */
export interface IOrmSummary {
  /** Clé du connecteur dans le `OrmRegistry`. */
  name: string;
  /**
   * Vendor de l'adapter en minuscules (`drizzle`, `mongoose`…),
   * dérivé du nom de classe. `""` si indéterminé. Dette : promouvoir en
   * `IOrm.vendor` déclaré par chaque adapter (P7.1 industrialisation ORM).
   */
  vendor: string;
  /** `true` si c'est le connecteur par défaut (`"default"`). */
  default: boolean;
  /** État de la connexion. */
  connected: boolean;
  /** Nombre d'entités rattachées à cet ORM. */
  entityCount: number;
  /** Connexion sous-jacente (driver + cible), si l'adapter l'expose. */
  connection?: IConnectionInfo;
}

/** Erreur de connexion horodatée (message **redacté** — jamais de credential). */
export interface IConnectionError {
  /** Message d'erreur (driver), credential déjà retiré. */
  message: string;
  /** Horodatage epoch ms. */
  ts: number;
}

/**
 * Diagnostic d'un connecteur — réponse de `/nodefony/orm/api/connection/health`.
 * Combine l'état figé ({@link IConnectionInfo}), les compteurs de cycle de vie
 * (connexions, **reconnexions**, **erreurs**) du moniteur, et un **ping live**
 * (round-trip réel mesuré à la requête).
 */
export interface IConnectionHealth {
  /**
   * Identité de l'**instance** (process) qui rapporte — cloud-native : le
   * diagnostic est per-pod (pool DB local au process). Vue multi-pod = agrégation
   * externe (Prometheus / fan-out Redis P13).
   */
  instanceId: string;
  /** Clé du connecteur. */
  name: string;
  /** Vendor ORM (`drizzle`, `mongoose`…). */
  vendor: string;
  /** Base/driver (`sqlite`, `mongodb`…). */
  driver: string;
  /** Cible lisible (chemin relatif / host:port), jamais de credential. */
  target?: string;
  /** Version moteur. */
  version?: string;
  /** Version lib ORM. */
  ormVersion?: string;
  /** État courant (`isConnected`). */
  connected: boolean;
  /** Connecté depuis (epoch ms), `null` si jamais connecté. */
  connectedSince: number | null;
  /** Durée depuis la dernière connexion réussie (ms), `null` si jamais. */
  uptimeMs: number | null;
  /** Nombre total de connexions réussies. */
  connectCount: number;
  /** Reconnexions (connexions au-delà de la première). */
  reconnectCount: number;
  /** Nombre total d'erreurs enregistrées (connexion + ping). */
  errorCount: number;
  /** Dernière erreur, `null` si aucune. */
  lastError: IConnectionError | null;
  /** Erreurs récentes (ring borné, plus récentes d'abord). */
  recentErrors: IConnectionError[];
  /** Latence de la dernière connexion réussie (ms), `null` si inconnue. */
  lastConnectMs: number | null;
  /** Latence du ping live (ms), `null` si non pingable / déconnecté. */
  pingMs: number | null;
  /** `true` si le ping live a réussi. */
  pingOk: boolean;
  /** Message d'erreur du ping live, `null` si OK. */
  pingError: string | null;
  /** Fenêtre glissante de latence (min/moy/max sur les N derniers pings). */
  latency: ILatencyWindow;
  /** Sonde de stockage (driver), si l'adapter l'expose. */
  storage?: IOrmStorageProbe;
  /** Sonde de pool de connexions (driver), si l'adapter l'expose. */
  pool?: IOrmPoolProbe;
  /** Métriques driver libres (clé→valeur). */
  extra?: Record<string, string | number | boolean>;
}

/** Graphe complet du modèle de données — réponse de `/nodefony/orm/api/graph`. */
export interface IOrmGraph {
  /** ORMs/connecteurs enregistrés. */
  orms: IOrmSummary[];
  /** Entités (colonnes + relations), éventuellement filtrées par ORM. */
  entities: IEntityGraphNode[];
}
