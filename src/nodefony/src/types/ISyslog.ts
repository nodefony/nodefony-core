import type Pdu from "../syslog/Pdu";
import type { Severity, Msgid, Message, Pci } from "../syslog/Pdu";
import type { DebugType, EnvironmentType } from "./globals";
import type {
  SyslogDefaultSettings,
  conditionsInterface,
  CallbackFunction,
  WrapperResult,
} from "../syslog/Syslog";

export interface ISyslog {
  // ─── État ──────────────────────────────────────────────────────────────────
  settings: SyslogDefaultSettings;
  readonly ringStack: Pdu[];
  burstPrinted: number;
  missed: number;
  invalid: number;
  valid: number;
  start: number;
  async: boolean;

  // ─── Cycle de vie ──────────────────────────────────────────────────────────
  init(
    environment: EnvironmentType,
    debug?: DebugType,
    options?: conditionsInterface
  ): void;
  clean(): this;
  reset(): this;
  clearLogStack(): void;

  // ─── Logging ───────────────────────────────────────────────────────────────
  log(payload: Pci, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu;
  error(data: Pci): Pdu;
  warn(data: Pci): Pdu;
  info(data: Pci): Pdu;
  debug(data: Pci): Pdu;
  trace(data: Pci, ...args: unknown[]): Pdu;
  print(...args: Pci[]): Pdu;
  logMultiple(severity: Severity, ...args: Pci[]): Pdu;

  // ─── Stack ─────────────────────────────────────────────────────────────────
  pushStack(pdu: Pdu): number;
  getLogStack(
    start?: number,
    end?: number,
    condition?: conditionsInterface
  ): Pdu[] | Pdu;
  getLogs(conditions: conditionsInterface, stack?: Pdu[] | null): Pdu[];
  logToJson(conditions: conditionsInterface, stack?: Pdu[] | null): string;
  loadStack(
    stack: Pdu[] | string,
    doEvent?: boolean,
    beforeConditions?: ((pdu: Pdu, stackItem: Pdu) => void) | null
  ): Pdu[];

  // ─── Filtrage conditionnel ──────────────────────────────────────────────────
  filter(conditions: conditionsInterface, callback: CallbackFunction): void;
  listenWithConditions(
    conditions: conditionsInterface,
    callback: CallbackFunction
  ): void;
}

export type { WrapperResult };
