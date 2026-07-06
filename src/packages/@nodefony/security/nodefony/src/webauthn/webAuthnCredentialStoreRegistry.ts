import type { Container } from "nodefony";
import type { ISecurityConfig } from "../../config/defineModuleConfig";
import type { IWebAuthnCredentialStore } from "../../contracts/IWebAuthnCredentialStore";
import { MemoryWebAuthnCredentialStore } from "./MemoryWebAuthnCredentialStore";

/**
 * Registre de **fabriques de stores de credentials WebAuthn** — résout un nom
 * (`memory`, `drizzle`, `mongoose`, `redis`…) vers une instance, SANS coupler le
 * cœur à un backend en dur.
 *
 * Convention-frère de `tokenStoreRegistry` : le builtin `memory` s'enregistre au
 * chargement du module ; les adapters lourds s'enregistrent depuis LEUR module
 * (ils importent `import type { IWebAuthnCredentialStore }`, effacé à la compilation).
 */
export interface IWebAuthnStoreFactoryContext {
  /** Container DI — résolution de services (ORM, redis…). */
  readonly container: Container;
  /** Config sécurité validée + gelée. */
  readonly config: ISecurityConfig;
}

/** Fabrique d'un store de credentials pour un nom donné. */
export type WebAuthnStoreFactory = (
  ctx: IWebAuthnStoreFactoryContext,
) => IWebAuthnCredentialStore;

const factories = new Map<string, WebAuthnStoreFactory>();

/** Enregistre (ou remplace) la fabrique d'un store de credentials WebAuthn. */
export function registerWebAuthnStore(
  name: string,
  factory: WebAuthnStoreFactory,
): void {
  factories.set(name, factory);
}

/** Fabrique d'un store par nom, ou `undefined` si inconnu. */
export function getWebAuthnStoreFactory(
  name: string,
): WebAuthnStoreFactory | undefined {
  return factories.get(name);
}

/** Noms enregistrés (validation boot, introspection Studio, tests). */
export function listWebAuthnStores(): string[] {
  return [...factories.keys()];
}

// ─── Builtin sans dépendance — enregistré à l'import du module ────────────────
// Seul `memory` (volatil, dev/tests) est builtin. La PERSISTANCE passe par un
// adapter durable (drizzle/mongoose/redis) auto-enregistré par le module chargé —
// plus de store fichier JSON maison (retiré : sqlite couvre la persistance mono-nœud).
registerWebAuthnStore("memory", () => new MemoryWebAuthnCredentialStore());
