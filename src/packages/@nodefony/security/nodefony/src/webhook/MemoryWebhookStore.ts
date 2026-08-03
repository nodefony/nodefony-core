import type { IPage } from "nodefony";
import { assertPageQuery, compareByOrder, pickOrder } from "nodefony";
import type {
  IWebhookListQuery,
  IWebhookStore,
} from "../../contracts/IWebhookStore";
import type {
  IWebhookEndpoint,
  WebhookEndpointUpdate,
} from "../../contracts/IWebhookEndpoint";
import { WEBHOOK_DEFAULT_ORDER, WEBHOOK_SORTABLE_FIELDS } from "./webhookSort";

/**
 * Applique les filtres d'{@link IWebhookListQuery} à un endpoint — sémantique de
 * RÉFÉRENCE du contrat, partagée par les backends qui filtrent en mémoire.
 *
 * @param e - endpoint candidat.
 * @param query - filtres du listing (les champs omis ne filtrent pas).
 * @returns `true` si l'endpoint appartient à la collection filtrée.
 */
export function matchesWebhookQuery(
  e: IWebhookEndpoint,
  query: IWebhookListQuery,
): boolean {
  if (query.enabled !== undefined && e.enabled !== query.enabled) return false;
  if (query.failing !== undefined && e.failureCount > 0 !== query.failing) {
    return false;
  }
  if (query.event !== undefined && !e.events.includes(query.event)) {
    return false;
  }
  if (query.q !== undefined && query.q.length > 0) {
    const needle = query.q.toLowerCase();
    const haystack = `${e.url}\n${e.description ?? ""}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * Store d'endpoints webhook **en mémoire** — défaut dev/test (non persistant :
 * les endpoints sont perdus au redémarrage). En prod, utiliser `drizzle`/
 * `mongoose` (config `webhooks.store`).
 *
 * Map indexée par id (O(1)). Les lectures renvoient une **copie défensive** : le
 * store détient la vérité, un consommateur ne peut pas muter un record en place.
 */
export class MemoryWebhookStore implements IWebhookStore {
  /**
   * {@inheritDoc IWebhookStore.sortableFields}
   *
   * Le store porte l'endpoint complet : il sait trier tout le vocabulaire
   * public, sans réduction de capacité.
   */
  readonly sortableFields = WEBHOOK_SORTABLE_FIELDS;
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
    // oxlint-disable-next-line no-map-spread -- copie DÉFENSIVE : le remplacement suggéré (`Object.assign`) rendrait la référence interne du store, que l'appelant pourrait muter
    return [...this.#byId.values()].map((e) => ({ ...e }));
  }

  async listPage(query: IWebhookListQuery): Promise<IPage<IWebhookEndpoint>> {
    assertPageQuery(query, "offset");
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    // On trie des RÉFÉRENCES (pas des copies) : seule la page retenue est clonée
    // → le coût mémoire reste celui d'une page, pas de la collection.
    const filtered = [...this.#byId.values()].filter((e) =>
      matchesWebhookQuery(e, query),
    );
    // LE tri en mémoire du framework, jamais un comparateur réécrit ici : un tri
    // local diverge du SQL sans que rien ne le signale, et un test vert en
    // mémoire ne dirait alors plus rien de la production. `pickOrder` borne à ce
    // que ce store DÉCLARE : sans lui, un appelant interne trierait ici sur un
    // champ que les backends SQL refusent — le contrat décrirait deux
    // comportements au lieu d'un.
    const order = pickOrder(
      query.order,
      this.sortableFields,
      WEBHOOK_DEFAULT_ORDER,
    );
    filtered.sort(
      compareByOrder(
        order,
        (e, field) => e[field as keyof IWebhookEndpoint] as unknown,
      ),
    );
    // oxlint-disable-next-line no-map-spread -- clonage DÉFENSIF de la page (cf ci-dessus) : muter l'élément exposerait l'entrée du store
    const items = filtered.slice(offset, offset + limit).map((e) => ({
      ...e,
      events: [...e.events],
      metadata: { ...e.metadata },
    }));
    return {
      items,
      total: query.withTotal === false ? undefined : filtered.length,
      limit,
      offset,
      hasNext: offset + items.length < filtered.length,
    };
  }

  async countEndpoints(query: IWebhookListQuery): Promise<number> {
    let n = 0;
    for (const e of this.#byId.values()) {
      if (matchesWebhookQuery(e, query)) n += 1;
    }
    return n;
  }
}
