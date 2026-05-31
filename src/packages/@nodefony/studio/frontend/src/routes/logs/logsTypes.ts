/**
 * Types de la page **Log Backplane** (Studio).
 *
 * Ce sont des **types miroir locaux** du contrat data-plane `/nodefony/syslog/api/*`
 * (cf `@nodefony/framework` `SyslogAdminApi.ts` + core `ILogDriver.ts`). On NE les
 * importe PAS depuis `nodefony` côté front : règle d'isomorphisme (jamais de module
 * serveur dans le bundle client) + robustesse (la forme wire est plate et stable, un
 * miroir local évite toute surprise de résolution de types cross-package). Ils
 * doivent rester alignés sur `ILogRecord` / `ILogDriverCapabilities` / la réponse
 * de l'endpoint `backplane`. Toute évolution du contrat back → mettre à jour ici.
 */

/** Noms de sévérité RFC 5424 (+ extension). `CRITIC`, jamais `CRITICAL`. */
export const SEVERITIES = [
  "DEBUG",
  "INFO",
  "NOTICE",
  "WARNING",
  "ERROR",
  "CRITIC",
  "ALERT",
  "EMERGENCY",
] as const;

/** Une sévérité RFC 5424. */
export type Severity = (typeof SEVERITIES)[number];

/**
 * Forme **wire** d'un Pdu — miroir de `ILogRecord` (core). Produite par
 * `pduToRecord` côté serveur et partagée par TOUTES les façades : endpoint
 * data-plane (`logs`/`logs/search`) ET canal temps réel `syslog:stream`.
 *
 * `msg` est optionnel : le canal `syslog:stream` ne le sérialise pas toujours
 * (souvent vide) → on dégrade proprement.
 */
export interface LogRecord {
  /** Id incrémental du log (peut se répéter après un redémarrage process). */
  uid: number;
  /** Sévérité numérique RFC 5424 (0 = EMERGENCY … 7 = DEBUG) — tri/comparaison. */
  severity: number;
  /** Sévérité lisible (`"ERROR"`, `"INFO"`…). */
  severityName: string;
  /** Module/service émetteur du log. */
  moduleName: string;
  /** Catégorie de message (msgid : `"KERNEL"`, `"ROUTER"`, `"AUTH"`…). */
  msgid: string;
  /** Détail libre optionnel (souvent absent côté stream). */
  msg?: string;
  /** Horodatage epoch ms. */
  timeStamp: number;
  /** PID émetteur (procid RFC 5424) — groupe par worker en cluster. */
  pid: number;
  /** Contenu brut : string (souvent avec ANSI), Error sérialisée, ou objet. */
  payload: unknown;
  /** Corrélation log↔requête (ALS) — la clé de la **trace full-stack**. */
  requestId?: string;
}

/**
 * Capacités déclarées d'un driver de relecture (axe DESTINATION queryable).
 * Pilotent l'UI : un driver `query:false` (ex. `console`) masque l'Explorer.
 */
export interface LogDriverCapabilities {
  /** Persiste les Pdu (≠ ring volatile). `memory` = false. */
  write: boolean;
  /** Expose `query()` — relecture filtrée. `console` = false. */
  query: boolean;
  /** Peut alimenter un flux temps réel (`syslog:stream`). */
  stream: boolean;
}

/** Un driver enregistré dans le registry (nom + capacités). */
export interface DriverInfo {
  name: string;
  capabilities: LogDriverCapabilities;
}

/**
 * Compteurs du syslog (cumuls monotones → débit dérivé côté lecteur).
 * `buffered` = nombre de Pdu actuellement dans le ring (≠ cumul).
 */
export interface BackplaneCounters {
  valid: number;
  invalid: number;
  missed: number;
  errorTotal: number;
  criticTotal: number;
  buffered: number;
}

/**
 * Méta du Log Backplane (réponse `GET /nodefony/syslog/api/backplane`).
 *
 * Trois axes **orthogonaux** : `activeDriver`/`drivers` (DESTINATION queryable —
 * où l'on RELIT), `write.sink` (axe WRITE LB.W — où la ligne texte est écrite),
 * et le bus temps réel `syslog:stream` (indépendant, non décrit ici).
 */
export interface BackplaneMeta {
  /** Driver de relecture actif (`null` si aucun). */
  activeDriver: DriverInfo | null;
  /** Tous les drivers enregistrés (switchables en dev). */
  drivers: DriverInfo[];
  /** Axe WRITE (orthogonal) : sink où partent les lignes texte. */
  write: { sink: string };
  /** Santé du flux. */
  counters: BackplaneCounters;
  /** Environnement kernel — gouverne la visibilité du switch (dev-only). */
  environment: string | null;
}

/** Résultat paginé de `GET /nodefony/syslog/api/logs/search`. */
export interface LogQueryResult {
  /** Enregistrements du plus RÉCENT au plus ancien (après offset/limit). */
  rows: LogRecord[];
  /** Total des matchs avant pagination. */
  total: number;
  /** `true` s'il reste des résultats au-delà de la fenêtre. */
  truncated: boolean;
}

/** Réponse 409 d'un endpoint query quand le driver actif n'est pas queryable. */
export interface NotQueryable {
  queryable: false;
  driver: string | null;
}
