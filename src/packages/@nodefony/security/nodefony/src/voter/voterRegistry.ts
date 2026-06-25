import type { Container } from "nodefony";
import type { IAccessVoter } from "../../contracts/IAccessVoter";
import { RoleVoter } from "./RoleVoter";
import { ScopeVoter } from "./ScopeVoter";

/**
 * Registre de **fabriques de voters** — alimente l'`AuthorizationService` au boot
 * SANS qu'il connaisse le moindre voter en dur.
 *
 * Pourquoi un registre (et pas un scan DI « tous les `@injectable` implémentant
 * `IAccessVoter` ») : les interfaces TypeScript sont **effacées à la compilation**
 * — rien à scanner au runtime. Le registre EST le marqueur explicite. Un voter
 * built-in s'enregistre au chargement du module (toujours avant le boot) ; un
 * voter métier (app/plugin) appelle `registerVoterFactory("projectVoter", …)`
 * puis il est découvert automatiquement — aucun changement dans le cœur.
 * Convention-frère : `authenticatorRegistry`, `tokenStoreRegistry`.
 */

/**
 * Contexte passé à une fabrique de voter : le container DI pour résoudre les
 * services dont le voter a besoin (repository, hiérarchie de rôles…). La fabrique
 * ne fait QUE construire — les résolutions coûteuses restent lazy dans l'instance.
 */
export interface IVoterFactoryContext {
  /** Container DI — résolution de services (`roleHierarchy`, repositories…). */
  readonly container: Container;
}

/** Fabrique d'un voter pour un nom donné. */
export type VoterFactory = (ctx: IVoterFactoryContext) => IAccessVoter;

const factories = new Map<string, VoterFactory>();

/**
 * Enregistre (ou remplace) la fabrique d'un voter. Appelé par les builtins au
 * chargement du module, et par les apps/plugins pour les leurs (`ProjectVoter`,
 * `TenantVoter`…).
 */
export function registerVoterFactory(
  name: string,
  factory: VoterFactory,
): void {
  factories.set(name, factory);
}

/** Toutes les fabriques enregistrées (consommées par l'`AuthorizationService`). */
export function listVoterFactories(): ReadonlyMap<string, VoterFactory> {
  return factories;
}

// ─── Builtins — enregistrés à l'import du module (dispo avant tout boot) ──────

// Niveau A : résout `ROLE_*` via la hiérarchie de rôles (RoleHierarchyWalker)
// posée au container par le firewall au boot.
registerVoterFactory("role", ({ container }) => new RoleVoter(container));

// Axe SCOPE (P6.8) : applique les scopes `api:action` de `@RequireScope`. Pur
// (aucune dépendance container) — il ne lit que le jeton de la requête.
registerVoterFactory("scope", () => new ScopeVoter());
