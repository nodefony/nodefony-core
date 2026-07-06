import type { Module, IIdempotencyStore } from "nodefony";
import type { FrameworkConfig } from "../config/config";

/**
 * Registre de **fabriques de stores d'idempotence DISTRIBUÉS** — résout le nom
 * configuré (`framework.idempotency.store`) vers une instance d'
 * {@link IIdempotencyStore}, SANS coupler le framework à un backend en dur.
 *
 * Pourquoi : le store d'idempotence est pluggable par contrat (le contrat vit au
 * CORE, `nodefony`). Le DÉFAUT mémoire (`MemoryIdempotencyStore`, per-pod) reste
 * enregistré par `@services` du module framework (zéro config, toujours présent)
 * → il n'est PAS dans ce registre. Ce registre ne porte QUE les **overrides
 * distribués opt-in** (`redis`, `drizzle`) : un `if (name === "redis")` dans le
 * framework trahirait la promesse pluggable, et le framework ne peut de toute
 * façon pas importer `@nodefony/redis` (graphe inverse).
 *
 * Inversion de dépendance : les adapters (`@nodefony/redis`/`@nodefony/drizzle`)
 * exportent une classe PURE (`import type` du contrat core) ; l'**application**
 * câble la fabrique (`registerIdempotencyStore("redis", …)`), car activer un
 * store distribué est une décision de **déploiement** (cluster multi-pod), pas
 * une conséquence du chargement du module. Convention-frère : `tokenStoreRegistry`
 * (`@nodefony/security`), `backplaneRegistry` (`@nodefony/realtime`).
 */

/**
 * Contexte passé à une fabrique de store : de quoi se construire (résolutions
 * coûteuses en lazy à l'intérieur de l'instance). Le module donne accès au
 * container kernel (`ctx.module.kernel?.container?.get("redis")`).
 */
export interface IIdempotencyStoreFactoryContext {
  /** Module framework (porte `kernel.container` pour résoudre `redis`, etc.). */
  readonly module: Module;
  /** Config framework validée + gelée. */
  readonly config: FrameworkConfig;
}

/** Fabrique d'un store d'idempotence pour un nom donné. */
export type IdempotencyStoreFactory = (
  ctx: IIdempotencyStoreFactoryContext,
) => IIdempotencyStore;

const factories = new Map<string, IdempotencyStoreFactory>();

/**
 * Enregistre (ou remplace) la fabrique d'un store d'idempotence distribué.
 * Appelée par l'application pour les adapters (`redis`/`drizzle`).
 */
export function registerIdempotencyStore(
  name: string,
  factory: IdempotencyStoreFactory,
): void {
  factories.set(name, factory);
}

/** Fabrique d'un store par nom, ou `undefined` si inconnu. */
export function getIdempotencyStoreFactory(
  name: string,
): IdempotencyStoreFactory | undefined {
  return factories.get(name);
}

/**
 * Noms de stores distribués enregistrés (résolution `auto` + validation boot).
 * N'inclut PAS `"memory"` : dans `resolveAutoStore`, memory est le **fallback**
 * (per-pod), jamais une préférence à sélectionner — l'y mettre fausserait le choix.
 */
export function listIdempotencyStores(): string[] {
  return [...factories.keys()];
}

/**
 * Backends d'idempotence UTILISABLES, pour l'AFFICHAGE (écran Studio « Stores »).
 * Inclut le builtin `"memory"` (toujours présent via `@services`, per-pod) EN TÊTE
 * + les stores distribués enregistrés. Distinct de {@link listIdempotencyStores}
 * (distribués seuls, pour la résolution) : côté Studio, le store résolu doit
 * TOUJOURS figurer dans les backends dispo — sinon `resolved: "memory"` apparaît
 * absent de la liste (incohérence). Convention-frère : les autres briques
 * enregistrent leur builtin `memory` dans leur registre, donc `listXStores()`
 * l'inclut déjà ; idempotency pose son memory hors registre → on le rajoute ici.
 */
export function listIdempotencyBackends(): string[] {
  return ["memory", ...factories.keys()];
}
