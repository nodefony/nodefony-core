/**
 * Sondes ORM — métriques d'observabilité profonde d'un connecteur, poussées via
 * le hub temps réel (`orm:health`) pour un **contrôle total** des ORM.
 *
 * Deux niveaux :
 *  - **générique** (porté par {@link ConnectionMonitor}) : latence, cycle de vie,
 *    erreurs — calculé pareil pour tout adapter.
 *  - **driver-spécifique** ({@link IOrmProbe}, via {@link IOrm.probe}) : stockage,
 *    pool… que seul l'adapter sait extraire (SQLite PRAGMA, pool Mongo…).
 */

/**
 * Fenêtre glissante de latence de ping — `min`/`avg`/`max` sur les N derniers
 * échantillons (révèle les pics, pas seulement l'instantané). `null` tant
 * qu'aucun ping n'a été mesuré.
 */
export interface ILatencyWindow {
  /** Dernière latence mesurée (ms). */
  last: number | null;
  /** Minimum sur la fenêtre (ms). */
  min: number | null;
  /** Moyenne sur la fenêtre (ms). */
  avg: number | null;
  /** Maximum sur la fenêtre (ms). */
  max: number | null;
  /** Nombre d'échantillons dans la fenêtre. */
  samples: number;
}

/**
 * Sonde de stockage — driver-spécifique. Pour SQLite : dérivée des PRAGMA
 * (`page_count`, `page_size`, `journal_mode`, `freelist_count`). Pour un serveur :
 * taille logique de la base si l'adapter sait l'obtenir.
 */
export interface IOrmStorageProbe {
  /** Taille de la base (octets) — `pages × pageSize` (SQLite). */
  sizeBytes?: number;
  /** Nombre de pages allouées. */
  pages?: number;
  /** Taille d'une page (octets). */
  pageSize?: number;
  /** Mode de journalisation (SQLite : `wal`, `delete`, `memory`…). */
  journalMode?: string;
  /** Pages libres (fragmentation / espace récupérable au VACUUM). */
  freePages?: number;
}

/**
 * Sonde de pool de connexions — pertinente pour les bases serveur (Mongo,
 * Postgres, MySQL). SQLite (better-sqlite3) = mono-connexion → non renseigné.
 */
export interface IOrmPoolProbe {
  /** Taille max configurée du pool. */
  size?: number;
  /** Connexions disponibles (idle). */
  available?: number;
  /** Connexions en cours d'utilisation. */
  borrowed?: number;
  /** Demandes en attente d'une connexion. */
  pending?: number;
}

/**
 * Sonde profonde driver-spécifique retournée par {@link IOrm.probe}. Tous les
 * champs sont optionnels : un adapter ne rapporte que ce qu'il sait mesurer.
 */
export interface IOrmProbe {
  /** Métriques de stockage (taille, pages, journal…). */
  storage?: IOrmStorageProbe;
  /** Métriques de pool de connexions (serveurs). */
  pool?: IOrmPoolProbe;
  /** Métriques libres clé→valeur (extensible par adapter, jamais de credential). */
  extra?: Record<string, string | number | boolean>;
}
