import path from "node:path";
import type { Container } from "nodefony";
import type { ISecurityConfig } from "../../config/defineSecurityConfig";
import type { IWebAuthnCredentialStore } from "../../contracts/IWebAuthnCredentialStore";
import { MemoryWebAuthnCredentialStore } from "./MemoryWebAuthnCredentialStore";
import { FileWebAuthnCredentialStore } from "./FileWebAuthnCredentialStore";

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

// ─── Builtins sans dépendance — enregistrés à l'import du module ─────────────
registerWebAuthnStore("memory", () => new MemoryWebAuthnCredentialStore());

// Persistance fichier (mono-process) — les passkeys survivent au redémarrage.
// Chemin : `passkeys.storePath` si fourni, sinon <cwd>/var/webauthn-credentials.json.
registerWebAuthnStore("file", (ctx) => {
  const configured = ctx?.config?.passkeys?.storePath;
  const filePath =
    typeof configured === "string" && configured.length > 0
      ? configured
      : path.resolve(process.cwd(), "var", "webauthn-credentials.json");
  return new FileWebAuthnCredentialStore(filePath);
});
