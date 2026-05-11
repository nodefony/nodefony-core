import { DebugType, EnvironmentType } from "./types/globals";
import type { IService, DefaultOptionsService, EventListener } from "./types/IService";
import type { IKernel } from "./types/IKernel";
import Container, { DynamicParam } from "./Container";
import Event, { EventDefaultInterface } from "./Event";
import Pdu, { Severity, Msgid, Message, Pci } from "./syslog/Pdu";
import Syslog, { SyslogDefaultSettings, conditionsInterface } from "./syslog/Syslog";

const defaultOptions: DefaultOptionsService = {
  events: {
    nbListeners: 20,
  },
};

const settingsSyslog: SyslogDefaultSettings = {
  moduleName: "SERVICE ",
  defaultSeverity: "INFO",
};

class Service implements IService {
  public name: string;
  public options: DefaultOptionsService;
  public container: Container | null;
  public kernel: IKernel | null;
  public syslog: Syslog | null;
  private settingsSyslog: SyslogDefaultSettings | null;

  // Backing field privé — seules les méthodes de Service peuvent l'écrire.
  // La lecture externe passe par le getter (readonly pour les consommateurs IService).
  #nc: Event | undefined;

  get notificationsCenter(): Event | undefined {
    return this.#nc;
  }

  constructor(
    name: string,
    container?: Container,
    notificationsCenter?: Event | false | null,
    options: DefaultOptionsService = {}
  ) {
    this.name = name;
    this.container = container instanceof Container ? container : new Container();
    this.options =
      notificationsCenter === false
        ? { ...options }
        : { ...defaultOptions, ...options };
    this.kernel = this.container.get<IKernel>("kernel");
    this.syslog = this.container.get<Syslog>("syslog");

    if (!this.syslog) {
      this.settingsSyslog = {
        ...settingsSyslog,
        moduleName: this.name,
        ...(this.options.syslog ?? {}),
      };
      this.syslog = new Syslog(this.settingsSyslog);
      this.container.set("syslog", this.syslog);
    } else {
      this.settingsSyslog = this.syslog.settings;
    }

    if (notificationsCenter instanceof Event) {
      this.#nc = notificationsCenter;
      this.#nc.settingsToListen(options, this);
      if (options.events?.nbListeners) {
        this.#nc.setMaxListeners(options.events.nbListeners);
      }
    } else if (notificationsCenter !== false) {
      this.#nc = new Event(this.options, this, this.options);
      if (!this.kernel || this.kernel.container !== this.container) {
        this.container.set("notificationsCenter", this.#nc);
      }
    }

    delete this.options.events;
  }

  initSyslog(
    environment: EnvironmentType = "production",
    debug: DebugType = false,
    options?: conditionsInterface
  ): ReturnType<Syslog["init"]> | null {
    return this.syslog ? this.syslog.init(environment, debug, options) : null;
  }

  getName(): string {
    return this.name;
  }

  clean(syslog = false): void {
    this.settingsSyslog = null;
    if (this.syslog && syslog) {
      this.syslog.reset();
    }
    this.syslog = null;
    this.#nc = undefined;
    this.container = null;
    this.kernel = null;
  }

  log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu {
    try {
      if (!msgid) {
        msgid = this.name;
      }
      if (this.syslog) {
        return this.syslog.log(pci, severity, msgid, msg);
      }
      return new Pdu(pci, severity, msg);
    } catch (e) {
      console.log(severity, msgid, msg, " : ", pci);
      console.warn(e);
      return new Pdu(e, "ERROR", msgid, msg);
    }
  }

  logger(pci: Pci, ...args: unknown[]): void {
    console.debug(Syslog.wrapper(this.log(pci, "DEBUG")).text, pci, ...args);
  }

  trace(pci: Pci, ...args: unknown[]): void {
    console.trace(Syslog.wrapper(this.log(pci, "DEBUG")).text, pci, ...args);
  }

  spinlog(message: string): Pdu {
    return this.log(message, "SPINNER");
  }

  // ─── Events — délégation vers #nc ──────────────────────────────────────────

  eventNames(): (string | symbol)[] {
    if (this.#nc) {
      return this.#nc.eventNames();
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  fire(eventName: string | symbol, ...args: unknown[]): boolean {
    if (this.#nc) {
      return this.#nc.emit(eventName, ...args);
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  fireAsync(eventName: string | symbol, ...args: unknown[]): Promise<unknown> {
    if (this.#nc) {
      return this.#nc.emitAsync(eventName, ...args);
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (this.#nc) {
      return this.#nc.emit(eventName, ...args);
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  emitAsync(eventName: string | symbol, ...args: unknown[]): Promise<unknown> {
    if (this.#nc) {
      return this.#nc.emitAsync(eventName, ...args);
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  addListener(eventName: string | symbol, listener: EventListener): this {
    if (this.#nc) {
      this.#nc.addListener(eventName, listener);
      return this;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  listen(
    eventName: string | symbol,
    listener: EventListener
  ): (...args: unknown[]) => boolean {
    if (this.#nc) {
      return this.#nc.listen(
        this,
        eventName,
        listener
      ) as (...args: unknown[]) => boolean;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  on(eventName: string | symbol, listener: EventListener): this {
    if (this.#nc) {
      this.#nc.on(eventName, listener);
      return this;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  once(eventName: string | symbol, listener: EventListener): this {
    if (this.#nc) {
      this.#nc.once(eventName, listener);
      return this;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  off(eventName: string | symbol, listener: EventListener): this {
    if (this.#nc) {
      this.#nc.off(eventName, listener);
      return this;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  settingsToListen(localSettings: EventDefaultInterface, context: object): void {
    if (this.#nc) {
      this.#nc.settingsToListen(localSettings, context);
      return;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  setMaxListeners(n: number): this {
    if (this.#nc) {
      this.#nc.setMaxListeners(n);
      return this;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  removeListener(eventName: string | symbol, listener: EventListener): this {
    if (this.#nc) {
      this.#nc.removeListener(eventName, listener);
      return this;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  removeAllListeners(eventName?: string | symbol): this {
    if (this.#nc) {
      this.#nc.removeAllListeners(eventName);
      return this;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  prependOnceListener(eventName: string | symbol, listener: EventListener): this {
    if (this.#nc) {
      this.#nc.prependOnceListener(eventName, listener);
      return this;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  prependListener(eventName: string | symbol, listener: EventListener): this {
    if (this.#nc) {
      this.#nc.prependListener(eventName, listener);
      return this;
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  getMaxListeners(): number {
    if (this.#nc) {
      return this.#nc.getMaxListeners();
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  listenerCount(eventName: string | symbol, listener?: EventListener): number {
    if (this.#nc) {
      return this.#nc.listenerCount(eventName, listener);
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  listeners(eventName: string | symbol): EventListener[] {
    if (this.#nc) {
      return this.#nc.listeners(eventName) as EventListener[];
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  rawListeners(eventName: string | symbol): EventListener[] {
    if (this.#nc) {
      return this.#nc.rawListeners(eventName) as EventListener[];
    }
    throw new Error(`${this.name}: notificationsCenter not initialized`);
  }

  // ─── Container — délégation ─────────────────────────────────────────────────

  get<T>(name: string): T | null {
    return this.container?.get<T>(name) ?? null;
  }

  set<T>(name: string, obj: T): void {
    if (!this.container) {
      throw new Error(`${this.name}: container not initialized`);
    }
    this.container.set(name, obj);
  }

  remove(name: string): boolean {
    if (this.container) {
      const ele = this.get(name);
      if (ele) {
        if (ele instanceof Service) {
          ele.clean();
        }
        this.container.remove(name);
      }
    }
    return false;
  }

  getParameters(name: string): DynamicParam | null {
    return this.container?.getParameters(name) ?? null;
  }

  setParameters<T>(name: string, ele: T): DynamicParam | null {
    if (!this.container) {
      throw new Error(`${this.name}: container not initialized`);
    }
    return this.container.setParameters(name, ele);
  }

  has(name: string): boolean {
    return this.container?.has(name) ?? false;
  }
}

export default Service;
// Ré-exports pour compatibilité avec les imports existants (Kernel, Module, Cli, etc.)
export type { IService, IKernel, DefaultOptionsService, EventListener };
