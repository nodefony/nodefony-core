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

import { SEVERITY_NAMES } from "nodefony";
import type { SeverityName } from "nodefony";

/**
 * Noms de sévérité RFC 5424, du moins au plus grave — l'ordre d'AFFICHAGE du
 * sélecteur, **dérivé** de la source unique du cœur (`SEVERITY_NAMES`, qui va
 * dans l'ordre inverse : son index est la valeur RFC).
 *
 * C'était une liste recopiée. Il y en avait une seconde, dans un autre ordre,
 * quelques fichiers plus loin — et aucune côté serveur, si bien que le data
 * plane n'avait rien à quoi confronter un `?severity=CRITICAL`.
 *
 * L'import de VALEUR depuis `nodefony` est isomorphe : c'est le même patron que
 * `pduProtocol` ou `PLATFORM_CHANNELS`, déjà tirés du bundle client. La règle
 * du miroir local ci-dessus vise la FORME WIRE des enregistrements, pas les
 * vocabulaires partagés — un vocabulaire recopié se périme, un type miroir non.
 */
export const SEVERITIES: readonly SeverityName[] = [
  ...SEVERITY_NAMES,
].reverse();

/** Une sévérité RFC 5424. */
export type Severity = SeverityName;

/**
 * Forme **wire** d'un Pdu — miroir de `ILogRecord` (core). Produite par
 * `pduToRecord` côté serveur et partagée par TOUTES les façades : endpoint
 * data-plane (`logs`/`logs/search`) ET canal temps réel `nodefony:syslog`.
 *
 * `msg` est optionnel : le canal `nodefony:syslog` ne le sérialise pas toujours
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
  /** Peut alimenter un flux temps réel (`nodefony:syslog`). */
  stream: boolean;
}

/** Un driver enregistré dans le registry (nom + capacités). */
export interface DriverInfo {
  name: string;
  capabilities: LogDriverCapabilities;
}

/**
 * Transport d'écriture (axe WRITE — `ITransport.name`). Polymorphe : `console`
 * (stdout), `file`, `loki`, `opensearch`, `syslog` (RFC 5424), `http`. `enabled`
 * = reçoit réellement les écritures (togglable à chaud en dev).
 */
export interface TransportInfo {
  name: string;
  enabled: boolean;
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
  /** Plafond du ring (`maxStack`) → l'UI montre « buffered / bufferCapacity ». */
  bufferCapacity?: number;
}

/**
 * Méta du Log Backplane (réponse `GET /nodefony/syslog/api/backplane`).
 *
 * Trois axes **orthogonaux** : `activeDriver`/`drivers` (DESTINATION queryable —
 * où l'on RELIT), `write.sink` (axe WRITE LB.W — où la ligne texte est écrite),
 * et le bus temps réel `nodefony:syslog` (indépendant, non décrit ici).
 */
export interface BackplaneMeta {
  /** Driver de relecture actif (`null` si aucun). */
  activeDriver: DriverInfo | null;
  /** Tous les drivers enregistrés (switchables en dev). */
  drivers: DriverInfo[];
  /**
   * Axe WRITE (orthogonal au READ). L'écriture est un **fan-out** : 1 log → N
   * transports. `sink` = sink LB.W (où part la ligne texte : fd file / stdout) ;
   * `transports` = vraies destinations montées (`ITransport.name` : `console`,
   * `file`, `loki`, `syslog`…). `transports` optionnel = robustesse si dist back
   * périmé (fallback : inférer depuis les drivers, ancien comportement).
   */
  write: {
    sink: string;
    /** Sink texte écrit-il ? `false` = muté à chaud (console/fichier coupé). */
    sinkEnabled?: boolean;
    transports?: TransportInfo[];
    /** Stockage mémoire (ring) actif ? `false` = Explorer « mémoire » à 0. */
    ringEnabled?: boolean;
    /** Diffusion temps réel (nodefony:syslog) active ? `false` = onglet Live grisé. */
    streamEnabled?: boolean;
    /** Dossier des fichiers JSONL (driver file/cluster-file) — `null` en prod. */
    logDir?: string | null;
  };
  /** Santé du flux. */
  counters: BackplaneCounters;
  /** Environnement kernel — gouverne la visibilité du switch (dev-only). */
  environment: string | null;
  /**
   * Topologie process (optionnel = robustesse si dist back périmé → supposé
   * mono). En cluster, le data plane est servi par UN worker round-robin → la
   * relecture est partielle sauf si le driver actif agrège le cluster
   * (`cluster-file`). `pid` = worker qui a répondu à CETTE requête.
   */
  cluster?: ClusterTopology;
}

/** Topologie process renvoyée par `backplane` — gouverne l'avertissement de vue partielle. */
export interface ClusterTopology {
  /** `true` si le kernel tourne en cluster multi-worker (`NODEFONY_CLUSTER=1`). */
  isCluster: boolean;
  /** PID du worker ayant servi la requête `backplane` (round-robin en cluster). */
  pid: number;
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
