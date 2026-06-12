/// <reference types="node" />
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Une requête ORM (SQL/NoSQL) capturée pendant le scope de requête, pour le
 * profiler dev-only. Shape canonique partagée par tous les adapters ORM et le
 * Profiler `@nodefony/http` (structurellement identique à `ProfileQuery`).
 */
export interface IProfilerQuery {
  /** Requête (SQL ou commande NoSQL), tronquée si volumineuse. */
  sql: string;
  /** Durée d'exécution en ms. */
  durationMs: number;
  /** Lignes affectées/retournées, si connu. */
  rows?: number;
  /** Connecteur émetteur (`drizzle`, `mongoose`…). */
  connector?: string;
}

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
  /**
   * Buffer de requêtes ORM du profiler — **présent uniquement en dev** quand
   * le `HttpKernel` l'alloue (profiler actif). Son absence = signal « ne pas
   * profiler » : les adapters ORM gardent un coût nul en prod. Même référence
   * que `context.profilerQueries`, lue par `Profiler.collect()` au teardown.
   *
   * ⚠️ Contrat sécurité : un adapter qui pousse ici DOIT redacter le `sql`
   * via {@link redactSecrets} AVANT le push (le SQL interpolé peut contenir un
   * credential). Le SQL paramétré (placeholders `?`, ex. Drizzle) est déjà
   * credential-free ; le SQL interpolé (ex. un ORM en mode `logging`) ne l'est pas.
   */
  queries?: IProfilerQuery[];
  /**
   * Contexte transport courant (`HttpContext` / `WebsocketContext`), posé par
   * `HttpKernel` à l'entrée du scope (V4.1). Typé `unknown` ici : le core ne
   * connaît pas `@nodefony/http` — les consommateurs (helpers `Controller`,
   * décorateurs) castent. Permet aux controllers **singleton** (stateless) de
   * retrouver le contexte de LA requête en cours sans le porter sur `this`.
   */
  context?: unknown;
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

  /**
   * Shortcut — returns the current transport context (V4.1) or `undefined`.
   * Générique car le core ne connaît pas les types de `@nodefony/http` :
   * `RequestContext.getContext<ContextType>()` côté framework.
   */
  static getContext<T = unknown>(): T | undefined {
    return this.get()?.context as T | undefined;
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

  /**
   * `true` si un buffer de profiling de requêtes ORM est actif sur le scope
   * courant (dev + `HttpKernel` profiler activé). Les adapters ORM lisent ce
   * flag AVANT de mesurer (`performance.now()`) pour rester gratuits en prod.
   *
   * @returns `true` si `pushQuery` aura un effet, `false` sinon.
   */
  static isProfiling(): boolean {
    return this.get()?.queries !== undefined;
  }

  /**
   * Pousse une requête ORM dans le buffer de profiling du scope courant.
   * No-op hors scope ou hors dev (buffer absent) → coût nul en prod.
   *
   * @param query - requête capturée (sql, durée, lignes, connecteur).
   */
  static pushQuery(query: IProfilerQuery): void {
    const buf = this.get()?.queries;
    if (buf) buf.push(query);
  }
}

export default RequestContext;
