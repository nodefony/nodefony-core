/// <reference types="node" />
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request state propagated transparently across the async pipeline.
 *
 * Set by HttpKernel at request entry (`handleHttp` / `handleWebsocket`) and
 * accessible from any downstream service (logs, ORM, security decorators)
 * without manually threading the context.
 *
 * Open shape — modules add their own keys (security adds `user`, audit
 * adds `traceparent`, etc.). Keep keys flat and primitive when possible.
 */
export interface RequestContextPayload {
  requestId: string;
  scheme?: string;
  /** Set by the security firewall after `afterAuth` (P6). */
  userId?: string;
  /** Set by the security firewall after `afterAuth` (P6). IUser instance. */
  user?: unknown;
  /** W3C traceparent header for OpenTelemetry compatibility (P2.7). */
  traceparent?: string;
  [key: string]: unknown;
}

/**
 * AsyncLocalStorage facade — single shared instance per process. Lazily
 * constructed so importing this module has zero cost if `run()` is never
 * called (the ALS allocation is the only cost).
 *
 * Perf : `als.run` adds ~50-100 ns per request on Node 22+. `.getStore()`
 * is a hot-path read — keep it cheap.
 */
class RequestContext {
  private static _als: AsyncLocalStorage<RequestContextPayload> | null = null;

  private static get als(): AsyncLocalStorage<RequestContextPayload> {
    if (this._als === null) {
      this._als = new AsyncLocalStorage<RequestContextPayload>();
    }
    return this._als;
  }

  /** Enter a new request scope. All `await`s inside `fn` see the payload. */
  static run<T>(payload: RequestContextPayload, fn: () => T): T {
    return this.als.run(payload, fn);
  }

  /** Returns the current payload, or `undefined` outside any request scope. */
  static get(): RequestContextPayload | undefined {
    if (this._als === null) return undefined;
    return this._als.getStore();
  }

  /** Shortcut — returns the current requestId or `undefined`. */
  static getRequestId(): string | undefined {
    return this.get()?.requestId;
  }

  /** Shortcut — returns the current authenticated user (P6) or `undefined`. */
  static getUser(): unknown | undefined {
    return this.get()?.user;
  }

  /** Shortcut — returns the current userId (P6) or `undefined`. */
  static getUserId(): string | undefined {
    return this.get()?.userId;
  }

  /**
   * Mutate the current payload in place. No-op outside a scope.
   * Used by security after login to inject `user`/`userId` without re-running.
   */
  static set<K extends keyof RequestContextPayload>(
    key: K,
    value: RequestContextPayload[K],
  ): void {
    const store = this.get();
    if (store) store[key] = value;
  }
}

export default RequestContext;
