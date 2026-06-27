import type { IWebhookStore } from "../../contracts/IWebhookStore";
import type {
  IWebhookEndpoint,
  WebhookEndpointUpdate,
} from "../../contracts/IWebhookEndpoint";

/**
 * Store d'endpoints webhook **en mémoire** — défaut dev/test (non persistant :
 * les endpoints sont perdus au redémarrage). En prod, utiliser `drizzle`/
 * `mongoose` (config `webhooks.store`).
 *
 * Map indexée par id (O(1)). Les lectures renvoient une **copie défensive** : le
 * store détient la vérité, un consommateur ne peut pas muter un record en place.
 */
export class MemoryWebhookStore implements IWebhookStore {
  readonly #byId = new Map<string, IWebhookEndpoint>();

  async save(endpoint: IWebhookEndpoint): Promise<void> {
    this.#byId.set(endpoint.id, { ...endpoint });
  }

  async findById(id: string): Promise<IWebhookEndpoint | null> {
    const found = this.#byId.get(id);
    return found ? { ...found } : null;
  }

  async update(id: string, patch: WebhookEndpointUpdate): Promise<void> {
    const current = this.#byId.get(id);
    if (!current) return;
    this.#byId.set(id, { ...current, ...patch });
  }

  async delete(id: string): Promise<void> {
    this.#byId.delete(id);
  }

  async listAll(): Promise<IWebhookEndpoint[]> {
    return [...this.#byId.values()].map((e) => ({ ...e }));
  }
}
