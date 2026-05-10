import clc from "cli-color";

import { extend } from "../Tools";
import Pdu, { Severity, ModuleName, Msgid, Message, Pci } from "./Pdu";
import { DebugType, EnvironmentType } from "../types/globals";
import Event from "../Event";
import { ISyslog } from "../types/ISyslog";

const yellow = clc
  ? clc.yellow.bold
  : (ele: string) => ele;
const red = clc
  ? clc.red.bold
  : (ele: string) => ele;
const cyan = clc
  ? clc.cyan.bold
  : (ele: string) => ele;
const blue = clc
  ? clc.blueBright.bold
  : (ele: string) => ele;
const green = clc
  ? clc.green
  : (ele: string) => ele;

type Operator = "<" | ">" | "<=" | ">=" | "==" | "===" | "!=" | "RegExp";
type Condition = "&&" | "||";

// Data est intentionnellement hétérogène : severity (number|string|array),
// msgid (string|RegExp|array), date (Date|string|number).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

interface LogicCondition {
  "&&": (myConditions: ConditionSetting, pdu: Pdu) => boolean;
  "||": (myConditions: ConditionSetting, pdu: Pdu) => boolean;
}

interface Conditions {
  severity: (pdu: Pdu, condition: ConditionSetting) => boolean;
  msgid: (pdu: Pdu, condition: ConditionSetting) => boolean;
  date: (pdu: Pdu, condition: ConditionSetting) => boolean;
  [key: string]: (pdu: Pdu, condition: ConditionSetting) => boolean;
}

export interface ConditionSetting {
  operator?: Operator;
  data: Data;
  [key: string]: Data;
}

export interface conditionsInterface {
  severity?: ConditionSetting;
  msgid?: ConditionSetting;
  data?: Data;
  checkConditions?: Condition;
  [key: string]: Data;
}

export interface SyslogDefaultSettings {
  moduleName?: ModuleName;
  msgid?: Msgid;
  maxStack?: number;
  rateLimit?: boolean | number;
  burstLimit?: number;
  defaultSeverity?: Severity;
  checkConditions?: Condition;
  async?: boolean;
}

export interface WrapperResult {
  logger: (...args: unknown[]) => void;
  text: string;
}

type ComparisonOperator = (
  ele1: number | string,
  ele2: number | string | RegExp
) => boolean;

interface Operators {
  "<": ComparisonOperator;
  ">": ComparisonOperator;
  "<=": ComparisonOperator;
  ">=": ComparisonOperator;
  "==": ComparisonOperator;
  "===": ComparisonOperator;
  "!=": ComparisonOperator;
  RegExp: ComparisonOperator;
}

export type CallbackFunction = (pdu: Pdu) => void;
type CallbackArray = Pdu[];
type Callback = CallbackFunction | CallbackArray | null;

// O(1) circular ring buffer — replaces Array.shift() which is O(n)
class CircularBuffer<T> {
  private buf: Array<T | undefined>;
  private head = 0;
  private _size = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    if (this._size === this.capacity) {
      // Overwrite oldest slot, advance head past it
      this.buf[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    } else {
      const tail = (this.head + this._size) % this.capacity;
      this.buf[tail] = item;
      this._size++;
    }
  }

  get length(): number {
    return this._size;
  }

  last(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buf[(this.head + this._size - 1) % this.capacity] as T;
  }

  clear(): void {
    this.head = 0;
    this._size = 0;
  }

  // Returns elements in FIFO order (oldest first, newest last)
  toArray(): T[] {
    const result = new Array<T>(this._size);
    for (let i = 0; i < this._size; i++) {
      result[i] = this.buf[(this.head + i) % this.capacity] as T;
    }
    return result;
  }
}

const formatDebug = function (debug: DebugType): DebugType {
  if (typeof debug === "boolean") return debug;
  if (typeof debug === "string") {
    if (["false", "undefined", "null"].includes(debug)) return false;
    if (debug === "true" || debug === "*") return true;
    const mytab = debug.split(/,| /);
    return mytab[0] === "*" ? true : mytab;
  }
  if (Array.isArray(debug)) {
    return (debug as string[])[0] === "*" ? true : debug;
  }
  return false;
};

const conditionOptions = function (
  environment: string,
  debug: DebugType = false
): conditionsInterface {
  debug = formatDebug(debug);
  let obj: conditionsInterface;
  if (environment === "development") {
    obj = {
      severity: {
        operator: "<=",
        data: debug === false ? 6 : 7,
      },
    };
  } else {
    obj = {
      severity: {
        operator: "<=",
        data: debug ? 7 : 6,
      },
    };
  }
  if (typeof debug === "object") {
    obj.msgid = {
      operator: "==",
      data: debug,
    };
  }
  return obj;
};

const defaultSettings: SyslogDefaultSettings = {
  moduleName: "SYSLOG",
  msgid: "",
  maxStack: 100,
  rateLimit: false,
  burstLimit: 3,
  defaultSeverity: "DEBUG",
  checkConditions: "&&",
  async: false,
};

const sysLogSeverity = Pdu.sysLogSeverity();

const operators: Operators = {
  "<": (ele1, ele2) => ele1 < ele2,
  ">": (ele1, ele2) => ele1 > ele2,
  "<=": (ele1, ele2) => ele1 <= ele2,
  ">=": (ele1, ele2) => ele1 >= ele2,
  "==": (ele1, ele2) => ele1 == ele2,
  "===": (ele1, ele2) => ele1 === ele2,
  "!=": (ele1, ele2) => ele1 !== ele2,
  RegExp: (ele1, ele2) => (ele2 as RegExp).test(ele1 as string),
};

const conditionsObj: Conditions = {
  severity: (pdu: Pdu, condition: ConditionSetting) => {
    for (const sev in condition.data) {
      if (
        condition.operator &&
        operators[condition.operator](pdu.severity, condition.data[sev])
      ) {
        return true;
      }
    }
    return false;
  },
  msgid: (pdu: Pdu, condition: ConditionSetting) => {
    for (const sev in condition.data) {
      if (condition.operator && operators[condition.operator](pdu.msgid, sev)) {
        return true;
      }
    }
    return false;
  },
  date: (pdu: Pdu, condition: ConditionSetting) =>
    condition.operator
      ? operators[condition.operator](pdu.timeStamp, condition.data)
      : false,
};

const logicCondition: LogicCondition = {
  "&&": (myConditions: ConditionSetting, pdu: Pdu): boolean => {
    let res = false;
    for (const ele in myConditions) {
      res = conditionsObj[ele](pdu, myConditions[ele]);
      if (!res) break;
    }
    return res;
  },
  "||": (myConditions: ConditionSetting, pdu: Pdu): boolean => {
    let res = false;
    for (const ele in myConditions) {
      res = conditionsObj[ele](pdu, myConditions[ele]);
      if (res) break;
    }
    return res;
  },
};

const checkFormatSeverity = (ele: unknown): string[] | number[] => {
  let res: Array<string | number>;
  switch (typeof ele) {
    case "object":
      if (Array.isArray(ele)) {
        res = ele as Array<string | number>;
      } else {
        throw new Error(`checkFormatSeverity bad format type: object`);
      }
      break;
    case "string":
      res = (ele as string).split(/,| /);
      break;
    case "number":
      res = [ele as number];
      break;
    default:
      throw new Error(`checkFormatSeverity bad format type : ${typeof ele}`);
  }
  return res as string[] | number[];
};

const checkFormatDate = function (ele: Date | string): number {
  if (ele instanceof Date) return ele.getTime();
  if (typeof ele === "string") return new Date(ele).getTime();
  throw new Error(`checkFormatDate bad format : ${String(ele)}`);
};

const checkFormatMsgId = function (ele: unknown): RegExp | Array<unknown> {
  if (typeof ele === "string") return ele.split(/,| /);
  if (typeof ele === "number") return [ele];
  if (ele instanceof RegExp) return ele;
  if (Array.isArray(ele)) return ele;
  throw new Error(`checkFormatMsgId bad format ${typeof ele} : ${String(ele)}`);
};

type ConditionFilter = ((pdu: Pdu) => void) | Pdu[];

const wrapperCondition = function (
  this: Syslog,
  conditions: conditionsInterface,
  callback: Callback | CallbackArray
): ConditionFilter {
  let myFuncCondition: (conditions: ConditionSetting, pdu: Pdu) => boolean =
    () => false;

  if (
    conditions.checkConditions &&
    conditions.checkConditions in logicCondition
  ) {
    myFuncCondition = logicCondition[conditions.checkConditions];
    delete conditions.checkConditions;
  } else if (this.settings.checkConditions) {
    myFuncCondition = logicCondition[this.settings.checkConditions];
  }

  const Conditions = sanitizeConditions(conditions);

  if (typeof callback === "function") {
    return (pdu: Pdu) => {
      const res = myFuncCondition(Conditions as ConditionSetting, pdu);
      if (res) {
        (callback as CallbackFunction)(pdu);
      }
    };
  }

  if (Array.isArray(callback)) {
    const tab: Pdu[] = [];
    for (const pdu of callback as CallbackArray) {
      const res = myFuncCondition(Conditions as ConditionSetting, pdu);
      if (res) {
        tab.push(pdu);
      }
    }
    return tab;
  }

  throw new Error("Bad wrapper");
};

const sanitizeConditions = function (
  settingsCondition: conditionsInterface
): boolean | ConditionSetting {
  if (typeof settingsCondition !== "object" || settingsCondition === null) {
    return false;
  }
  for (const ele in settingsCondition) {
    if (!(ele in conditionsObj)) {
      return false;
    }
    const condi: ConditionSetting = settingsCondition[ele];

    if (condi.operator && !(condi.operator in operators)) {
      throw new Error(`Contitions bad operator : ${condi.operator}`);
    }
    if (condi.data) {
      switch (ele) {
        case "severity": {
          if (!condi.operator) {
            condi.operator = "==";
          }
          const res = checkFormatSeverity(condi.data);
          condi.data = {};
          for (let i = 0; i < res.length; i++) {
            const mySeverity = Pdu.severityToString(res[i] as number);
            if (mySeverity) {
              condi.data[mySeverity as Severity] =
                sysLogSeverity[mySeverity as Severity];
            } else {
              return false;
            }
          }
          break;
        }
        case "msgid": {
          if (!condi.operator) {
            condi.operator = "==";
          }
          const res = checkFormatMsgId(condi.data);
          if (Array.isArray(res)) {
            condi.data = {};
            for (let i = 0; i < res.length; i++) {
              condi.data[String(res[i])] = "||";
            }
          } else {
            condi.data = res;
          }
          break;
        }
        case "date": {
          const res = checkFormatDate(condi.data as Date | string);
          if (res) {
            condi.data = res;
          } else {
            return false;
          }
          break;
        }
        default:
          return false;
      }
    } else {
      return false;
    }
  }
  return settingsCondition as unknown as ConditionSetting;
};

const createPDU = function (
  this: Syslog,
  payload: Pci,
  severity?: Severity,
  moduleName?: ModuleName,
  msgid?: Message,
  msg?: Message
): Pdu {
  return new Pdu(
    payload,
    severity || this.settings.defaultSeverity,
    moduleName,
    msgid,
    msg
  );
};

class Syslog extends Event implements ISyslog {
  public settings: SyslogDefaultSettings;
  private _ring: CircularBuffer<Pdu>;
  public burstPrinted: number;
  public missed: number;
  public invalid: number;
  public valid: number;
  public start: number;
  private _async: boolean = false;

  constructor(settings?: SyslogDefaultSettings) {
    super(settings);
    this.settings = extend({}, defaultSettings, settings || {});
    this._ring = new CircularBuffer<Pdu>(this.settings.maxStack ?? 100);
    this.burstPrinted = 0;
    this.missed = 0;
    this.invalid = 0;
    this.valid = 0;
    this.start = 0;
    this._async = (this.settings.async as boolean) || false;
  }

  // ringStack returns elements in FIFO order (oldest first, newest last)
  get ringStack(): Pdu[] {
    return this._ring.toArray();
  }

  static formatDebug(debug: DebugType): DebugType {
    return formatDebug(debug);
  }

  init(
    environment: EnvironmentType,
    debug?: DebugType,
    options?: conditionsInterface
  ): void {
    this.listenWithConditions(
      options || conditionOptions(environment, debug),
      (pdu: Pdu) => Syslog.normalizeLog(pdu)
    );
  }

  get async(): boolean {
    return this._async;
  }

  set async(value: boolean) {
    this._async = value;
  }

  clean(): this {
    return this.reset();
  }

  reset(): this {
    this._ring.clear();
    this.removeAllListeners();
    return this;
  }

  clearLogStack(): void {
    this._ring.clear();
  }

  pushStack(pdu: Pdu): number {
    this._ring.push(pdu);
    this.valid++;
    return this._ring.length;
  }

  log(
    payload: Pci,
    severity?: Severity,
    msgid?: ModuleName,
    msg?: Message
  ): Pdu {
    let pdu: Pdu | undefined;
    if (this.settings.rateLimit !== false) {
      const rate = this.settings.rateLimit as number;
      const now = Date.now();
      this.start = this.start || now;
      if (now > this.start + rate) {
        this.burstPrinted = 0;
        this.missed = 0;
        this.start = 0;
      }
      if (
        this.settings.burstLimit &&
        this.settings.burstLimit > this.burstPrinted
      ) {
        try {
          pdu =
            payload instanceof Pdu
              ? payload
              : createPDU.call(
                  this,
                  payload,
                  severity,
                  this.settings.moduleName,
                  msgid || this.settings.msgid,
                  msg
                );
        } catch (e) {
          console.error(e);
          this.invalid++;
          pdu = pdu ?? createPDU.call(this, e, "ERROR");
          pdu.status = "INVALID";
          return pdu;
        }
        this.pushStack(pdu);
        if (this.listenerCount("onLog") > 0) {
          this.fire("onLog", pdu);
        }
        this.burstPrinted++;
        pdu.status = "ACCEPTED";
        return pdu;
      }
      this.missed++;
      pdu = pdu ?? createPDU.call(this, "DROPPED", "WARNING");
      pdu.status = "DROPPED";
      return pdu;
    }

    try {
      pdu =
        payload instanceof Pdu
          ? payload
          : createPDU.call(
              this,
              payload,
              severity,
              this.settings.moduleName,
              msgid || this.settings.msgid,
              msg
            );
    } catch (e) {
      console.error(e);
      this.invalid++;
      pdu = pdu ?? createPDU.call(this, e, "ERROR");
      pdu.status = "INVALID";
      return pdu;
    }
    this.pushStack(pdu);
    pdu.status = "ACCEPTED";
    if (this.listenerCount("onLog") > 0) {
      this.fire("onLog", pdu);
    }
    return pdu;
  }

  getLogStack(
    start?: number,
    end?: number,
    contition?: conditionsInterface
  ): Pdu[] | Pdu {
    // Fast path: no arguments → last entry without building full array
    if (arguments.length === 0) {
      return this._ring.last() as Pdu;
    }
    let stack: Pdu[];
    if (contition) {
      stack = this.getLogs(contition);
    } else {
      stack = this.ringStack;
    }
    if (!end) {
      return stack.slice(start);
    }
    if (start === end) {
      return stack[stack.length - (start as number) - 1];
    }
    return stack.slice(start, end);
  }

  getLogs(conditions: conditionsInterface, stack: Pdu[] | null = null): Pdu[] {
    if (conditions) {
      return wrapperCondition.call(
        this,
        conditions,
        stack || this.ringStack
      ) as Pdu[];
    }
    return this.ringStack;
  }

  logToJson(conditions: conditionsInterface, stack: Pdu[] | null = null): string {
    const res = conditions ? this.getLogs(conditions, stack) : this.ringStack;
    return JSON.stringify(res);
  }

  loadStack(
    stack: Pdu[] | string,
    doEvent = false,
    beforeConditions: ((pdu: Pdu, stackItem: Pdu) => void) | null = null
  ): Pdu[] {
    if (!stack) {
      throw new Error("syslog loadStack : not stack in arguments ");
    }
    if (typeof stack === "string") {
      return this.loadStack(
        JSON.parse(stack) as Pdu[],
        doEvent,
        beforeConditions
      );
    }
    if (Array.isArray(stack) || typeof stack === "object") {
      for (const stackItem of stack as Pdu[]) {
        const pdu = new Pdu(
          stackItem.payload,
          stackItem.severity as Severity | undefined,
          stackItem.moduleName || this.settings.moduleName,
          stackItem.msgid,
          stackItem.msg,
          stackItem.timeStamp
        );
        this.pushStack(pdu);
        if (doEvent) {
          if (beforeConditions) {
            beforeConditions.call(this, pdu, stackItem);
          }
          this.fire("onLog", pdu);
        }
      }
      return stack as Pdu[];
    }
    throw new Error("syslog loadStack : bad stack in arguments type");
  }

  filter(conditions: conditionsInterface, callback: CallbackFunction): void {
    if (!conditions) {
      throw new Error("filter conditions not found ");
    }
    conditions = extend(true, {}, conditions) as conditionsInterface;
    const wrapper = wrapperCondition.call(this, conditions, callback);
    if (wrapper) {
      super.on("onLog", wrapper as CallbackFunction);
    }
  }

  listenWithConditions(
    conditions: conditionsInterface,
    callback: CallbackFunction
  ): void {
    return this.filter(conditions, callback);
  }

  error(data: Pci): Pdu {
    return this.log(data, "ERROR");
  }

  warn(data: Pci): Pdu {
    return this.log(data, "WARNING");
  }

  warnning(data: Pci): Pdu {
    return this.log(data, "WARNING");
  }

  info(data: Pci): Pdu {
    return this.log(data, "INFO");
  }

  debug(data: Pci): Pdu {
    return this.log(data, "DEBUG");
  }

  trace(data: Pci, ...args: unknown[]): Pdu {
    return this.log(data, "NOTICE", ...(args as [ModuleName?, Message?]));
  }

  static wrapper(pdu: Pdu): WrapperResult {
    if (!pdu) {
      throw new Error("Syslog pdu not defined");
    }
    const date = new Date(pdu.timeStamp);
    const dateStr = `${date.toDateString()} ${date.toLocaleTimeString()}`;
    const msgid = green(pdu.msgid);

    switch (pdu.severity) {
      case 0:
      case 1:
      case 2:
      case 3:
        return {
          logger: console.error,
          text: `${dateStr} ${red(pdu.severityName)} ${msgid} : `,
        };
      case 4:
        return {
          logger: console.warn,
          text: `${dateStr} ${yellow(pdu.severityName)} ${msgid} : `,
        };
      case 5:
        return {
          logger: console.log,
          text: `${dateStr} ${red(pdu.severityName)} ${msgid} : `,
        };
      case 6:
        return {
          logger: console.info,
          text: `${dateStr} ${blue(pdu.severityName)} ${msgid} : `,
        };
      case 7:
        return {
          logger: console.debug,
          text: `${dateStr} ${cyan(pdu.severityName)} ${msgid} : `,
        };
      default:
        return {
          logger: console.log,
          text: `${dateStr} ${cyan(pdu.severityName)} ${msgid} : `,
        };
    }
  }

  static normalizeLog(pdu: Pdu, pid: string = ""): Pdu {
    if (pdu.payload === "" || pdu.payload === undefined) {
      console.warn(
        `${pdu.severityName} ${pdu.msgid} : logger message empty !!!!`
      );
      console.trace(pdu);
      return pdu;
    }
    const message = pdu.payload;
    if (pdu.severity === -1) {
      process.stdout.write("[0G");
      process.stdout.write(`${green(pdu.msgid)} : ${String(message)}`);
      process.stdout.write("[90m[0m");
      return pdu;
    }
    const wrap = Syslog.wrapper(pdu);
    wrap.logger(`${pid} ${wrap.text}`, message);
    return pdu;
  }
}

export default Syslog;
