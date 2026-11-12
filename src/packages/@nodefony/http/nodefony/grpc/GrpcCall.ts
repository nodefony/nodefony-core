import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import type {
  ContextKey,
  ContextValues,
  HandlerContext,
} from "@connectrpc/connect";
import type { IRpcCall } from "../interfaces/IRpcCall";
import type HttpContext from "../src/context/http/HttpContext";

/**
 * Fiche d'un appel gRPC : ce que Nodefony attache à l'appel, et le
 * `ContextValues` que Connect remet au gestionnaire (`ctx.values`).
 *
 * Connect alloue à chaque appel un `ContextValues` fait d'un objet littéral et
 * de trois fermetures (`context-values.js#createContextValues`), dont la forme
 * change à chaque `set`. La fiche le REMPLACE (option `contextValues` de
 * l'adaptateur) : une classe à champs déclarés, méthodes au prototype, une
 * allocation par appel au lieu de quatre.
 *
 * Les clés posées par un tiers (intercepteur, porte) sont confiées à un
 * `createContextValues()` créé au premier `set` : aucune allocation tant que
 * personne n'en pose, et aucune conversion de type — la valeur rendue est celle
 * que le magasin de Connect a typée.
 *
 * C'est aussi l'appel RPC du contexte (`HttpContext.rpc`, ADR-0026 D10) : à
 * l'échéance du délai de réponse, le noyau le termine par {@link expire}.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export class GrpcCall implements ContextValues, IRpcCall {
  /**
   * L'objet qui implémente le service pour CET appel : le contrôleur, une
   * instance par appel sous `@Scope("request")`. `null` quand l'adaptateur est
   * appelé hors de {@link GrpcEndpoint.serve} (jamais en service normal).
   */
  readonly target: object | null;
  /**
   * Le contexte de la requête qui porte l'appel : l'identité y est lue
   * (`authenticatedUser()`) sur son magasin, jamais par l'ALS, pour choisir
   * entre 16 et 7 (ADR-0026 D5, D7). `null` hors de {@link GrpcEndpoint.serve}.
   */
  readonly context: HttpContext | null;

  /** Magasin des clés de tiers, créé au premier `set`. */
  #values: ContextValues | null = null;
  /** Contexte d'appel du gestionnaire en cours (unaire, flux). */
  #ctx: HandlerContext | null = null;
  /** Rejet de la promesse rendue à l'adaptateur (réponse unique). */
  #reject: ((reason: unknown) => void) | null = null;
  /**
   * Pourquoi le serveur a interrompu l'appel — délai échu (4), identité
   * révoquée (16) —, `null` tant qu'il ne l'a pas fait. Posé une fois : la
   * première cause gagne.
   */
  #reason: ConnectError | null = null;

  constructor(target: object | null, context: HttpContext | null = null) {
    this.target = target;
    this.context = context;
  }

  /**
   * Lit une valeur posée par un tiers, ou la valeur par défaut de sa clé.
   *
   * @param key - la clé (`createContextKey`).
   * @returns la valeur posée, sinon `key.defaultValue`.
   */
  get<T>(key: ContextKey<T>): T {
    return this.#values === null ? key.defaultValue : this.#values.get(key);
  }

  /**
   * Pose une valeur pour la durée de l'appel.
   *
   * @param key - la clé (`createContextKey`).
   * @param value - la valeur.
   * @returns la fiche, pour chaîner.
   */
  set<T>(key: ContextKey<T>, value: T): this {
    (this.#values ??= createContextValues()).set(key, value);
    return this;
  }

  /**
   * Retire une valeur ; sa clé rendra de nouveau sa valeur par défaut.
   *
   * @param key - la clé (`createContextKey`).
   * @returns la fiche, pour chaîner.
   */
  delete(key: ContextKey<unknown>): this {
    this.#values?.delete(key);
    return this;
  }

  /**
   * Le délai de réponse du serveur est échu : le signal de l'appel s'abaisse
   * (`ctx.abort`) et l'appel se termine en 4 `DEADLINE_EXCEEDED`, même si le
   * gestionnaire ne lit pas son signal. Échu avant que le gestionnaire ne
   * démarre : il est terminé dès son démarrage. Sans effet après la fin.
   */
  expire(): void {
    if (this.#reason !== null) return;
    this.#interrupt(
      new ConnectError(
        "délai de réponse du serveur dépassé",
        Code.DeadlineExceeded,
      ),
    );
  }

  /**
   * L'identité qui a ouvert l'appel n'est plus valable : le signal de l'appel
   * s'abaisse et l'appel se termine en 16 `UNAUTHENTICATED`. Réponse unique :
   * sa promesse est rejetée. Flux : il s'arrête au message suivant, même si le
   * gestionnaire ne lit pas son signal — au plus le message déjà en vol part.
   * Sans effet après la fin, ou après une autre interruption.
   */
  revoke(): void {
    if (this.#reason !== null) return;
    this.#interrupt(
      new ConnectError("identité révoquée", Code.Unauthenticated),
    );
  }

  /**
   * L'interruption posée par le serveur, `null` tant qu'il n'y en a pas — lue
   * par l'enrobage d'un flux avant chaque message.
   *
   * @internal
   */
  get interruption(): ConnectError | null {
    return this.#reason;
  }

  /**
   * Suit un gestionnaire à réponse unique (unaire, flux client) jusqu'à sa
   * fin : une interruption pourra rejeter sa promesse.
   *
   * @param ctx - le contexte d'appel remis au gestionnaire.
   * @param reject - le rejet de la promesse rendue à l'adaptateur.
   *
   * @internal
   */
  attach(ctx: HandlerContext, reject: (reason: unknown) => void): void {
    this.#ctx = ctx;
    const reason = this.#reason;
    if (reason !== null) {
      this.#end(reason, reject);
      return;
    }
    this.#reject = reject;
  }

  /**
   * Suit un gestionnaire en flux (serveur, bidirectionnel) : une interruption
   * abaissera son signal. Son itérateur s'arrête par {@link interruption}.
   *
   * @param ctx - le contexte d'appel remis au gestionnaire.
   *
   * @internal
   */
  follow(ctx: HandlerContext): void {
    this.#ctx = ctx;
    const reason = this.#reason;
    if (reason !== null && hasAbort(ctx)) ctx.abort(reason);
  }

  /**
   * Le gestionnaire a répondu ou levé : plus rien à terminer.
   *
   * @internal
   */
  detach(): void {
    this.#ctx = null;
    this.#reject = null;
  }

  #interrupt(reason: ConnectError): void {
    this.#reason = reason;
    const reject = this.#reject;
    if (reject !== null) {
      this.#end(reason, reject);
      return;
    }
    const ctx = this.#ctx;
    if (ctx !== null && hasAbort(ctx)) ctx.abort(reason);
  }

  #end(reason: ConnectError, reject: (reason: unknown) => void): void {
    const ctx = this.#ctx;
    this.detach();
    if (ctx !== null && hasAbort(ctx)) ctx.abort(reason);
    reject(reason);
  }
}

/**
 * Le contexte d'appel que Connect remet réellement au gestionnaire : son type
 * public (`HandlerContext`) ne dit pas `abort`, que porte pourtant l'objet créé
 * par `createHandlerContext` (`HandlerContextController`, non exporté).
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export interface IAbortableHandlerContext extends HandlerContext {
  /** Interrompt l'appel : `ctx.signal` s'abaisse avec `reason`. */
  abort(reason?: unknown): void;
}

/**
 * Garde de type : le contexte d'appel porte-t-il `abort` ? Connect le pose sur
 * tout contexte qu'il crée ; le garde le CONSTATE au lieu de le supposer, pour
 * qu'une version de Connect qui le retirerait se voie à l'exécution (et au
 * test qui le garde) plutôt que par un appel qui ne s'interrompt plus.
 *
 * @param ctx - le contexte remis au gestionnaire.
 * @returns `true` si `ctx.abort` est une fonction.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export function hasAbort(ctx: HandlerContext): ctx is IAbortableHandlerContext {
  return "abort" in ctx && typeof ctx.abort === "function";
}
