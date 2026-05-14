/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from "node:events";

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

  settingsToListen(
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

  listen(
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

  fire(eventName: string | symbol, ...args: any[]): boolean {
    return super.emit(eventName, ...args);
  }

  async emitAsync(
    eventName: string | symbol,
    ...args: any[]
  ): Promise<false | any[]> {
    const handlers = this.rawListeners(eventName);
    if (!handlers.length) {
      return false;
    }
    const result: any[] = [];
    for (const handler of handlers) {
      result.push(await Reflect.apply(handler as (...a: any[]) => any, this, args));
    }
    return result;
  }

  async fireAsync(eventName: string | symbol, ...args: any[]): Promise<false | any[]> {
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
