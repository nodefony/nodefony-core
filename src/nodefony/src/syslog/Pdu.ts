// Pci est unknown : le payload d'un log peut être n'importe quoi (Error, string, object…).
// Les lecteurs de pdu.payload doivent narrower le type explicitement.
export type Pci = unknown;
export type ModuleName = string;
export type Message = string;
export type Msgid = string;
export type PduDate = string | number | Date;
export type Status = "NOTDEFINED" | "INVALID" | "ACCEPTED" | "DROPPED";

type SeverityKeys = keyof typeof SysLogSeverity;
type SeverityValues = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | -1;
export type Severity = SeverityKeys | SeverityValues;

/*
 * Severity syslog
 * <pre>
 *    EMERGENCY   = 0
 *    ALERT       = 1
 *    CRITIC      = 2
 *    ERROR       = 3
 *    WARNING     = 4
 *    NOTICE      = 5
 *    INFO        = 6
 *    DEBUG       = 7
 * </pre>
 */
enum SysLogSeverity {
  EMERGENCY = 0,
  ALERT = 1,
  CRITIC = 2,
  ERROR = 3,
  WARNING = 4,
  NOTICE = 5,
  INFO = 6,
  DEBUG = 7,
  SPINNER = -1,
}

const sysLogSeverity: SysLogSeverity[] = [
  SysLogSeverity.EMERGENCY,
  SysLogSeverity.ALERT,
  SysLogSeverity.CRITIC,
  SysLogSeverity.ERROR,
  SysLogSeverity.WARNING,
  SysLogSeverity.NOTICE,
  SysLogSeverity.INFO,
  SysLogSeverity.DEBUG,
  SysLogSeverity.SPINNER,
];

/**
 * Les noms de sévérité RFC 5424, **dans l'ordre de l'enum** (l'index EST la
 * valeur : `SEVERITY_NAMES[3] === "ERROR"`). `SPINNER` (-1) en est absent :
 * c'est une extension d'affichage CLI, jamais un niveau de journal.
 *
 * Source **unique** du vocabulaire, côté serveur comme côté navigateur (le
 * bundle client la réexporte). Elle existe parce qu'elle était écrite trois
 * fois — deux copies dans la console d'administration, dans deux ORDRES
 * différents, et aucune côté data plane, si bien qu'un `?severity=CRITICAL`
 * n'était refusé nulle part : il rendait le journal entier.
 *
 * Pour un sélecteur qui va du moins au plus grave, lire `[...SEVERITY_NAMES]
 * .reverse()` — l'ordre d'affichage se dérive, il ne se redéclare pas.
 */
export const SEVERITY_NAMES = [
  "EMERGENCY",
  "ALERT",
  "CRITIC",
  "ERROR",
  "WARNING",
  "NOTICE",
  "INFO",
  "DEBUG",
] as const;

/** Un nom de sévérité RFC 5424 (hors extension `SPINNER`). */
export type SeverityName = (typeof SEVERITY_NAMES)[number];

/**
 * `moduleName` porté par une entrée de journal venue d'un NAVIGATEUR.
 *
 * Valeur de confiance : le pod l'impose lui-même en recevant un lot sur le canal
 * montant, sans jamais reprendre ce que la page prétend être. Une ligne qui la porte
 * a donc traversé ce canal, et rien d'autre ne peut la produire.
 *
 * Elle vit ICI, dans le cœur isomorphe, pour la même raison que
 * {@link SEVERITY_NAMES} : le serveur l'écrit, le navigateur la lit pour distinguer
 * ces lignes à l'écran. Une copie côté console d'administration dériverait le jour
 * où le mot change — et un écran qui ne reconnaît plus l'origine ne se plaint pas,
 * il affiche simplement une ligne de plus au milieu des autres.
 */
export const BROWSER_ORIGIN = "browser";

const translateSeverity = function (severity: Severity = "INFO"): number {
  if (typeof severity === "number") {
    if (severity === SysLogSeverity.SPINNER) return SysLogSeverity.SPINNER;
    if (sysLogSeverity[severity] !== undefined) {
      return sysLogSeverity[severity];
    } else {
      throw new Error(`Not a valid nodefony syslog severity: ${severity}`);
    }
  } else {
    if (SysLogSeverity[severity] !== undefined) {
      return SysLogSeverity[severity];
    } else {
      throw new Error(`Not a valid nodefony syslog severity: ${severity}`);
    }
  }
};

const sysLogSeverityObj: Record<Severity, Severity> = Object.entries(
  SysLogSeverity,
).reduce(
  (acc, [key, value]) => {
    acc[key as Severity] = value as Severity;
    return acc;
  },
  {} as Record<Severity, Severity>,
);

// Pre-built reverse map: numeric severity → name key (O(1) lookup vs O(n) filter per PDU)
const severityNameMap = new Map<number, keyof typeof SysLogSeverity>(
  (
    Object.entries(SysLogSeverity).filter(([, v]) => typeof v === "number") as [
      string,
      number,
    ][]
  ).map(([k, v]) => [v, k as keyof typeof SysLogSeverity]),
);

// `Buffer` n'existe pas en navigateur (Core isomorphe) — accès via globalThis
// pour compiler sous tsconfigClient `types: []`. undefined côté browser → skip.
const _gBuffer = (globalThis as { Buffer?: { isBuffer(v: unknown): boolean } })
  .Buffer;

// `process` n'existe pas en navigateur (Core isomorphe) — accès via globalThis pour
// compiler sous tsconfigClient `types: []`. Capturé UNE seule fois (process.pid ne change
// jamais) → 0 appel système par log (hot path). = procid RFC 5424 : identifie le PROCESS
// émetteur → en cluster, permet de grouper/filtrer les logs PAR WORKER (ring buffer,
// nodefony:syslog, transports JSON). Browser → 0.
const PID = (globalThis as { process?: { pid?: number } }).process?.pid ?? 0;

// Fast inline typeof for PDU payload — avoids lodash overhead on hot log path
const fastTypeOf = (value: unknown): string | null => {
  if (value === null) return null;
  const t = typeof value;
  if (t !== "object") return t;
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (value instanceof RegExp) return "RegExp";
  if (value instanceof Error) return "Error";
  if (_gBuffer?.isBuffer(value)) return "buffer";
  return "object";
};

/**
 * Process Data Unit — entrée de log unitaire conforme RFC 5424.
 *
 * Une instance représente un événement de log dans le pipeline Syslog.
 * Stockée dans le `CircularBuffer` (O(1)) et diffusée aux transports
 * via l'event `onLog` du {@link Syslog}.
 *
 * @example
 * ```ts
 * const pdu = new Pdu("user logged in", "INFO", "AUTH", "USER_LOGIN", "user@example.com");
 * pdu.severity;      // 6
 * pdu.severityName;  // "INFO"
 * pdu.payload;       // "user logged in"
 * ```
 *
 * @remarks `pdu.severity` est numérique (RFC 5424) pour comparaisons rapides.
 *   `pdu.severityName` est la string (`"INFO"`, `"CRITIC"` — pas `"CRITICAL"`).
 */
let guid = 0;
class Pdu {
  public payload: Pci;
  public uid: number;
  public severity: number;
  public timeStamp: number;
  public severityName: keyof typeof SysLogSeverity;
  public typePayload: string | null;
  public moduleName: ModuleName;
  public msgid: Msgid;
  public msg: Message;
  public status: Status;
  /** PID du process émetteur (= procid RFC 5424). Constant, capturé au chargement du module. */
  public pid: number;
  /**
   * Identifiant de la requête en cours (corrélation log↔requête).
   *
   * Présent UNIQUEMENT si le Pdu est créé dans une bulle `RequestContext` active
   * (ALS Node) ET que {@link Pdu.requestIdProvider} a été branché côté Node — voir
   * `src/index.ts` (barrel Node uniquement, isomorphisme préservé : le bundle
   * client/browser ne branche pas, le provider reste `null` → 0 alloc, 0 lecture).
   *
   * Combiné à `pid` (procid RFC 5424), permet la corrélation **complète** :
   * `pid` = quel worker, `requestId` = quelle requête. Voyage dans ring buffer +
   * `nodefony:syslog` + transports JSON (champ public sérialisé naturellement).
   */
  public requestId?: string;

  /**
   * Provider injectable du `requestId` courant (ALS). Branché par le barrel
   * Node (`src/index.ts`) sur `RequestContext.getRequestId`. Reste `null` côté
   * browser/debugbar (le bundle client n'importe pas `node:async_hooks`) et
   * pendant les phases boot pré-Kernel (cohérent : pas de requête en cours).
   *
   * Coût : 1 test de référence par Pdu (~5 ns) quand `null` ; ~50-100 ns quand
   * branché (lecture ALS + accès propriété). Pas d'alloc supplémentaire si
   * `requestId` est `undefined` (le champ reste non-défini sur l'instance).
   */
  static requestIdProvider: (() => string | undefined) | null = null;

  /**
   * Construit un Pdu prêt à être publié dans le pipeline Syslog.
   *
   * @param pci - payload (string, Error, objet — typé `unknown`, narrower côté lecteur).
   * @param severity - niveau RFC 5424 (string `"INFO"` ou numérique `6`). Défaut `"INFO"`.
   * @param moduleName - nom du module/service qui a produit le log. Défaut `"nodefony"`.
   * @param msgid - catégorie de message (`"AUTH"`, `"ROUTER"`, etc.). Défaut `""`.
   * @param msg - détail libre optionnel. Défaut `""`.
   * @param date - timestamp (number, Date, ou string parsable). Défaut `Date.now()`.
   * @throws Si `severity` n'est pas une valeur valide de {@link SysLogSeverity}.
   */
  constructor(
    pci: Pci,
    severity?: Severity,
    moduleName: ModuleName = "nodefony",
    msgid: Msgid = "",
    msg: Message = "",
    date?: PduDate,
  ) {
    // Fast timestamp — avoid Date object creation when date is not provided
    if (date === undefined) {
      this.timeStamp = Date.now();
    } else if (typeof date === "number") {
      this.timeStamp = date;
    } else if (date instanceof Date) {
      this.timeStamp = date.getTime();
    } else {
      this.timeStamp = new Date(date).getTime();
    }
    this.uid = ++guid;
    this.severity = translateSeverity(severity);
    const sName = severityNameMap.get(this.severity);
    if (sName === undefined) {
      throw new Error(`Invalid severity value: ${this.severity}`);
    }
    this.severityName = sName;
    this.typePayload = fastTypeOf(pci);
    this.payload = pci;
    this.moduleName = moduleName;
    this.msgid = msgid;
    this.msg = msg;
    this.status = "NOTDEFINED";
    this.pid = PID; // constant module-level → 1 assignation, 0 appel système
    // Lecture lazy ALS via provider injectable (isomorphisme préservé) :
    // - null côté browser/avant branchement → 1 test de référence, no-op.
    // - non-null + hors bulle ALS → provider retourne undefined → slot initialisé à undefined.
    // - non-null + dans bulle ALS → on capture le requestId courant.
    // Slot toujours créé (`this.requestId = ...`) pour que `parseJson` puisse
    // réhydrater le champ depuis le wire format (`key in this` doit être vrai).
    // JSON.stringify ignore les valeurs `undefined` → 0 verbosité dans le wire.
    this.requestId =
      Pdu.requestIdProvider !== null ? Pdu.requestIdProvider() : undefined;
  }

  /**
   * Map bidirectionnelle des sévérités RFC 5424 (`{ INFO: 6, 6: "INFO", ... }`).
   *
   * @returns dictionnaire `{ severityName: severityValue }` plus enum reverse.
   */
  static sysLogSeverity() {
    return sysLogSeverityObj;
  }

  /**
   * Convertit une sévérité numérique ou string en son nom canonique.
   *
   * @param severity - valeur numérique (`6`) ou string (`"INFO"` ou `"6"`).
   * @returns nom canonique (`"INFO"`) ou `undefined` si invalide.
   */
  static severityToString(severity: number | string): string | undefined {
    const numericSeverity =
      typeof severity === "string" ? parseInt(severity, 10) : severity;
    if (
      !isNaN(numericSeverity) &&
      SysLogSeverity[numericSeverity] !== undefined
    ) {
      return SysLogSeverity[numericSeverity];
    }
    const severityKey = Pdu.severityToString(
      SysLogSeverity[severity as number],
    );
    return severityKey !== undefined ? severityKey : undefined;
  }

  /**
   * Retourne le timestamp formaté `HH:MM:SS GMT±HHMM (TZ Name)`.
   *
   * @returns time string lisible par humain.
   */
  getDate(): string {
    return new Date(this.timeStamp).toTimeString();
  }

  /**
   * Sérialise le Pdu en string mono-ligne pour transport console/file.
   *
   * @returns ligne formatée `TimeStamp:... Log:... ModuleName:... SeverityName:... MessageID:... UID:... Message:...`.
   */
  toString(): string {
    return `TimeStamp:${this.getDate()}  Log:${this.payload}  ModuleName:${
      this.moduleName
    }  SeverityName:${this.severityName}  MessageID:${this.msgid}  UID:${
      this.uid
    }  Message:${this.msg}`;
  }

  /**
   * Réhydrate un Pdu existant à partir d'une string JSON — mute uniquement les
   * clés déjà présentes sur l'instance (filtre `key in this`).
   *
   * @param str - JSON sérialisé d'un Pdu.
   * @returns objet parsé (ou `null` si JSON vide). Mute l'instance courante au passage.
   */
  parseJson(str: string): Record<string, unknown> | null {
    const json = JSON.parse(str) as Record<string, unknown>;
    Object.entries(json).forEach(([key, value]) => {
      if (key in this) {
        (this as Record<string, unknown>)[key] = value;
      }
    });
    return json;
  }
}

export default Pdu;
