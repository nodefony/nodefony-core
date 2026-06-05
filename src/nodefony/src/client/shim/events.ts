/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shim browser de `node:events` — EventEmitter minimal mais complet pour
 * Event.ts (on/once/off/emit/setMaxListeners + raw/prepend). Aucune dépendance npm.
 *
 * Couvre l'API EventEmitter réellement appelée par le core isomorphe (Service /
 * Event / Syslog) : `rawListeners` (utilisé par `Event.emitAsync`/`emitAsyncGuarded`,
 * le bus async `fireAsync`) et `prependListener`/`prependOnceListener` (Service.nc).
 * Ce shim ne distingue PAS les wrappers `once` des listeners bruts (`rawListeners`
 * ≡ `listeners`) — suffisant pour l'itération de `emitAsync`. Pas d'event `error`
 * spécial ni `Symbol.for("nodejs.rejection")`.
 */
type Listener = (...args: any[]) => void;

export class EventEmitter {
  private _listeners: Map<string | symbol, Listener[]> = new Map();
  private _maxListeners: number = 10;

  on(event: string | symbol, fn: Listener): this {
    const arr = this._listeners.get(event) ?? [];
    arr.push(fn);
    this._listeners.set(event, arr);
    return this;
  }

  addListener(event: string | symbol, fn: Listener): this {
    return this.on(event, fn);
  }

  once(event: string | symbol, fn: Listener): this {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper);
      fn(...args);
    };
    return this.on(event, wrapper);
  }

  off(event: string | symbol, fn: Listener): this {
    const arr = this._listeners.get(event);
    if (!arr) return this;
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) this._listeners.delete(event);
    return this;
  }

  removeListener(event: string | symbol, fn: Listener): this {
    return this.off(event, fn);
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this._listeners.clear();
    else this._listeners.delete(event);
    return this;
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    const arr = this._listeners.get(event);
    if (!arr || arr.length === 0) return false;
    for (const fn of arr.slice()) {
      try {
        fn(...args);
      } catch (e) {
        // browser : log mais ne crash pas
        // eslint-disable-next-line no-console
        console.error("[EventEmitter] listener threw:", e);
      }
    }
    return true;
  }

  listenerCount(event: string | symbol): number {
    return this._listeners.get(event)?.length ?? 0;
  }

  listeners(event: string | symbol): Listener[] {
    return (this._listeners.get(event) ?? []).slice();
  }

  eventNames(): (string | symbol)[] {
    return Array.from(this._listeners.keys());
  }

  setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this._maxListeners;
  }

  /**
   * Copie des listeners — ce shim ne wrappe pas distinctement les `once`, donc
   * `rawListeners` ≡ {@link listeners}. Appelé par `Event.emitAsync` (hot path
   * du bus async `fireAsync`) pour itérer les handlers sans muter la liste.
   */
  rawListeners(event: string | symbol): Listener[] {
    return (this._listeners.get(event) ?? []).slice();
  }

  /** Comme {@link on} mais inséré en TÊTE de la liste des listeners. */
  prependListener(event: string | symbol, fn: Listener): this {
    const arr = this._listeners.get(event) ?? [];
    arr.unshift(fn);
    this._listeners.set(event, arr);
    return this;
  }

  /** Comme {@link once} mais inséré en TÊTE de la liste des listeners. */
  prependOnceListener(event: string | symbol, fn: Listener): this {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper);
      fn(...args);
    };
    return this.prependListener(event, wrapper);
  }
}

export default EventEmitter;
