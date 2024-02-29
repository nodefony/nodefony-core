/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import clc from "cli-color";
import { typeOf, extend } from "../Tools";
import Pdu, { Severity, ModuleName, Msgid, Message } from "./Pdu";
import { DebugType, EnvironmentType } from "../types/globals";
import Event from "../Event";
//import NodefonyError from "../Error";
//import { kernel } from "../Nodefony";

const yellow = clc.yellow.bold;
const red = clc.red.bold;
const cyan = clc.cyan.bold;
const blue = clc.blueBright.bold;
const green = clc.green;

type Operator = "<" | ">" | "<=" | ">=" | "==" | "===" | "!=" | "RegExp";
type Condition = "&&" | "||";
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
interface ConditionSetting {
  operator?: Operator;
  data: Data;
  [key: string]: any;
}
interface conditionsInterface {
  severity?: ConditionSetting;
  msgid?: ConditionSetting;
  data?: Data;
  checkConditions?: Condition;
  [key: string]: any;
}
interface SyslogDefaultSettings {
  moduleName?: ModuleName;
  msgid?: Msgid;
  maxStack?: number;
  rateLimit?: boolean | number;
  burstLimit?: number;
  defaultSeverity?: Severity;
  checkConditions?: Condition;
  async?: boolean | undefined;
}
//type ComparisonOperatorNumber = (ele1: number , ele2: number ) => boolean;
type ComparisonOperator = (
  ele1: number | string,
  ele2: number | string | RegExp
) => boolean;
//type RegExpOperator = (ele1: string, ele2: RegExp) => boolean;
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

type CallbackFunction = (pdu: Pdu) => any;
type CallbackArray = Pdu[];
type Callback = CallbackFunction | CallbackArray | [] | null;

const formatDebug = function (debug: DebugType): DebugType {
  switch (typeOf(debug)) {
    case "boolean":
      return <boolean>debug;
    case "string": {
      if (["false", "undefined", "null"].includes(<string>debug)) {
        return false;
      }
      if (debug === "true" || debug === "*") {
        return true;
      }
      const mytab: string[] = (<string>debug).split(/,| /);
      if (mytab[0] === "*") {
        return true;
      }
      return mytab;
    }
    case "array":
      debug = <[]>debug;
      if (debug[0] === "*") {
        return true;
      }
      return debug;
    case "undefined":
    case "object":
    default:
      return false;
  }
};

const conditionOptions = function (
  environment: string,
  debug: DebugType = false
) {
  debug = formatDebug(debug);
  let obj: conditionsInterface | null = null;
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

/*
 * default settings
 * <pre>
 *   moduleName:      "nodefony"
 *   maxStack:        100
 *   rateLimit:       false
 *   burstLimit:      3
 *   defaultSeverity: "DEBUG"
 *   checkConditions: "&&"
 *   async:         false
 *
 * </pre>
 */
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
  RegExp: (ele1, ele2) => (<RegExp>ele2).test(<string>ele1),
};

const conditionsObj: Conditions = {
  severity: (pdu: Pdu, condition: ConditionSetting) => {
    for (const sev in condition.data) {
      // console.log(
      //   "Ope : ",
      //   condition.operator,
      //   " sev: ",
      //   pdu.severity,
      //   "contiton : ",
      //   condition.data[sev]
      // );
      if (
        condition.operator &&
        operators[condition.operator](pdu.severity, condition.data[sev])
      ) {
        // console.log(
        //   condition.operator,
        //   " sev: ",
        //   pdu.severity,
        //   "contiton : ",
        //   condition.data[sev]
        // );
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
    let res: boolean = false;
    for (const ele in myConditions) {
      res = conditionsObj[ele](pdu, myConditions[ele]);
      if (!res) {
        break;
      }
    }
    return res;
  },
  "||": (myConditions: ConditionSetting, pdu: Pdu): boolean => {
    let res: boolean = false;
    for (const ele in myConditions) {
      res = conditionsObj[ele](pdu, myConditions[ele]);
      if (res) {
        break;
      }
    }
    return res;
  },
};

const checkFormatSeverity = (ele: any): string | number[] => {
  let res: any[];
  switch (typeof ele) {
    case "object":
      if (Array.isArray(ele)) {
        res = ele;
      } else {
        throw new Error(`checkFormatSeverity bad format type: object`);
      }
      break;
    case "string":
      res = ele.split(/,| /);
      break;
    case "number":
      res = [ele];
      break;
    default: {
      console.trace(ele);
      const error = `checkFormatSeverity bad format type : ${typeof ele}`;
      throw new Error(error);
    }
  }
  return res;
};

const checkFormatDate = function (ele: Date | string): number {
  let res: number;
  switch (typeOf(ele)) {
    case "date":
      res = (ele as Date).getTime();
      break;
    case "string":
      res = new Date(ele).getTime();
      break;
    default:
      throw new Error(`checkFormatDate bad format ${typeOf(ele)} : ${ele}`);
  }
  return res;
};

const checkFormatMsgId = function (ele: any): RegExp | any[] {
  let res: any;
  switch (typeOf(ele)) {
    case "string":
      res = (ele as string).split(/,| /);
      break;
    case "number":
      res = [ele];
      break;
    case "RegExp":
      res = ele;
      break;
    case "array":
      res = ele;
      break;
    default:
      throw new Error(`checkFormatMsgId bad format ${typeOf(ele)} : ${ele}`);
  }
  return res;
};

const wrapperCondition = function (
  this: Syslog,
  conditions: conditionsInterface,
  callback: Callback | CallbackArray
): any {
  let myFuncCondition: Function = () => {};
  if (
    conditions.checkConditions &&
    conditions.checkConditions in logicCondition
  ) {
    myFuncCondition = logicCondition[conditions.checkConditions];
    delete conditions.checkConditions;
  } else {
    if (this.settings.checkConditions) {
      myFuncCondition = logicCondition[this.settings.checkConditions];
    }
  }
  const Conditions: ConditionSetting | boolean = sanitizeConditions(conditions);
  const tab: Function[] = [];
  switch (typeOf(callback)) {
    case "function":
      return (pdu: Pdu) => {
        const res = myFuncCondition(Conditions, pdu);
        if (res) {
          const result = (callback as CallbackFunction)(pdu);
          tab.push(result);
        }
      };
    case "array":
      for (let i = 0; i < (callback as CallbackArray).length; i++) {
        const res = myFuncCondition(Conditions, (callback as CallbackArray)[i]);
        if (res) {
          tab.push(res);
        }
      }
      return tab;
    default:
      throw new Error("Bad wrapper");
  }
};

const sanitizeConditions = function (
  settingsCondition: conditionsInterface
): boolean | ConditionSetting {
  let res: any = true;
  if (typeOf(settingsCondition) !== "object") {
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
        case "severity":
          if (!condi.operator) {
            condi.operator = "==";
          }
          res = checkFormatSeverity(condi.data);
          if (res !== false) {
            condi.data = {};
            for (let i = 0; i < res.length; i++) {
              const mySeverity: string | undefined = Pdu.severityToString(
                res[i]
              );
              if (mySeverity) {
                condi.data[mySeverity as Severity] =
                  sysLogSeverity[mySeverity as Severity];
              } else {
                return false;
              }
            }
          } else {
            return false;
          }
          break;
        case "msgid":
          if (!condi.operator) {
            condi.operator = "==";
          }
          res = checkFormatMsgId(condi.data);
          if (res !== false) {
            const format = typeOf(res);
            if (format === "array") {
              condi.data = {};
              for (let i = 0; i < res.length; i++) {
                condi.data[res[i]] = "||";
              }
            } else {
              condi.data = res;
            }
          } else {
            return false;
          }
          break;
        case "date":
          res = checkFormatDate(condi.data);
          if (res) {
            condi.data = res;
          } else {
            return false;
          }
          break;
        default:
          return false;
      }
    } else {
      return false;
    }
  }
  return <ConditionSetting>settingsCondition;
  // console.log(settingsCondition);
};

const createPDU = function (
  this: Syslog,
  payload: any,
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

/**
 * A class for product log in nodefony.
 *
 *    @class syslog
 *    @module library
 *    @constructor
 *    @param {Object} settings The settings to extend.
 *    @return syslog
 */
class Syslog extends Event {
  public settings: SyslogDefaultSettings;
  public ringStack: Pdu[];
  public burstPrinted: number;
  public missed: number;
  public invalid: number;
  public valid: number;
  public start: number;
  private _async: boolean = false;

  //fire(eventName: string | symbol, ...args: any[]): boolean;
  //fireAsync(eventName: string | symbol, ...args: any[]): Promise<any> ;

  constructor(settings?: SyslogDefaultSettings) {
    super(settings);
    /**
     * extended settings
     * @property settings
     * @type Object
     * @see defaultSettings
     */
    this.settings = extend({}, defaultSettings, settings || {});

    /**
     * ring buffer structure container instances of PDU
     * @property ringStack
     * @type Array
     */
    this.ringStack = [];

    /**
     * Ratelimit  Management log printed
     * @property burstPrinted
     * @type Number
     */
    this.burstPrinted = 0;

    /**
     * Ratelimit  Management log dropped
     * @property missed
     * @type Number
     */
    this.missed = 0;

    /**
     * Management log invalid
     * @property invalid
     * @type Number
     */
    this.invalid = 0;

    /**
     * Counter log valid
     * @property valid
     * @type Number
     */
    this.valid = 0;

    /**
     * Ratelimit  Management begin of burst
     * @property start
     * @private
     * @type Number
     */
    this.start = 0;

    this._async = <boolean>this.settings.async || false;
  }

  static formatDebug(debug: DebugType) {
    return formatDebug(debug);
  }

  init(
    environment: EnvironmentType,
    debug?: DebugType,
    options?: conditionsInterface
  ) {
    return this.listenWithConditions(
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

  // override fire(eventName: string | symbol, ...args: any[]): Promise<any>  | boolean{
  //   if (this.settings.async) {
  //     return super.fireAsync(eventName, ...args) as Promise<any>;
  //   } else {
  //     return super.fire(eventName, ...args) as boolean;
  //   }
  // }

  clean(): this {
    return this.reset();
  }

  reset(): this {
    this.ringStack.length = 0;
    this.removeAllListeners();
    return this;
  }

  /**
   * Clear stack of logs
   *
   * @method clearLogStack
   *
   */
  clearLogStack() {
    this.ringStack.length = 0;
  }

  pushStack(pdu: Pdu): number {
    if (this.ringStack.length === this.settings.maxStack) {
      this.ringStack.shift();
    }
    const index = this.ringStack.push(pdu);
    this.valid++;
    return index;
  }

  /**
   * logger message
   * @method log
   */
  log(
    payload: any,
    severity?: Severity,
    msgid?: ModuleName,
    msg?: Message
  ): Pdu {
    let pdu;
    if (this.settings.rateLimit !== false) {
      const rate: number = <number>this.settings.rateLimit;
      const now = new Date().getTime();
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
          if (payload instanceof Pdu) {
            pdu = payload;
          } else {
            pdu = createPDU.call(
              this,
              payload,
              severity,
              this.settings.moduleName,
              msgid || this.settings.msgid,
              msg
            );
          }
        } catch (e) {
          console.error(e);
          this.invalid++;
          if (!pdu) {
            pdu = createPDU.call(this, e, "ERROR");
          }
          pdu.status = "INVALID";
          return pdu;
        }
        this.pushStack(pdu);
        this.fire("onLog", pdu);
        this.burstPrinted++;
        pdu.status = "ACCEPTED";
        return pdu;
      }
      this.missed++;
      if (!pdu) {
        pdu = createPDU.call(this, "DROPPED", "WARNING");
      }
      pdu.status = "DROPPED";
      return pdu;
    }
    try {
      if (payload instanceof Pdu) {
        pdu = payload;
      } else {
        pdu = createPDU.call(
          this,
          payload,
          severity,
          this.settings.moduleName,
          msgid || this.settings.msgid,
          msg
        );
      }
    } catch (e) {
      console.error(e);
      this.invalid++;
      if (!pdu) {
        pdu = createPDU.call(this, e, "ERROR");
      }
      pdu.status = "INVALID";
      return pdu;
    }
    this.pushStack(pdu);
    pdu.status = "ACCEPTED";
    this.fire("onLog", pdu);
    return pdu;
  }

  /**
   * get hitory of stack
   * @method getLogStack
   * @param {number} start .
   * @param {number} end .
   * @return {array} new array between start end
   * @return {Pdu} pdu
   */
  getLogStack(
    start?: number,
    end?: number,
    contition?: conditionsInterface
  ): Pdu[] | Pdu {
    let stack: Pdu[] | null = null;
    if (contition) {
      stack = this.getLogs(contition);
    } else {
      stack = this.ringStack;
    }
    if (arguments.length === 0) {
      return stack[stack.length - 1];
    }
    if (!end) {
      return stack.slice(start);
    }
    if (start === end) {
      return stack[stack.length - start - 1];
    }
    return stack.slice(start, end);
  }

  /**
   * get logs with conditions
   * @method getLogs
   * @param {Object} conditions .
   * @return {array} new array with matches conditions
   */
  getLogs(conditions: conditionsInterface, stack: Pdu[] | null = null): Pdu[] {
    if (conditions) {
      return wrapperCondition.call(this, conditions, stack || this.ringStack);
    }
    return this.ringStack;
  }

  /**
   * take the stack and build a JSON string
   * @method logToJson
   * @return {String} string in JSON format
   */
  logToJson(conditions: conditionsInterface, stack = null): string {
    let res = null;
    if (conditions) {
      res = this.getLogs(conditions, stack);
    } else {
      res = this.ringStack;
    }
    return JSON.stringify(res);
  }

  /**
   * load the stack as JSON string
   * @method loadStack
   */
  loadStack(
    stack: Pdu[] | string,
    doEvent = false,
    beforeConditions: Function | null = null
  ): Pdu[] {
    if (!stack) {
      throw new Error("syslog loadStack : not stack in arguments ");
    }
    switch (typeOf(stack)) {
      case "string":
        return this.loadStack(
          JSON.parse(<string>stack),
          doEvent,
          beforeConditions
        );
      case "array":
      case "object":
        for (const stackItem of <Pdu[]>stack) {
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
            if (beforeConditions && typeof beforeConditions === "function") {
              beforeConditions.call(this, pdu, stackItem);
            }
            this.fire("onLog", pdu);
          }
        }
        break;
      default:
        throw new Error("syslog loadStack : bad stack in arguments type");
    }
    return <Pdu[]>stack;
  }

  /**
   *
   *    @method  filter
   *
   */
  filter(conditions: conditionsInterface, callback: Callback): void {
    if (!conditions) {
      throw new Error("filter conditions not found ");
    }
    conditions = extend(true, {}, conditions);
    const wrapper = wrapperCondition.call(this, conditions, callback);
    if (wrapper) {
      super.on("onLog", wrapper);
    }
  }

  /**
   *
   *    @method  listenWithConditions
   *
   */
  listenWithConditions(
    conditions: conditionsInterface,
    callback: CallbackFunction
  ): void {
    return this.filter(conditions, callback);
  }

  error(data: any): Pdu {
    return this.log(data, "ERROR");
  }

  warn(data: any): Pdu {
    return this.log(data, "WARNING");
  }

  warnning(data: any): Pdu {
    return this.log(data, "WARNING");
  }

  info(data: any): Pdu {
    return this.log(data, "INFO");
  }

  debug(data: any): Pdu {
    return this.log(data, "DEBUG");
  }

  trace(data: any, ...args: any[]): Pdu {
    return this.log(data, "NOTICE", ...args);
  }

  static wrapper(pdu: Pdu) {
    if (!pdu) {
      throw new Error("Syslog pdu not defined");
    }
    const date = new Date(pdu.timeStamp);
    switch (pdu.severity) {
      case 0:
      case 1:
      case 2:
      case 3:
        return {
          logger: console.error,
          text: `${date.toDateString()} ${date.toLocaleTimeString()} ${red(
            pdu.severityName
          )} ${green(pdu.msgid)} : `,
        };
      case 4:
        return {
          logger: console.warn,
          text: `${date.toDateString()} ${date.toLocaleTimeString()} ${yellow(
            pdu.severityName
          )} ${green(pdu.msgid)} : `,
        };
      case 5:
        return {
          logger: console.log,
          text: `${date.toDateString()} ${date.toLocaleTimeString()} ${red(
            pdu.severityName
          )} ${green(pdu.msgid)} : `,
        };
      case 6:
        return {
          logger: console.info,
          text: `${date.toDateString()} ${date.toLocaleTimeString()} ${blue(
            pdu.severityName
          )} ${green(pdu.msgid)} : `,
        };
      case 7:
        return {
          logger: console.debug,
          text: `${date.toDateString()} ${date.toLocaleTimeString()} ${cyan(
            pdu.severityName
          )} ${green(pdu.msgid)} : `,
        };
      default:
        return {
          logger: console.log,
          text: `${date.toDateString()} ${date.toLocaleTimeString()} ${cyan(
            pdu.severityName
          )} ${green(pdu.msgid)} : `,
        };
    }
  }

  static normalizeLog(pdu: Pdu, pid: string = "") {
    if (pdu.payload === "" || pdu.payload === undefined) {
      console.warn(
        `${pdu.severityName} ${pdu.msgid} : logger message empty !!!!`
      );
      console.trace(pdu);
      return pdu;
    }
    const message = pdu.payload;
    // switch (typeof message) {
    //   case "object":
    //     switch (true) {
    //       case message instanceof NodefonyError: {
    //         if (kernel && kernel.console) {
    //           message = message.message;
    //         }
    //         break;
    //       }
    //       case message instanceof Error:
    //         if (kernel && kernel.console) {
    //           message = message.message;
    //         } else {
    //           message = new NodefonyError(message);
    //         }
    //         break;
    //     }
    //     break;
    //   default:
    // }
    if (pdu.severity === -1) {
      process.stdout.write("\u001b[0G");
      process.stdout.write(`${green(pdu.msgid)} : ${message}`);
      process.stdout.write("\u001b[90m\u001b[0m");
      return pdu;
    }
    const wrap = Syslog.wrapper(pdu);
    wrap.logger(`${pid} ${wrap.text}`, message);
    return pdu;
  }
}

export default Syslog;
export { ConditionSetting, conditionsInterface, SyslogDefaultSettings };
