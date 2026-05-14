import { DebugType, EnvironmentType } from "./types/globals";
import type {
  IService,
  DefaultOptionsService,
  EventListener,
} from "./types/IService";
import type { IKernel } from "./types/IKernel";
import Container, { DynamicParam } from "./Container";
import Event, { EventDefaultInterface } from "./Event";
import Pdu, { Severity, Msgid, Message, Pci } from "./syslog/Pdu";
import Syslog, {
  SyslogDefaultSettings,
  conditionsInterface,
} from "./syslog/Syslog";

const defaultOptions: DefaultOptionsService = {
  events: {
    nbListeners: 20,
  },
};

const defaultSyslogSettings: SyslogDefaultSettings = {
  moduleName: "SERVICE ",
  defaultSeverity: "INFO",
};

class Service implements IService {
  public name: string;
  public options: DefaultOptionsService;
  public container: Container | null;
  public kernel: IKernel | null;
  public syslog: Syslog | null;

  // Backing field privé — lecture externe via getter notificationsCenter.
  #nc: Event | undefined;
  // Listeners enregistrés via l'API de ce service — retirés de l'Event partagé à clean().
  #trackedListeners: Map<string | symbol, EventListener[]> = new Map();
  // true si #nc est un Event externe partagé (pas auto-créé).
  #sharedNc = false;

  get notificationsCenter(): Event | undefined {
    return this.#nc;
  }

  // Getter privé avec guard — élimine le if/throw dupliqué sur les 18 méthodes events.
  private get nc(): Event {
    if (!this.#nc) {
      throw new Error(`${this.name}: notificationsCenter not initialized`);
    }
    return this.#nc;
  }

  constructor(
    name: string,
    container?: Container,
    notificationsCenter?: Event | false | null,
    options: DefaultOptionsService = {},
  ) {
    this.name = name;
    this.container =
      container instanceof Container ? container : new Container();
    this.options =
      notificationsCenter === false
        ? { ...options }
        : { ...defaultOptions, ...options };
    this.kernel = this.container.get<IKernel>("kernel");
    this.syslog = this.container.get<Syslog>("syslog");

    if (!this.syslog) {
      // Variable locale — pas besoin d'un champ d'instance.
      const syslogSettings: SyslogDefaultSettings = {
        ...defaultSyslogSettings,
        moduleName: this.name,
        ...(this.options.syslog ?? {}),
      };
      this.syslog = new Syslog(syslogSettings);
      this.container.set("syslog", this.syslog);
    }

    if (notificationsCenter instanceof Event) {
      this.#sharedNc = true;
      this.#nc = notificationsCenter;
      this.#nc.settingsToListen(options, this);
      if (options.events?.nbListeners) {
        this.#nc.setMaxListeners(options.events.nbListeners);
      }
    } else if (notificationsCenter !== false) {
      this.#nc = new Event(this.options, this, this.options);
      if (options.events?.nbListeners) {
        this.#nc.setMaxListeners(options.events.nbListeners);
      }
      if (!this.kernel || this.kernel.container !== this.container) {
        this.container.set("notificationsCenter", this.#nc);
      }
    }

    delete this.options.events;
  }

  initSyslog(
    environment: EnvironmentType = "production",
    debug: DebugType = false,
    options?: conditionsInterface,
  ): ReturnType<Syslog["init"]> | null {
    return this.syslog ? this.syslog.init(environment, debug, options) : null;
  }

  getName(): string {
    return this.name;
  }

  clean(syslog = false): void {
    // Retire les listeners de l'Event partagé pour éviter les fuites mémoire.
    if (this.#nc && this.#sharedNc) {
      for (const [event, listeners] of this.#trackedListeners) {
        for (const listener of listeners) {
          this.#nc.removeListener(event, listener);
        }
      }
    }
    this.#trackedListeners.clear();
    this.#sharedNc = false;
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
      return new Pdu(pci, severity, this.name, msgid, msg);
    } catch (e) {
      console.log(severity, msgid, msg, " : ", pci);
      console.warn(e);
      return new Pdu(e, "ERROR", this.name, msgid, msg);
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

  // ─── Tracking interne des listeners ────────────────────────────────────────

  private trackListener(
    eventName: string | symbol,
    listener: EventListener,
  ): void {
    const list = this.#trackedListeners.get(eventName) ?? [];
    list.push(listener);
    this.#trackedListeners.set(eventName, list);
  }

  private untrackListener(
    eventName: string | symbol,
    listener: EventListener,
  ): void {
    const list = this.#trackedListeners.get(eventName);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this.#trackedListeners.delete(eventName);
  }

  // ─── Events — délégation vers #nc ──────────────────────────────────────────

  eventNames(): (string | symbol)[] {
    return this.nc.eventNames();
  }

  fire(eventName: string | symbol, ...args: unknown[]): boolean {
    return this.nc.emit(eventName, ...args);
  }

  fireAsync(eventName: string | symbol, ...args: unknown[]): Promise<unknown> {
    return this.nc.emitAsync(eventName, ...args);
  }

  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    return this.nc.emit(eventName, ...args);
  }

  emitAsync(eventName: string | symbol, ...args: unknown[]): Promise<unknown> {
    return this.nc.emitAsync(eventName, ...args);
  }

  addListener(eventName: string | symbol, listener: EventListener): this {
    this.nc.addListener(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  listen(
    eventName: string | symbol,
    listener: EventListener,
  ): (...args: unknown[]) => boolean {
    // listen() bind le listener avant de l'enregistrer — on ne peut pas tracker l'original.
    return this.nc.listen(this, eventName, listener) as (
      ...args: unknown[]
    ) => boolean;
  }

  on(eventName: string | symbol, listener: EventListener): this {
    this.nc.on(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  once(eventName: string | symbol, listener: EventListener): this {
    // Node.js stocke listener.listener = original → removeListener(original) fonctionne.
    this.nc.once(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  off(eventName: string | symbol, listener: EventListener): this {
    this.nc.off(eventName, listener);
    this.untrackListener(eventName, listener);
    return this;
  }

  settingsToListen(
    localSettings: EventDefaultInterface,
    context: object,
  ): void {
    this.nc.settingsToListen(localSettings, context);
  }

  setMaxListeners(n: number): this {
    this.nc.setMaxListeners(n);
    return this;
  }

  removeListener(eventName: string | symbol, listener: EventListener): this {
    this.nc.removeListener(eventName, listener);
    this.untrackListener(eventName, listener);
    return this;
  }

  removeAllListeners(eventName?: string | symbol): this {
    if (eventName !== undefined) {
      this.#trackedListeners.delete(eventName);
      this.nc.removeAllListeners(eventName);
    } else {
      this.#trackedListeners.clear();
      this.nc.removeAllListeners();
    }
    return this;
  }

  prependOnceListener(
    eventName: string | symbol,
    listener: EventListener,
  ): this {
    this.nc.prependOnceListener(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  prependListener(eventName: string | symbol, listener: EventListener): this {
    this.nc.prependListener(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  getMaxListeners(): number {
    return this.nc.getMaxListeners();
  }

  listenerCount(eventName: string | symbol, listener?: EventListener): number {
    return this.nc.listenerCount(eventName, listener);
  }

  listeners(eventName: string | symbol): EventListener[] {
    return this.nc.listeners(eventName) as EventListener[];
  }

  rawListeners(eventName: string | symbol): EventListener[] {
    return this.nc.rawListeners(eventName) as EventListener[];
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
        return this.container.remove(name);
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
