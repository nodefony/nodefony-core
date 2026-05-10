import type Container from "../Container";
import type { DynamicParam } from "../Container";
import type Event from "../Event";
import type { EventDefaultInterface } from "../Event";
import type Pdu from "../syslog/Pdu";
import type { Severity, Msgid, Message, Pci } from "../syslog/Pdu";
import type Syslog from "../syslog/Syslog";
import type { SyslogDefaultSettings, conditionsInterface } from "../syslog/Syslog";
import type { DebugType, EnvironmentType } from "./globals";
import type { IKernel } from "./IKernel";

// any[] est intentionnel : les event systems acceptent des callbacks de n'importe quel type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventListener = (...args: any[]) => void;

export interface DefaultOptionsService extends EventDefaultInterface {
  events?: {
    nbListeners: number;
  };
  syslog?: SyslogDefaultSettings;
}

/**
 * Contrat public de tout service nodefony.
 * Kernel, Module, Controller, adapters ORM — tous implémentent IService.
 */
export interface IService {
  // ─── Identité ──────────────────────────────────────────────────────────────
  readonly name: string;
  readonly options: DefaultOptionsService;

  // ─── Infrastructure ────────────────────────────────────────────────────────
  readonly container: Container | null;
  /** null avant l'enregistrement dans un Kernel, ou après clean() */
  readonly kernel: IKernel | null;
  readonly syslog: Syslog | null;
  /** undefined si notificationsCenter=false passé au constructeur, ou après clean() */
  readonly notificationsCenter: Event | undefined;

  // ─── Cycle de vie ──────────────────────────────────────────────────────────
  getName(): string;
  initSyslog(
    environment?: EnvironmentType,
    debug?: DebugType,
    options?: conditionsInterface
  ): ReturnType<Syslog["init"]> | null;
  clean(syslog?: boolean): void;

  // ─── Logging ───────────────────────────────────────────────────────────────
  log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu;
  logger(pci: Pci, ...args: unknown[]): void;
  trace(pci: Pci, ...args: unknown[]): void;
  spinlog(message: string): Pdu;

  // ─── Container delegation ──────────────────────────────────────────────────
  get<T>(name: string): T | null;
  set<T>(name: string, obj: T): void;
  remove(name: string): boolean;
  has(name: string): boolean;
  getParameters(name: string): DynamicParam | null;
  setParameters<T>(name: string, ele: T): DynamicParam | null;

  // ─── Events delegation ─────────────────────────────────────────────────────
  on(eventName: string | symbol, listener: EventListener): this;
  once(eventName: string | symbol, listener: EventListener): this;
  off(eventName: string | symbol, listener: EventListener): this;
  emit(eventName: string | symbol, ...args: unknown[]): boolean;
  fire(eventName: string | symbol, ...args: unknown[]): boolean;
  emitAsync(eventName: string | symbol, ...args: unknown[]): Promise<unknown>;
  fireAsync(eventName: string | symbol, ...args: unknown[]): Promise<unknown>;
  addListener(eventName: string | symbol, listener: EventListener): this;
  removeListener(eventName: string | symbol, listener: EventListener): this;
  removeAllListeners(eventName?: string | symbol): this;
  prependListener(eventName: string | symbol, listener: EventListener): this;
  prependOnceListener(eventName: string | symbol, listener: EventListener): this;
  listen(
    eventName: string | symbol,
    listener: EventListener
  ): (...args: unknown[]) => boolean;
  settingsToListen(localSettings: EventDefaultInterface, context: object): void;
  eventNames(): (string | symbol)[];
  listenerCount(eventName: string | symbol, listener?: EventListener): number;
  listeners(eventName: string | symbol): EventListener[];
  rawListeners(eventName: string | symbol): EventListener[];
  getMaxListeners(): number;
  setMaxListeners(n: number): this;
}
