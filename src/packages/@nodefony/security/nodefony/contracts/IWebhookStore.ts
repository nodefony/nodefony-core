import type {
  IWebhookEndpoint,
  WebhookEndpointUpdate,
} from "./IWebhookEndpoint";

/**
 * Persistance des **endpoints webhook** (configuration durable, pas un cache).
 * Backend interchangeable (Memory dev/test · Drizzle SQL · Mongoose) via le
 * registre {@link ../src/webhook/webhookStoreRegistry}. **Redis n'est PAS un
 * store d'endpoints** (config durable ≠ éphémère) — il servira la *queue de
 * livraison* cross-pod (slice cluster), pas ce contrat.
 *
 * Volume attendu : faible (dizaines d'endpoints), lecture fréquente par le
 * dispatcher (qui en garde un snapshot mémoire), écriture rare (CRUD admin).
 */
export interface IWebhookStore {
  /** Insère un nouvel endpoint. */
  save(endpoint: IWebhookEndpoint): Promise<void>;
  /** Charge un endpoint par id, ou `null`. */
  findById(id: string): Promise<IWebhookEndpoint | null>;
  /** Applique un patch partiel (champs mutables) ; no-op si id absent. */
  update(id: string, patch: WebhookEndpointUpdate): Promise<void>;
  /** Supprime un endpoint ; no-op si id absent. */
  delete(id: string): Promise<void>;
  /** Tous les endpoints (console admin + rechargement du snapshot dispatcher). */
  listAll(): Promise<IWebhookEndpoint[]>;
}
