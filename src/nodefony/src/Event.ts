/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from "events";
import isEmpty from "lodash-es/isEmpty";
import get from "lodash-es/get";
import isFunction from "lodash-es/isFunction";

declare module "events" {
  interface EventEmitter {
    _events: Record<string | symbol, any>;
    settingsToListen(
      localSettings: EventDefaultInterface,
      context: ContextType
    ): void;
    listen(
      context: ContextType,
      eventName: string | symbol,
      listener: (...args: any[]) => void
    ): (...args: any[]) => boolean;
    fire(eventName: string | symbol, ...args: any[]): boolean;
    emitAsync(type: string | symbol, ...args: any[]): Promise<false | any[]>;
    fireAsync(type: string | symbol, ...args: any[]): Promise<false | any[]>;
  }
}

interface EventDefaultInterface {
  [key: string]: any;
}

interface EventOptionInterface {
  nbListeners?: number;
  [key: string]: any;
}

type ContextType = any;

const regListenOn = /^on(.*)$/;
const defaultNbListeners = 20;

class Event extends EventEmitter {
  constructor(
    settings?: EventDefaultInterface,
    context?: ContextType,
    options?: EventOptionInterface
  ) {
    super();
    if (options && options.nbListeners) {
      this.setMaxListeners(options.nbListeners || defaultNbListeners);
    }
    if (settings) {
      this.settingsToListen(settings, context);
    }
  }

  override settingsToListen(
    localSettings: EventDefaultInterface,
    context?: ContextType
  ) {
    for (const i in localSettings) {
      const res = regListenOn.exec(i);
      if (!res) {
        continue;
      }
      if (context) {
        this.listen(context || this, res[0], localSettings[i]);
        continue;
      }
      this.on(res[0], localSettings[i]);
    }
  }

  override listen(
    context: ContextType,
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): (...args: any[]) => boolean {
    const event = eventName;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const contextClosure = this;
    if (typeof listener === "function") {
      this.addListener(eventName, listener.bind(context));
    }
    return function (this: EventEmitter, ...args: any[]): boolean {
      args.unshift(event);
      return contextClosure.emit(eventName, ...args);
    };
  }

  override fire(eventName: string | symbol, ...args: any[]): boolean {
    return super.emit(eventName, ...args);
  }

  override async emitAsync(
    eventName: string | symbol,
    ...args: any[]
  ): Promise<any> {
    const handler = get(this._events, eventName);
    if (!handler || (isEmpty(handler) && !isFunction(handler))) {
      return false;
    }
    const result = [];
    if (typeof handler === "function") {
      result.push(await Reflect.apply(handler, this, args));
    } else {
      const handlers = [...handler];
      for await (const handler of handlers) {
        result.push(await Reflect.apply(handler, this, args));
      }
    }
    return result;
  }

  override async fireAsync(eventName: string | symbol, ...args: any[]) {
    return this.emitAsync(eventName, ...args);
  }
}

const create = (
  settings?: EventDefaultInterface,
  context?: ContextType,
  options?: EventOptionInterface
): Event => {
  return new Event(settings, context, options);
};
const notification = Event;

export default Event;
export { notification, create, EventDefaultInterface };
