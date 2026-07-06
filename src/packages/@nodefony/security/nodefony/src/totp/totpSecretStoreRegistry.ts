import type { Container } from "nodefony";
import type { ISecurityConfig } from "../../config/defineModuleConfig";
import type { ITotpSecretStore } from "../../contracts/ITotpSecretStore";
import { MemoryTotpSecretStore } from "./MemoryTotpSecretStore";

/**
 * Registre de **fabriques de stores de secrets TOTP** — résout un nom (`memory`,
 * `file`, `drizzle`, `mongoose`, `redis`…) vers une instance, SANS coupler le cœur
 * à un backend en dur.
 *
 * Convention-frère de `webAuthnCredentialStoreRegistry` / `tokenStoreRegistry` :
 * les builtins sans dépendance (`memory`, `file`) s'enregistrent au chargement du
 * module ; les adapters lourds s'enregistrent depuis LEUR module (ils importent
 * `import type { ITotpSecretStore }`, effacé à la compilation → 0 dép runtime).
 */
export interface ITotpStoreFactoryContext {
  /** Container DI — résolution de services (ORM, redis…). */
  readonly container: Container;
  /** Config sécurité validée + gelée. */
  readonly config: ISecurityConfig;
}

/** Fabrique d'un store de secrets TOTP pour un nom donné. */
export type TotpStoreFactory = (
  ctx: ITotpStoreFactoryContext,
) => ITotpSecretStore;

const factories = new Map<string, TotpStoreFactory>();

/** Enregistre (ou remplace) la fabrique d'un store de secrets TOTP. */
export function registerTotpStore(
  name: string,
  factory: TotpStoreFactory,
): void {
  factories.set(name, factory);
}

/** Fabrique d'un store par nom, ou `undefined` si inconnu. */
export function getTotpStoreFactory(
  name: string,
): TotpStoreFactory | undefined {
  return factories.get(name);
}

/** Noms enregistrés (validation boot, introspection Studio, tests). */
export function listTotpStores(): string[] {
  return [...factories.keys()];
}

// ─── Builtin sans dépendance — enregistré à l'import du module ────────────────
// Seul `memory` (volatil) est builtin. La PERSISTANCE du 2FA passe par un adapter
// durable (`totp.store: "drizzle"` — auto-register par @nodefony/drizzle), plus de
// store fichier JSON maison (retiré : sqlite couvre la persistance mono-nœud).
registerTotpStore("memory", () => new MemoryTotpSecretStore());
