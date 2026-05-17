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

/**
 * Bus d'événements Nodefony — extension de Node.js {@link EventEmitter} avec
 * deux ajouts maison : `emitAsync` (await tous les listeners en séquence) et
 * `settingsToListen` (mapping config → listeners via convention `onXxx`).
 *
 * Utilisé par {@link Service} comme `notificationsCenter`. Une seule instance
 * peut être partagée entre plusieurs services — chaque service track ses
 * propres listeners pour les retirer proprement à `clean()`.
 *
 * @example Bus dédié
 * ```ts
 * const bus = new Event({ onReady: () => console.log("ready!") }, this);
 * bus.fire("onReady");
 * ```
 *
 * @example Bus partagé entre services
 * ```ts
 * const sharedBus = new Event();
 * new ServiceA(name, container, sharedBus);
 * new ServiceB(name, container, sharedBus);
 * ```
 */
class Event extends EventEmitter {
  /**
   * @param settings - objet de config dont les clés `onXxx` sont auto-bindées
   *   comme listeners (via {@link settingsToListen}).
   * @param context - `this` à bind sur les listeners auto-enregistrés.
   * @param options - `nbListeners` surcharge la limite Node.js (défaut 20).
   */
  constructor(
    settings?: EventDefaultInterface,
    context?: ContextType,
    options?: EventOptionInterface,
  ) {
    super();
    if (options && options.nbListeners) {
      this.setMaxListeners(options.nbListeners || defaultNbListeners);
    }
    if (settings) {
      this.settingsToListen(settings, context);
    }
  }

  /**
   * Parcourt `localSettings` et enregistre chaque clé matchant `/^on(.*)$/`
   * comme listener — convention héritée des composants WebComponent / config
   * Nodefony historique. Utile pour wirer des hooks via config plate.
   *
   * @param localSettings - objet plat ; les clés `onReady`, `onClose`, etc.
   *   sont prises comme noms d'événements ET comme listeners.
   * @param context - si fourni, le listener est bindé sur ce contexte.
   */
  settingsToListen(
    localSettings: EventDefaultInterface,
    context?: ContextType,
  ) {
    for (const i of Object.keys(localSettings)) {
      const res = regListenOn.exec(i);
      if (!res) {
        continue;
      }
      if (context) {
        this.listen(context, res[0], localSettings[i]);
        continue;
      }
      this.on(res[0], localSettings[i]);
    }
  }

  /**
   * Bind `listener` sur `context` puis l'enregistre. Renvoie une fonction
   * dispatcher qui ré-émet l'événement avec ses propres args (façon trigger).
   *
   * @returns dispatcher `(...args) => this.emit(eventName, ...args)` — pratique
   *   pour exposer un trigger sans donner accès au bus complet.
   */
  listen(
    context: ContextType,
    eventName: string | symbol,
    listener: (...args: any[]) => void,
  ): (...args: any[]) => boolean {
    if (typeof listener === "function") {
      this.addListener(eventName, listener.bind(context));
    }
    return (...args: any[]): boolean => {
      args.unshift(eventName);
      return this.emit(eventName, ...args);
    };
  }

  /** Alias `emit` — émission synchrone (API EventEmitter standard). */
  fire(eventName: string | symbol, ...args: any[]): boolean {
    return super.emit(eventName, ...args);
  }

  /**
   * Émet et attend chaque listener en séquence (`await Reflect.apply` un par
   * un). Différent de `emit` qui appelle synchroniquement sans attendre les
   * Promises retournées.
   *
   * @returns tableau des valeurs résolues par chaque listener (ordre d'append),
   *   ou `false` si aucun listener n'est attaché.
   * @remarks Séquentiel par design — si tu veux Promise.all, fais un wrapper
   *   au-dessus. La séquence garantit l'ordre prévisible des side-effects.
   */
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
      result.push(
        await Reflect.apply(handler as (...a: any[]) => any, this, args),
      );
    }
    return result;
  }

  /** Alias `emitAsync`. */
  async fireAsync(
    eventName: string | symbol,
    ...args: any[]
  ): Promise<false | any[]> {
    return this.emitAsync(eventName, ...args);
  }
}

const create = (
  settings?: EventDefaultInterface,
  context?: ContextType,
  options?: EventOptionInterface,
): Event => {
  return new Event(settings, context, options);
};
const notification = Event;

export default Event;
export { notification, create, EventDefaultInterface };
