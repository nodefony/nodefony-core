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

/** Sentinelle de rejet interne au timeout d'{@link Event.emitAsyncGuarded} (jamais exposée). */
const timeoutSentinel = Symbol("nodefony.emitAsyncGuarded.timeout");

/**
 * Information sur un listener pendant une émission gardée
 * ({@link Event.emitAsyncGuarded}).
 */
export interface IGuardedListenerInfo {
  /** Index du listener dans l'ordre d'enregistrement. */
  index: number;
  /** Référence du listener (pour lire d'éventuels tags posés par l'appelant). */
  listener: object;
  /** `true` si le listener a été interrompu par le timeout. */
  timedOut: boolean;
  /** Durée d'exécution mesurée (ms) — `0` si la mesure est off (`warnMs ≤ 0`). */
  durationMs: number;
}

/** Erreur collectée pour un listener pendant {@link Event.emitAsyncGuarded}. */
export interface IGuardedEmitError {
  /** Index du listener fautif. */
  index: number;
  /** Erreur levée par le listener (ou erreur de timeout). */
  error: unknown;
  /** `true` si l'échec est un dépassement de `timeoutMs`. */
  timedOut: boolean;
}

/**
 * Options de {@link Event.emitAsyncGuarded} — purement MÉCANIQUES : aucune notion
 * de module / criticité / log (ça, c'est la POLITIQUE, décidée par l'appelant via
 * les callbacks). Sépare le « comment on isole un listener » du « quoi faire d'un
 * échec ».
 */
export interface IGuardedEmitOptions {
  /** Timeout par listener (ms). `0` / absent = pas de timeout (0 timer alloué). */
  timeoutMs?: number;
  /** Seuil d'alerte de lenteur par listener (ms). `0` / absent = 0 mesure (0 `Date.now`). */
  warnMs?: number;
  /**
   * Appelé quand un listener rejette OU dépasse `timeoutMs`.
   *
   * @returns `true` pour **arrêter** la chaîne (les listeners suivants ne sont
   *   pas appelés) ; toute autre valeur = on continue (fail-soft).
   */
  onListenerError?: (
    error: unknown,
    info: IGuardedListenerInfo,
  ) => boolean | void;
  /** Appelé quand un listener réussit mais dépasse `warnMs` (observabilité). */
  onListenerSlow?: (info: IGuardedListenerInfo) => void;
}

/** Résultat de {@link Event.emitAsyncGuarded}. */
export interface IGuardedEmitResult {
  /** Valeurs résolues par les listeners ayant réussi (ordre d'exécution). */
  results: unknown[];
  /** Erreurs / timeouts collectés (vide si tout a réussi). */
  errors: IGuardedEmitError[];
  /** `true` si la chaîne a été arrêtée par `onListenerError`. */
  stopped: boolean;
}

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
    // `listenerCount` ne fait AUCUNE allocation, là où `rawListeners` COPIE le
    // tableau interne à chaque appel. Dans le hot path HTTP/WS, la plupart des
    // phases (`onCreateContext`, `beforeResolve`, `afterAuth`, `onFinish`…) n'ont
    // aucun listener → court-circuit 0-alloc / 0 microtask.
    if (this.listenerCount(eventName) === 0) {
      return false;
    }
    const handlers = this.rawListeners(eventName);
    const result: any[] = [];
    for (const handler of handlers) {
      // N'`await` que si le listener retourne réellement un thenable : un hook
      // SYNCHRONE (cas fréquent des contextes) ne paie alors aucune microtask.
      // Ordre séquentiel préservé (un thenable est attendu avant le suivant).
      // `typeof .then` inline — pas d'import (Event est isomorphe client/serveur).
      const r = Reflect.apply(handler as (...a: any[]) => any, this, args);
      result.push(
        r != null && typeof (r as { then?: unknown }).then === "function"
          ? await r
          : r,
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

  /**
   * Variante **gardée** de {@link emitAsync} : émet les listeners en SÉRIE (ordre
   * préservé) mais isole chacun par un `try/catch` + un `timeout` optionnel, et
   * COLLECTE les échecs au lieu de laisser le premier rejet faire sauter les
   * suivants (ou un listener figé geler tout le reste).
   *
   * Ne décide d'AUCUNE politique (log, criticité, propagation) : c'est l'appelant
   * qui tranche via `onListenerError` (continuer / arrêter) et `onListenerSlow`.
   * Cette séparation MÉCANIQUE / POLITIQUE permet de réutiliser la garde hors boot
   * en toute connaissance de cause.
   *
   * 🚨 **Coût** : quand `timeoutMs > 0`, 1 timer + 1 Promise de course PAR listener.
   * Réservé au **boot / lifecycle / jobs** (cf `Kernel.fireLifecycle`) — appelé
   * ≪ 1×/process. **JAMAIS dans le hot path HTTP/WS** : celui-ci garde `emitAsync`
   * nu (aucun timer, aucune alloc par requête).
   *
   * @param eventName - événement à émettre.
   * @param options - garde (timeout/seuil de lenteur) + callbacks de politique.
   * @param args - arguments passés à chaque listener.
   * @returns `{ results, errors, stopped }` (cf {@link IGuardedEmitResult}).
   */
  async emitAsyncGuarded(
    eventName: string | symbol,
    options: IGuardedEmitOptions = {},
    ...args: any[]
  ): Promise<IGuardedEmitResult> {
    const results: unknown[] = [];
    const errors: IGuardedEmitError[] = [];
    if (this.listenerCount(eventName) === 0) {
      return { results, errors, stopped: false };
    }
    const handlers = this.rawListeners(eventName);
    const timeoutMs = options.timeoutMs ?? 0;
    const warnMs = options.warnMs ?? 0;
    const measure = warnMs > 0;
    for (let index = 0; index < handlers.length; index += 1) {
      const handler = handlers[index] as (...a: any[]) => unknown;
      const startedAt = measure ? Date.now() : 0;
      let timedOut = false;
      try {
        const call = Promise.resolve(Reflect.apply(handler, this, args));
        let value: unknown;
        if (timeoutMs > 0) {
          // Un rejet APRÈS le timeout (course perdue) ne doit pas devenir unhandled.
          call.catch(() => {});
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            value = await Promise.race([
              call,
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  timedOut = true;
                  reject(timeoutSentinel);
                }, timeoutMs);
                timer.unref?.();
              }),
            ]);
          } finally {
            if (timer) {
              clearTimeout(timer);
            }
          }
        } else {
          value = await call;
        }
        results.push(value);
        if (measure && options.onListenerSlow) {
          const durationMs = Date.now() - startedAt;
          if (durationMs >= warnMs) {
            options.onListenerSlow({
              index,
              listener: handler,
              timedOut: false,
              durationMs,
            });
          }
        }
      } catch (caught) {
        const durationMs = measure ? Date.now() - startedAt : 0;
        // En cas de timeout, expose une Error explicite (jamais la sentinelle).
        const error = timedOut
          ? new Error(`listener timeout après ${timeoutMs}ms`)
          : caught;
        errors.push({ index, error, timedOut });
        const stop = options.onListenerError?.(error, {
          index,
          listener: handler,
          timedOut,
          durationMs,
        });
        if (stop === true) {
          return { results, errors, stopped: true };
        }
      }
    }
    return { results, errors, stopped: false };
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
