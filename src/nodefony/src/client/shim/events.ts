/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shim browser de `node:events` — EventEmitter minimal mais complet pour
 * Event.ts (on/once/off/emit/setMaxListeners). Aucune dépendance npm.
 *
 * Implémente l'API utilisée par Nodefony : pas d'event `error` spécial,
 * pas de `prependListener`/`prependOnceListener` ni `Symbol.for("nodejs.rejection")`.
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
}

export default EventEmitter;
