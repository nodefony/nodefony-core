import {EventEmitter} from "node:events";
import {isEmpty , get, isFunction} from 'lodash'

declare module 'events' {
  interface EventEmitter {
    _events: Record<string | symbol, any>;
    settingsToListen(localSettings: EventDefaultInterface, context: ContextType): void;
    listen(context: ContextType, eventName: string | symbol, callback: Function): Function;
    fire(eventName: string | symbol, ...args: any[]): boolean;
    emitAsync(type: string | symbol, ...args: any[]): Promise<false | any[]>;
    fireAsync(type: string | symbol, ...args: any[]): Promise<false | any[]>;
  }
}

interface EventDefaultInterface {
 [key: string]: any;
}

interface EventOptionInterface {
  nbListeners: number
}

type ContextType = any;

const regListenOn = /^on(.*)$/;
const defaultNbListeners = 20;

class Event extends EventEmitter {

  constructor (settings?: EventDefaultInterface, context? : ContextType, options?: EventOptionInterface ) {
    super();
    if (options && options.nbListeners) {
      this.setMaxListeners(options.nbListeners || defaultNbListeners);
    }
    if (settings) {
      this.settingsToListen(settings, context);
    }
  }

  settingsToListen (localSettings: EventDefaultInterface, context: ContextType ) {
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

  listen(context: ContextType, eventName: string | symbol, listener: (...args: any[]) => void): Function {
    const event = eventName;
    const contextClosure = this;
    if (typeof listener === 'function') {
      this.addListener(eventName, listener.bind(context));
    }
    return function (this: EventEmitter , ...args: any[]): boolean {
      args.unshift(event);
      return contextClosure.emit(eventName, ...args);
    };
  }

  fire(eventName: string | symbol, ...args: any[]): boolean {
    try {
      return super.emit(eventName, ...args);
    } catch (e) {
      throw e;
    }
  }

  async emitAsync (eventName: string | symbol, ...args: any[]): Promise<any> {
    const handler = get(this._events, eventName);
    if (isEmpty(handler) && !isFunction(handler)) {
      return false;
    }
    const tab = [];
    if (typeof handler === "function") {
      tab.push(await Reflect.apply(handler, this, args));
    } else {
      let size = handler.length;
      let i = 0;
      while (size !== i) {
        tab.push(await Reflect.apply(handler[i], this, args));
        if (handler.length === size) {
          i++;
        } else {
          size--;
        }
      }
      /* for await (const func of handler) {
        tab.push(await Reflect.apply(func, this, args));
      }*/
    }
    return tab;
  }

  async fireAsync (eventName: string | symbol, ...args: any[])  {
    return this.emitAsync(eventName, ...args);
  }
}

const create = (settings?: EventDefaultInterface, context? : ContextType, options?: EventOptionInterface) :Event =>{
   return new Event(settings, context, options);
}
const notification = Event

export default Event
export {
  notification,
  create,
  EventDefaultInterface
} 