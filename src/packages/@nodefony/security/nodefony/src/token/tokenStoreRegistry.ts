import type { Container } from "nodefony";
import type { ISecurityConfig } from "../../config/defineSecurityConfig";
import type { ITokenStore } from "../../contracts/ITokenStore";
import { MemoryTokenStore } from "./MemoryTokenStore";

/**
 * Registre de **fabriques de stores de jetons** — résout le nom configuré
 * (`security.tokenStore`) vers une instance d'{@link ITokenStore}, SANS coupler
 * le cœur à un backend en dur.
 *
 * Pourquoi : le store est pluggable par contrat (mémoire/fichier/ORM/Redis) ;
 * un `if (name === "redis")` trahirait cette promesse. Les builtins sans
 * dépendance (`memory`) s'enregistrent au chargement du module ; les adapters
 * lourds (`drizzle`, `mongoose`, `redis`) s'enregistrent depuis LEUR module
 * (inversion de dépendance : ils importent `import type { ITokenStore }`, effacé
 * à la compilation). Convention-frère : `authenticatorRegistry`, `ormRegistry`,
 * `SessionsService.registerStorage`.
 */

/**
 * Contexte passé à une fabrique de store : de quoi se construire (résolutions
 * coûteuses en lazy à l'intérieur de l'instance).
 */
export interface ITokenStoreFactoryContext {
  /** Container DI — résolution de services (ORM, redis...). */
  readonly container: Container;
  /** Config sécurité validée + gelée. */
  readonly config: ISecurityConfig;
}

/** Fabrique d'un store de jetons pour un nom donné. */
export type TokenStoreFactory = (ctx: ITokenStoreFactoryContext) => ITokenStore;

const factories = new Map<string, TokenStoreFactory>();

/**
 * Enregistre (ou remplace) la fabrique d'un store de jetons. Appelée par le
 * builtin `memory` au chargement, et par les adapters (drizzle/mongoose/redis)
 * pour les leurs.
 */
export function registerTokenStore(
  name: string,
  factory: TokenStoreFactory,
): void {
  factories.set(name, factory);
}

/** Fabrique d'un store par nom, ou `undefined` si inconnu. */
export function getTokenStoreFactory(
  name: string,
): TokenStoreFactory | undefined {
  return factories.get(name);
}

/** Noms enregistrés (validation boot, introspection Studio, tests). */
export function listTokenStores(): string[] {
  return [...factories.keys()];
}

// ─── Builtin sans dépendance — enregistré à l'import du module ────────────────
registerTokenStore("memory", () => new MemoryTokenStore());
