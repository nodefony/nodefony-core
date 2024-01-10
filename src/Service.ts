/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import Container, { DynamicParam } from "./Container";
import Event, { EventDefaultInterface } from "./Event";
import Pdu, { Severity, Msgid, Message } from "./syslog/Pdu";
import Syslog, {
  SyslogDefaultSettings,
  conditionsInterface,
} from "./syslog/Syslog";
import { EnvironmentType, DebugType } from "./Nodefony";

interface DefaultOptionsService extends EventDefaultInterface {
  events?: {
    nbListeners: number;
  };
  syslog?: SyslogDefaultSettings;
}

const defaultOptions = {
  events: {
    nbListeners: 20,
  },
};

const settingsSyslog: SyslogDefaultSettings = {
  moduleName: "SERVICE ",
  defaultSeverity: "INFO",
};

class Service {
  public name: string;
  public options: DefaultOptionsService;
  public container: Container | null | undefined;
  private kernel: any; // Remplacez ce type par le type réel de kernel si possible
  private syslog: Syslog | null;
  private settingsSyslog: SyslogDefaultSettings | null;
  public notificationsCenter: Event | undefined | boolean;

  constructor(
    name: string,
    container?: Container,
    notificationsCenter?: Event | false,
    options: DefaultOptionsService = {}
  ) {
    this.name = name;
    this.container =
      container instanceof Container ? container : new Container();
    this.options =
      notificationsCenter === false
        ? { ...options }
        : { ...defaultOptions, ...options };
    this.kernel = this.container.get("kernel");
    this.syslog = this.container.get("syslog") || null;

    if (!this.syslog) {
      this.settingsSyslog = {
        ...settingsSyslog,
        moduleName: this.name,
        ...(this.options.syslog || {}),
      };
      this.syslog = new Syslog(this.settingsSyslog);
      this.container.set("syslog", this.syslog);
    } else {
      this.settingsSyslog = this.syslog.settings;
    }

    if (notificationsCenter instanceof Event) {
      this.notificationsCenter = notificationsCenter;
      if (options) {
        this.notificationsCenter.settingsToListen(options, this);
        if (options.events && options.events.nbListeners) {
          this.notificationsCenter.setMaxListeners(options.events.nbListeners);
        }
      }
    } else {
      if (notificationsCenter) {
        throw new Error(
          "Service nodefony notificationsCenter not valid, must be an instance of nodefony.Events"
        );
      }
      if (notificationsCenter !== false) {
        this.notificationsCenter = new Event(this.options, this, this.options);
        this.notificationsCenter.on("error", (err: any) => {
          this.log(err, "ERROR", "Error events");
        });
        if (!this.kernel) {
          this.container.set("notificationsCenter", this.notificationsCenter);
        } else if (this.kernel.container !== this.container) {
          this.container.set("notificationsCenter", this.notificationsCenter);
        }
      }
    }
    delete this.options.events;
  }

  initSyslog(
    environment: EnvironmentType = "production",
    debug: DebugType = false,
    options?: conditionsInterface
  ) {
    return this.syslog ? this.syslog.init(environment, debug, options) : null;
  }

  getName() {
    return this.name;
  }

  clean(syslog = false) {
    this.settingsSyslog = null;
    this.syslog && syslog && this.syslog.reset();
    this.syslog = null;
    this.notificationsCenter = undefined;
    this.container = null;
    this.kernel = null;
  }

  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu {
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

  logger(pci: any, ...args: any[]) {
    return console.debug(
      Syslog.wrapper(this.log(pci, "DEBUG")).text,
      pci,
      ...args
    );
  }

  trace(pci: any, ...args: any[]) {
    return console.trace(
      Syslog.wrapper(this.log(pci, "DEBUG")).text,
      pci,
      ...args
    );
  }

  spinlog(message: string) {
    return this.log(message, "SPINNER");
  }

  eventNames(): (string | symbol)[] {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).eventNames();
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  fire(eventName: string | symbol, ...args: any[]): boolean {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).emit(eventName, ...args);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  fireAsync(eventName: string | symbol, ...args: any[]): Promise<any> {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).emitAsync(eventName, ...args);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  emit(eventName: string | symbol, ...args: any[]): boolean {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).emit(eventName, ...args);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  emitAsync(eventName: string | symbol, ...args: any[]): Promise<any> {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).emitAsync(eventName, ...args);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  addListener(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): NodeJS.EventEmitter {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).addListener(eventName, listener);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  listen(eventName: string | symbol, listener: (...args: any[]) => void) {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).listen(
        this,
        eventName,
        listener
      );
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  on(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): NodeJS.EventEmitter {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).on(eventName, listener);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  once(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): NodeJS.EventEmitter {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).once(eventName, listener);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  off(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): NodeJS.EventEmitter {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).off(eventName, listener);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  settingsToListen(localSettings: EventDefaultInterface, context: any) {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).settingsToListen(
        localSettings,
        context
      );
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  setMaxListeners(n: number) {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).setMaxListeners(n);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  removeListener(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): NodeJS.EventEmitter {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).removeListener(
        eventName,
        listener
      );
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  removeAllListeners(eventName?: string | symbol) {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).removeAllListeners(eventName);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  prependOnceListener(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): NodeJS.EventEmitter {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).prependOnceListener(
        eventName,
        listener
      );
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  prependListener(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): NodeJS.EventEmitter {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).prependListener(
        eventName,
        listener
      );
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  getMaxListeners(): number {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).getMaxListeners();
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  listenerCount(
    eventName: string | symbol,
    listener?: Function | undefined
  ): number {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).listenerCount(
        eventName,
        listener
      );
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  listeners(eventName: string | symbol): Function[] {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).listeners(eventName);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  rawListeners(eventName: string | symbol): Function[] {
    if (this.notificationsCenter) {
      return (<Event>this.notificationsCenter).rawListeners(eventName);
    }
    throw new Error(`notificationsCenter not initialized`);
  }

  get(name: string) {
    return this.container?.get(name);
  }

  set(name: string, obj: any) {
    return this.container?.set(name, obj);
  }

  remove(name: string) {
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
    return (<Container>this.container).getParameters(name);
  }

  setParameters<T>(name: string, ele: T): DynamicParam | null {
    if (this.container) {
      return (<Container>this.container).setParameters(name, ele);
    }
    throw new Error(`container not initialized`);
  }

  has(name: string): boolean {
    if (this.container) {
      return this.container.has(name);
    }
    return false;
  }
}

export default Service;
export { DefaultOptionsService };
