import type { Container } from "nodefony";
import type { ISecurityConfig } from "../../config/defineSecurityConfig";
import type { IWebhookStore } from "../../contracts/IWebhookStore";
import { MemoryWebhookStore } from "./MemoryWebhookStore";

/**
 * Registre de **fabriques de stores d'endpoints webhook** — résout un nom
 * (`memory`, `drizzle`, `mongoose`…) vers une instance, SANS coupler le cœur à un
 * backend en dur.
 *
 * Convention-frère de `totpSecretStoreRegistry` / `tokenStoreRegistry` : le
 * builtin sans dépendance (`memory`) s'enregistre au chargement du module ; les
 * adapters lourds s'enregistrent depuis LEUR module (`import type { IWebhookStore }`,
 * effacé à la compilation → 0 dép runtime, 0 cycle).
 *
 * Pas de builtin `file` (un endpoint n'est pas un fichier de session) ni `redis`
 * (la config durable ne vit pas dans un cache ; Redis servira la *queue de
 * livraison* cross-pod, pas ce contrat).
 */
export interface IWebhookStoreFactoryContext {
  /** Container DI — résolution de services (ORM…). */
  readonly container: Container;
  /** Config sécurité validée + gelée. */
  readonly config: ISecurityConfig;
}

/** Fabrique d'un store d'endpoints webhook pour un nom donné. */
export type WebhookStoreFactory = (
  ctx: IWebhookStoreFactoryContext,
) => IWebhookStore;

const factories = new Map<string, WebhookStoreFactory>();

/** Enregistre (ou remplace) la fabrique d'un store d'endpoints webhook. */
export function registerWebhookStore(
  name: string,
  factory: WebhookStoreFactory,
): void {
  factories.set(name, factory);
}

/** Fabrique d'un store par nom, ou `undefined` si inconnu. */
export function getWebhookStoreFactory(
  name: string,
): WebhookStoreFactory | undefined {
  return factories.get(name);
}

/** Noms enregistrés (validation boot, introspection Studio, tests). */
export function listWebhookStores(): string[] {
  return [...factories.keys()];
}

// ─── Builtin sans dépendance — enregistré à l'import du module ───────────────
registerWebhookStore("memory", () => new MemoryWebhookStore());
