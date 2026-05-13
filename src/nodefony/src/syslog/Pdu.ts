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
  SysLogSeverity
).reduce(
  (acc, [key, value]) => {
    acc[key as Severity] = value as Severity;
    return acc;
  },
  {} as Record<Severity, Severity>
);

// Pre-built reverse map: numeric severity → name key (O(1) lookup vs O(n) filter per PDU)
const severityNameMap = new Map<number, keyof typeof SysLogSeverity>(
  (
    Object.entries(SysLogSeverity).filter(
      ([, v]) => typeof v === "number"
    ) as [string, number][]
  ).map(([k, v]) => [v, k as keyof typeof SysLogSeverity])
);

// Fast inline typeof for PDU payload — avoids lodash overhead on hot log path
const fastTypeOf = (value: unknown): string | null => {
  if (value === null) return null;
  const t = typeof value;
  if (t !== "object") return t;
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (value instanceof RegExp) return "RegExp";
  if (value instanceof Error) return "Error";
  if (Buffer.isBuffer(value)) return "buffer";
  return "object";
};

/**
 *  Protocol Data Unit
 * @class  PDU
 * @constructor
 * @module library
 * @return {PDU}
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

  constructor(
    pci: Pci,
    severity?: Severity,
    moduleName: ModuleName = "nodefony",
    msgid: Msgid = "",
    msg: Message = "",
    date?: PduDate
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
  }

  static sysLogSeverity() {
    return sysLogSeverityObj;
  }

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
      SysLogSeverity[severity as number]
    );
    return severityKey !== undefined ? severityKey : undefined;
  }

  getDate(): string {
    return new Date(this.timeStamp).toTimeString();
  }

  toString(): string {
    return `TimeStamp:${this.getDate()}  Log:${this.payload}  ModuleName:${
      this.moduleName
    }  SeverityName:${this.severityName}  MessageID:${this.msgid}  UID:${
      this.uid
    }  Message:${this.msg}`;
  }

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
