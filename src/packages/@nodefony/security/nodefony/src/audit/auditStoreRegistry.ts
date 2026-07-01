import type { Container } from "nodefony";
import type { ISecurityConfig } from "../../config/defineSecurityConfig";
import type { IAuditStore } from "../../contracts/IAuditStore";
import { MemoryAuditStore } from "./MemoryAuditStore";

/**
 * Registre de **fabriques de stores d'audit** — résout le nom configuré
 * (`security.audit.driver`) vers une instance d'{@link IAuditStore}, SANS coupler
 * le cœur à un backend en dur.
 *
 * Pourquoi : le journal d'audit est pluggable par contrat (mémoire/ORM/Redis/Loki) ;
 * un `if (name === "drizzle")` dans le service trahirait cette promesse. Le builtin
 * sans dépendance (`memory`) s'enregistre au chargement de ce module ; les adapters
 * lourds (`drizzle`, `mongoose`, `redis`) s'enregistrent depuis LEUR module
 * (inversion de dépendance : ils importent `import type { IAuditStore }`, effacé à
 * la compilation → 0 cycle). Convention-frère : `tokenStoreRegistry`,
 * `webAuthnCredentialStoreRegistry`, `ormRegistry`.
 */

/**
 * Contexte passé à une fabrique de store d'audit : de quoi se construire
 * (résolutions coûteuses en lazy à l'intérieur de l'instance).
 */
export interface IAuditStoreFactoryContext {
  /** Container DI — résolution de services (ORM, redis...). */
  readonly container: Container;
  /** Config sécurité validée + gelée. */
  readonly config: ISecurityConfig;
}

/** Fabrique d'un store d'audit pour un nom donné. */
export type AuditStoreFactory = (ctx: IAuditStoreFactoryContext) => IAuditStore;

const factories = new Map<string, AuditStoreFactory>();

/**
 * Enregistre (ou remplace) la fabrique d'un store d'audit. Appelée par le builtin
 * `memory` au chargement, et par les adapters (drizzle/mongoose/redis) pour les leurs.
 */
export function registerAuditStore(
  name: string,
  factory: AuditStoreFactory,
): void {
  factories.set(name, factory);
}

/** Fabrique d'un store par nom, ou `undefined` si inconnu. */
export function getAuditStoreFactory(
  name: string,
): AuditStoreFactory | undefined {
  return factories.get(name);
}

/** Noms enregistrés (validation boot, introspection Studio, tests). */
export function listAuditStores(): string[] {
  return [...factories.keys()];
}

const MS_PER_DAY = 86_400_000;

// ─── Builtin sans dépendance — enregistré à l'import du module ────────────────
// Défensif : la rétention vient de la config si fournie, sinon le défaut du store
// (365 j) — le builtin ne doit jamais crasher s'il est fabriqué sans config.
registerAuditStore("memory", (ctx) => {
  const days = ctx?.config?.audit?.retentionDays;
  return typeof days === "number"
    ? new MemoryAuditStore(Date.now, days * MS_PER_DAY)
    : new MemoryAuditStore();
});
