/* eslint-disable @typescript-eslint/no-explicit-any */
import {typeOf} from "../Tools"
export type Pci = any
export type ModuleName = string
export type Message = string
export type Msgid = string
export type PduDate = string | number | Date
export type Status  = "NOTDEFINED" | "INVALID"| "ACCEPTED" | "DROPPED"

type SeverityKeys = keyof typeof SysLogSeverity
type SeverityValues= | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | -1
export type Severity = SeverityKeys |  SeverityValues;

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

const sysLogSeverityObj: Record<Severity, Severity> = Object.entries(SysLogSeverity).reduce(
  (acc, [key, value]) => {
    acc[key as Severity] = value as Severity;
    return acc;
  },
  {} as Record<Severity, Severity>
);

/**
   *  Protocol Data Unit
   * @class  PDU
   * @constructor
   * @module library
   * @return {PDU}
   */
let guid = 0;
class Pdu {

  public payload : Pci
  public uid : number
  public severity : number
  public timeStamp : number
  public severityName: keyof typeof SysLogSeverity
  public typePayload: unknown
  public moduleName : ModuleName
  public msgid: Msgid
  public msg: Message
  public status : Status

  constructor (
    pci: Pci,
    severity?: Severity,
    moduleName: ModuleName = "nodefony",
    msgid: Msgid = "",
    msg: Message = "",
    date: PduDate = new Date()
  ) {
    /* timeStamp @type Date*/
    this.timeStamp = this.convertToDate(date).getTime();
  
    /* uid */
    this.uid = ++guid;

    /* severity */
    this.severity = translateSeverity(severity);

    /* severityName */
    this.severityName = this.getSeverityName(this.severity)

    /* typePayload */
    this.typePayload = typeOf(pci);

    /* protocole controle information */
    this.payload = pci;

    /* moduleName */
    this.moduleName = moduleName;

    /* msgid */
    this.msgid = msgid;

    /* msg */
    this.msg = msg;

    /* staus */
    this.status = "NOTDEFINED";
  }

  private getSeverityName(severity: SysLogSeverity): keyof typeof SysLogSeverity {
    // Obtenez la clé pour la valeur enum
    const keys = Object.keys(SysLogSeverity).filter((key) => SysLogSeverity[key as keyof typeof SysLogSeverity] === severity);

    if (keys.length === 1) {
      return keys[0] as keyof typeof SysLogSeverity;
    }
    throw new Error(`Impossible de trouver la clé pour la valeur ${severity}`);
  }

  private convertToDate(value: PduDate): Date {
    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value);
    } else if (value instanceof Date) {
      return value;
    } else {
      throw new Error(`Invalid PduDate format: ${value}`);
    }
  }

  static sysLogSeverity () {
    return sysLogSeverityObj;
  }

  static severityToString  (severity: number | string): string | undefined  {
    const numericSeverity = typeof severity === 'string' ? parseInt(severity, 10) : severity;
    if (!isNaN(numericSeverity) && SysLogSeverity[numericSeverity] !== undefined) {
      return SysLogSeverity[numericSeverity];
    }
    const severityKey =  Pdu.severityToString(SysLogSeverity[severity as number])
    return severityKey !== undefined ? severityKey : undefined;
  }

  /**
     * Get Date in string format
     * @method getDate
     * @return {String} a date in string format .
     */
  getDate () :string{
    return new Date(this.timeStamp).toTimeString();
  }

  /**
     * get a string representating the PDU protocole
     * @method toString
     * @return {String}  .
     */
  toString () :string {
    return `TimeStamp:${this.getDate()
    }  Log:${this.payload
    }  ModuleName:${this.moduleName
    }  SeverityName:${this.severityName
    }  MessageID:${this.msgid
    }  UID:${this.uid
    }  Message:${this.msg}`;
  }

  parseJson(str: string): Record<string, unknown> | null {
    const json = JSON.parse(str);
    Object.entries(json).forEach(([key, value]) => {
      if (key in this) {
        (this as Record<string, unknown>)[key] = value;
      }
    });
    return json
  }
}

export default Pdu;


