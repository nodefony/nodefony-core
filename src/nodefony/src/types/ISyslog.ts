import type Pdu from "../syslog/Pdu";
import type { Severity, Msgid, Message, Pci } from "../syslog/Pdu";
import type { DebugType, EnvironmentType } from "./globals";
import type { ITransport } from "./ITransport";
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
  /** Capacité MAX du ring buffer (plafond `maxStack`). */
  readonly bufferCapacity: number;
  /** `true` si les Pdu sont stockés dans le ring (relecture mémoire active). */
  readonly ringEnabled: boolean;
  /** Active/désactive le stockage mémoire (ring) à chaud — outil avancé. */
  setRingEnabled(enabled: boolean): boolean;
  /** `true` si la diffusion temps réel (`nodefony:syslog`) est active. */
  readonly streamEnabled: boolean;
  /** Active/désactive la diffusion temps réel à chaud (onglet Live). */
  setStreamEnabled(enabled: boolean): boolean;
  burstPrinted: number;
  missed: number;
  invalid: number;
  valid: number;
  /** Cumul monotone des logs de sévérité 0–3 (ERROR/CRITIC/ALERT/EMERGENCY). */
  errorTotal: number;
  /** Sous-ensemble CRITIQUE (sévérité 0–2 : CRITIC/ALERT/EMERGENCY). */
  criticTotal: number;
  start: number;
  async: boolean;

  // ─── Cycle de vie ──────────────────────────────────────────────────────────
  init(
    environment: EnvironmentType,
    debug?: DebugType,
    options?: conditionsInterface,
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
    condition?: conditionsInterface,
  ): Pdu[] | Pdu;
  getLogs(conditions: conditionsInterface, stack?: Pdu[] | null): Pdu[];
  logToJson(conditions: conditionsInterface, stack?: Pdu[] | null): string;
  loadStack(
    stack: Pdu[] | string,
    doEvent?: boolean,
    beforeConditions?: ((pdu: Pdu, stackItem: Pdu) => void) | null,
  ): Pdu[];

  // ─── Filtrage conditionnel ──────────────────────────────────────────────────
  filter(conditions: conditionsInterface, callback: CallbackFunction): void;
  listenWithConditions(
    conditions: conditionsInterface,
    callback: CallbackFunction,
  ): void;

  // ─── Transports ────────────────────────────────────────────────────────────
  addTransport(transport: ITransport): this;
  removeTransport(transport: ITransport): this;
  /** Liste polymorphe des transports d'écriture (axe WRITE) + état `enabled`. */
  listTransports(): { name: string; enabled: boolean }[];
  /** Active/désactive un transport d'écriture à chaud, par nom (dev/diagnostic). */
  setTransportEnabled(name: string, enabled: boolean): boolean;
}

export type { WrapperResult };
