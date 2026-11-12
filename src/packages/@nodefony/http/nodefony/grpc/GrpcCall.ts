import { createContextValues } from "@connectrpc/connect";
import type {
  ContextKey,
  ContextValues,
  HandlerContext,
} from "@connectrpc/connect";

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
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export class GrpcCall implements ContextValues {
  /**
   * L'objet qui implémente le service pour CET appel : le contrôleur, une
   * instance par appel sous `@Scope("request")`. `null` quand l'adaptateur est
   * appelé hors de {@link GrpcEndpoint.serve} (jamais en service normal).
   */
  readonly target: object | null;

  /** Magasin des clés de tiers, créé au premier `set`. */
  #values: ContextValues | null = null;

  constructor(target: object | null) {
    this.target = target;
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
