/// <reference types="node" />
import { AsyncLocalStorage } from "node:async_hooks";
import type { IScope } from "../types/IContainer";

/**
 * Une requête ORM (SQL/NoSQL) capturée pendant le scope de requête, pour le
 * profiler dev-only. Shape canonique partagée par tous les adapters ORM et le
 * Profiler `@nodefony/http` (structurellement identique à `ProfileQuery`).
 */
export interface IProfilerQuery {
  /** Requête (SQL ou commande NoSQL), tronquée si volumineuse. */
  sql: string;
  /**
   * Début relatif (`performance.now()`, ms) — même horloge que
   * `PhaseTiming.startMs` du Context, donc la requête se PLACE dans le waterfall
   * des phases (le SQL apparaît DANS la barre `action`), au lieu de flotter en
   * liste à côté. Absent si l'adapter ne l'a pas fourni.
   */
  startMs?: number;
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
  /**
   * Scope DI de la requête — le même objet que `context.container`. Posé par
   * `HttpKernel` (requête HTTP ; handshake WebSocket, dont les messages
   * héritent) et par le pont `api.request` du temps réel. Se lit par
   * {@link RequestContext.getScope}, qui écarte un scope déjà refermé : ne pas
   * le lire directement.
   */
  scope?: IScope;
  /**
   * Corps de la requête posé par le **pont WS-RPC `api.request`** (mutations) :
   * en WebSocket il n'existe aucun corps HTTP parsé, donc le pont transporte la
   * charge utile de la frame ici (per-invocation via `RequestContext.run` → zéro
   * bleed entre frames concurrentes de la même socket). Lu par
   * `AdminApiController.buildRequest` en priorité sur `queryPost` (vide en WS).
   * Absent en HTTP (le corps vient du pipeline → `queryPost`).
   */
  body?: unknown;
  /**
   * Clé d'idempotence (modèle Stripe) portée par une **mutation** du data plane
   * admin : posée par le pont WS (`params.idempotencyKey`) ou lue de l'en-tête
   * HTTP `Idempotency-Key`. Sert à dédoublonner un rejeu (socket qui reconnecte)
   * → cache borné scopé à l'identité. Absente = pas de dédup (GET, HTTP legacy).
   */
  idempotencyKey?: string;
  /**
   * Puits de CAPTURE du rendu, posé par le **pont WS-RPC `api.request`** : une
   * action user peut répondre par un RENDU (`renderJson`/`renderView`) au lieu
   * d'une valeur nue. En HTTP ce rendu écrit la réponse ; via le pont il ne
   * doit JAMAIS écrire une frame nue sur la socket (hors protocole JSON-RPC —
   * et le retour `WebsocketResponse` est circulaire → `JSON.stringify` de
   * l'enveloppe casserait la chaîne du peer). Quand ce sink est présent,
   * `WebsocketContext.send()` capture le payload ici au lieu de l'émettre ; le
   * pont le sert ensuite en `result` RPC. Per-invocation via
   * `RequestContext.run` → zéro bleed entre frames concurrentes d'une socket.
   */
  renderSink?: { body?: string | Buffer };
  /**
   * Profil de l'**invocation** en cours (`FrameProfile` de `@nodefony/http`),
   * posé par le pont WS-RPC. Porte les phases et le buffer ORM de CETTE frame :
   * le contexte WebSocket, lui, vit pour toute la connexion — y empiler des
   * phases produirait une timeline cumulative, donc fausse. Typé `unknown` (le
   * core ne connaît pas `@nodefony/http`) ; absent en HTTP, où le contexte EST
   * l'unité de requête. Présent seulement quand le profiler dev ou le timing
   * sont actifs.
   */
  invocation?: unknown;
  [key: string]: unknown;
}

/**
 * Message d'échec de {@link RequestContext.requireScope} : il nomme LA cause
 * parmi trois, parce que chacune appelle un geste différent. Chemin froid —
 * construit seulement quand l'appel échoue.
 */
function describeMissingScope(
  store: RequestContextPayload | undefined,
): string {
  const prefix = "RequestContext.requireScope() : ";
  if (store === undefined) {
    return (
      prefix +
      "aucune requête en cours. Ce code s'exécute hors de toute requête HTTP " +
      "et de toute connexion WebSocket (démarrage, commande CLI, minuterie " +
      "armée hors requête). RequestContext.getScope() rend alors undefined : " +
      "le tester d'abord."
    );
  }
  if (store.scope == null) {
    return (
      `${prefix}la requête « ${store.requestId} » ne porte pas de scope. Sa ` +
      "bulle a été ouverte par un RequestContext.run() qui ne pose pas " +
      "« scope » : l'ajouter à la charge utile de ce run()."
    );
  }
  return (
    `${prefix}le scope de la requête « ${store.requestId} » est déjà fermé. ` +
    "Ce code s'exécute après la fin de la requête ou de la connexion " +
    "(promesse non attendue, minuterie, hook branché trop tard) : lire ce " +
    "dont il a besoin avant que la réponse parte."
  );
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
   * Rend le scope DI de la requête en cours : le conteneur propre à CETTE
   * requête, ou `undefined` s'il n'y en a pas d'ouvert.
   *
   * Le scope hérite de tous les services du kernel par sa chaîne de
   * prototypes : on y lit tout, mais ce qu'on y écrit (`set`) ne concerne que
   * cette requête et disparaît avec elle. C'est le même objet que
   * `context.container`, atteignable sans connaître le transport.
   *
   * - HTTP : un scope par requête.
   * - WebSocket : un scope par CONNEXION, partagé par tous ses messages et
   *   toutes ses invocations `api.request`, concurrentes comprises — n'y poser
   *   que ce qui vaut pour la connexion entière.
   * - `undefined` hors requête (démarrage, CLI, minuterie armée hors requête),
   *   dans une bulle ouverte sans scope, et une fois le scope refermé : les
   *   hooks `onAfterResponse` le voient encore ouvert ; une promesse non
   *   attendue qui continue après la réponse, non.
   *
   * Ne pas confondre avec `Injector.getScope()`, qui rend la DURÉE DE VIE
   * déclarée d'un service (`"singleton"`, `"transient"`).
   *
   * @returns le scope ouvert de la requête courante, ou `undefined`.
   */
  static getScope(): IScope | undefined {
    const scope = this.get()?.scope;
    return scope != null && !scope.closed ? scope : undefined;
  }

  /**
   * Comme {@link getScope}, mais lève quand aucun scope ouvert n'est
   * disponible — pour le code qui n'a pas de sens hors d'une requête.
   *
   * @returns le scope ouvert de la requête courante.
   * @throws Error qui nomme la cause : aucune requête en cours, une bulle
   * ouverte sans scope (un `RequestContext.run()` qui ne pose pas `scope`), ou
   * un scope déjà refermé (code qui continue après la fin de la requête).
   */
  static requireScope(): IScope {
    const store = this.get();
    const scope = store?.scope;
    if (scope != null && !scope.closed) return scope;
    throw new Error(describeMissingScope(store));
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
