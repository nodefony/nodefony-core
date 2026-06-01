/**
 * Contrat du **Log Backplane** (axe DESTINATION queryable, LB.0).
 *
 * À NE PAS confondre avec {@link ILogSink} (LB.W) : `ILogSink` écrit la **ligne
 * texte** déjà coalescée (`writeOut(s: string)`) vers stdout/fichier/null et ne
 * voit jamais les Pdu structurés → incapable de relire/filtrer. `ILogDriver`, lui,
 * est la **destination des Pdu structurés** : il sait les **stocker** (write) ET
 * les **relire** (query). Les deux sont liés dans le même driver (cohérence
 * « j'écris dans Elastic → je relis dans Elastic »).
 *
 * - `memory` (défaut dev) : le ring buffer `Syslog` EST le stockage → `query`
 *   = {@link filterPdus} sur `syslog.ringStack`. Aucun write dédié (le ring est
 *   alimenté par `Syslog.pushStack`).
 * - `file` (JSONL, LB.2), `elastic`/`loki` (LB.4) : write = persistance des Pdu,
 *   query = scan / API externe. Drivers Node-only enregistrés à part.
 *
 * Le driver actif est sélectionné par {@link logDriverRegistry} (config/env, ou
 * action de contrôle dev-only). Le **bus temps réel** (`syslog:stream`) reste
 * indépendant : il diffuse les Pdu live quel que soit le driver (même non-queryable).
 */
export interface ILogDriver {
  /** Nom unique du driver (`"memory"` | `"file"` | `"elastic"` | custom). */
  readonly name: string;
  /** Ce que le driver sait faire (pilote l'UI Studio + le contrat data-plane). */
  readonly capabilities: ILogDriverCapabilities;
  /**
   * Interroge la destination — chemin **FROID** (admin/debug), `async`, **JAMAIS**
   * dans le pipeline requête. Absent si `capabilities.query === false` (ex. `console`).
   *
   * @param criteria - critères de filtrage (tous optionnels, combinés en AND).
   * @returns enregistrements (récents d'abord) + total avant pagination.
   */
  query?(criteria: ILogQueryCriteria): Promise<ILogQueryResult>;
  /**
   * Sonde de SANTÉ de la destination (chemin FROID, admin) — « est-ce que la cible
   * répond, en combien de temps, et quelques infos utiles ? ». Présent surtout sur
   * les drivers DISTANTS (loki/opensearch) où la joignabilité n'est pas acquise ;
   * absent sur les drivers locaux triviaux (memory). Ne `throw` JAMAIS : un échec se
   * traduit par `{ ok:false, detail }` (l'admin doit voir la panne, pas un crash).
   *
   * @returns joignabilité + latence + infos (version, statut, nb d'entrées…).
   */
  probe?(): Promise<ILogDriverProbe>;
}

/**
 * Résultat d'une {@link ILogDriver.probe} — santé d'une destination de logs.
 * Affiché par Studio (badge joignable/latence + infos) ; jamais de credential.
 */
export interface ILogDriverProbe {
  /** `true` si la destination répond correctement. */
  ok: boolean;
  /** Latence aller-retour de la sonde (ms). */
  latencyMs: number;
  /** Message d'erreur si `ok === false` (jamais de secret). */
  detail?: string;
  /** Infos utiles à afficher (version, statut cluster, nb d'entrées, endpoint…). */
  info?: Record<string, string | number>;
}

/** Capacités déclarées d'un driver (introspection Studio + garde-fous endpoint). */
export interface ILogDriverCapabilities {
  /** Le driver persiste les Pdu (≠ ring volatile). `memory` = false (volatile). */
  readonly write: boolean;
  /** Le driver expose `query()` (relecture filtrée). `console` = false. */
  readonly query: boolean;
  /** Le driver peut alimenter un flux temps réel (tap `onLog`). */
  readonly stream: boolean;
}

/**
 * Critères de requête — tous optionnels, combinés en **AND**. Vide = tout (borné
 * par `limit`). Les comparaisons string sont insensibles à la casse. `requestId`
 * matche **exactement** (trace full-stack ciblée d'UNE requête) ; `module`/`msgid`/
 * `text` matchent par **inclusion**.
 */
export interface ILogQueryCriteria {
  /** Corrélation log↔requête (ALS) — match EXACT. La clé de la trace full-stack. */
  requestId?: string;
  /** Nom(s) de sévérité RFC 5424 (`"ERROR"` ou `["ERROR","CRITIC"]`). Insensible casse. */
  severity?: string | string[];
  /** Nom de module/service — inclusion insensible à la casse. */
  module?: string;
  /** Catégorie de message (msgid) — inclusion insensible à la casse. */
  msgid?: string;
  /** Borne basse du `timeStamp` (epoch ms, inclus). */
  from?: number;
  /** Borne haute du `timeStamp` (epoch ms, inclus). */
  to?: number;
  /** Recherche plein-texte (payload string + msg + module + msgid). Insensible casse. */
  text?: string;
  /** Nombre max d'enregistrements renvoyés (le driver borne à un plafond sûr). */
  limit?: number;
  /** Décalage de pagination (depuis le plus récent). */
  offset?: number;
  /**
   * Ordre chronologique des `rows` :
   *  - `"desc"` (DÉFAUT) : du plus RÉCENT au plus ancien (entrée naturelle d'un viewer) ;
   *  - `"asc"` : du plus ANCIEN au plus récent (lecture chronologique d'une trace).
   *
   * L'ordre s'appuie sur l'`uid` du Pdu (compteur monotone d'émission) → garantit
   * la **chronologie exacte même à `timeStamp` égal** (plusieurs logs dans la même ms).
   */
  order?: "asc" | "desc";
}

/**
 * Forme **wire** d'un Pdu (isomorphe) — sérialisation stable partagée par TOUTES
 * les façades (endpoint data-plane, canal `syslog:stream`, drivers). Le front
 * réhydrate via `Object.assign(new Pdu(""), record)` → une seule logique de rendu.
 * Produite par {@link pduToRecord}.
 */
export interface ILogRecord {
  uid: number;
  severity: number;
  severityName: string;
  moduleName: string;
  msgid: string;
  msg: string;
  timeStamp: number;
  /** PID émetteur (procid RFC 5424) — groupe par worker en cluster. */
  pid: number;
  /** Corrélation requête (ALS) si présent. `undefined` ignoré par `JSON.stringify`. */
  requestId?: string;
  /** Contenu brut (string/Error/objet). Narrower côté lecteur. */
  payload: unknown;
}

/** Résultat d'une requête : enregistrements (récents d'abord) + méta de pagination. */
export interface ILogQueryResult {
  /** Enregistrements du plus RÉCENT au plus ancien, après `offset`/`limit`. */
  rows: ILogRecord[];
  /** Nombre total d'enregistrements qui matchent les critères (avant pagination). */
  total: number;
  /** `true` s'il reste des résultats au-delà de la fenêtre renvoyée. */
  truncated: boolean;
}

/**
 * Sous-ensemble des champs d'un `Pdu` lus par {@link filterPdus} et
 * {@link pduToRecord}. Permet de filtrer/projeter SANS instancier un `Pdu` — son
 * constructeur incrémente un compteur d'`uid` et lit le `requestIdProvider`, donc
 * effets de bord à proscrire lors d'une simple RELECTURE. Un `Pdu` le satisfait
 * structurellement ; un enregistrement relu d'un fichier JSONL (driver `file`,
 * LB.2) aussi → une SEULE logique de filtrage pour memory, file et le futur CLI.
 */
export interface IPduLike {
  uid: number;
  severity: number;
  severityName: string;
  moduleName: string;
  msgid: string;
  msg: string;
  timeStamp: number;
  pid: number;
  payload: unknown;
  requestId?: string;
}

/**
 * Sérialise un Pdu en {@link ILogRecord} (forme wire). Source unique de la
 * projection Pdu→wire : réutilisée par {@link filterPdus} (driver memory) ET par
 * le producteur data-plane `syslog` (framework) — pas de shape dupliqué qui dérive.
 *
 * @param pdu - Pdu (instance ou objet structurellement compatible — {@link IPduLike}).
 * @returns enregistrement plat sérialisable. `requestId` omis si absent.
 */
export function pduToRecord(pdu: IPduLike): ILogRecord {
  const rec: ILogRecord = {
    uid: pdu.uid,
    severity: pdu.severity,
    severityName: pdu.severityName,
    moduleName: pdu.moduleName,
    msgid: pdu.msgid,
    msg: pdu.msg,
    timeStamp: pdu.timeStamp,
    pid: pdu.pid,
    payload: pdu.payload,
  };
  if (pdu.requestId !== undefined) rec.requestId = pdu.requestId;
  return rec;
}
