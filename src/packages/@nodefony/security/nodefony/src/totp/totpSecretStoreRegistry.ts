import path from "node:path";
import type { Container } from "nodefony";
import type { ISecurityConfig } from "../../config/defineModuleConfig";
import type { ITotpSecretStore } from "../../contracts/ITotpSecretStore";
import { MemoryTotpSecretStore } from "./MemoryTotpSecretStore";
import { FileTotpSecretStore } from "./FileTotpSecretStore";

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

/** Chemin par défaut de la persistance fichier (mono-process). */
function defaultStorePath(config: ISecurityConfig): string {
  const configured = config.totp?.storePath;
  return typeof configured === "string" && configured.length > 0
    ? configured
    : path.resolve(process.cwd(), "var", "totp-secrets.json");
}

// ─── Builtins sans dépendance — enregistrés à l'import du module ─────────────
registerTotpStore("memory", () => new MemoryTotpSecretStore());

// Persistance fichier (mono-process) — les secrets survivent au redémarrage.
registerTotpStore(
  "file",
  (ctx) => new FileTotpSecretStore(defaultStorePath(ctx.config)),
);
