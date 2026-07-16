import type { IRepository } from "@nodefony/orm-core";
// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'ORM vers `@nodefony/security`. L'application câble le
// store via `registerWebhookStore("mongoose", …)`.
import type {
  IWebhookEndpoint,
  IWebhookStore,
  WebhookEndpointUpdate,
} from "@nodefony/security";
import type { MongooseOrm } from "./orm-core/index";
import {
  WEBHOOK_ENDPOINT_ENTITY,
  type WebhookEndpointRow,
} from "../entity/webhookEndpointEntity";

/**
 * Store d'endpoints webhook **Mongoose** (NoSQL) — implémentation d'
 * {@link IWebhookStore} au-dessus d'un unique repository `@nodefony/orm-core`
 * (`webhook_endpoint`). Pendant documentaire de `DrizzleWebhookStore` ; registre
 * DURABLE des endpoints (survit au redémarrage, ≠ `MemoryWebhookStore`).
 *
 * **Approche B** : `@nodefony/security` n'est connu qu'en `import type` (0 dép
 * runtime). C'est l'application qui enregistre la fabrique
 * (`registerWebhookStore("mongoose", …)`) et l'entité
 * (`registerWebhookEndpointEntity(orm)` avant `orm.connect()`).
 *
 * **Spécificité Mongo** : la clé naturelle (`wh_<random>`) est portée par `_id`
 * (cf {@link webhookEndpointSchema}). Le contrat traduit `{ id }` → `{ _id }`,
 * donc les lookups passent par `id` ; les **écritures** posent explicitement
 * `_id` (Mongo ne génère pas notre id). Mapping `Row ↔ IWebhookEndpoint` :
 * `IWebhookEndpoint` est déjà « plat tout `| null` », seuls les champs JSON
 * `events`/`metadata` sont copiés défensivement.
 */
export class MongooseWebhookStore implements IWebhookStore {
  readonly #repo: IRepository<WebhookEndpointRow>;

  /** @param repo - repository de la collection `webhook_endpoint`. */
  constructor(repo: IRepository<WebhookEndpointRow>) {
    this.#repo = repo;
  }

  /**
   * Construit le store depuis un {@link MongooseOrm} connecté. L'entité
   * (`registerWebhookEndpointEntity`) doit avoir été enregistrée **avant**
   * `connect()`.
   *
   * @param orm - ORM Mongoose connecté hébergeant la collection du store.
   */
  static from(orm: MongooseOrm): MongooseWebhookStore {
    return new MongooseWebhookStore(
      orm.getRepository<WebhookEndpointRow>(WEBHOOK_ENDPOINT_ENTITY),
    );
  }

  /** Identité réelle d'un endpoint : `_id` fait foi, le virtuel `id` en repli. */
  #idOf(row: WebhookEndpointRow): string {
    return (row as { _id?: string })._id ?? row.id;
  }

  /** Row plate → endpoint du contrat (sans `_id`/`__v` ; `events` en `readonly`). */
  #toEndpoint(row: WebhookEndpointRow): IWebhookEndpoint {
    return {
      id: this.#idOf(row),
      url: row.url,
      secretEnc: row.secretEnc,
      events: row.events,
      enabled: row.enabled,
      description: row.description,
      tenantId: row.tenantId,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastDeliveryAt: row.lastDeliveryAt,
      lastDeliveryStatus: row.lastDeliveryStatus,
      lastDeliveryError: row.lastDeliveryError,
      failureCount: row.failureCount,
      metadata: row.metadata,
    };
  }

  async save(endpoint: IWebhookEndpoint): Promise<void> {
    const data = {
      url: endpoint.url,
      secretEnc: endpoint.secretEnc,
      events: [...endpoint.events],
      enabled: endpoint.enabled,
      description: endpoint.description,
      tenantId: endpoint.tenantId,
      createdBy: endpoint.createdBy,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
      lastDeliveryAt: endpoint.lastDeliveryAt,
      lastDeliveryStatus: endpoint.lastDeliveryStatus,
      lastDeliveryError: endpoint.lastDeliveryError,
      failureCount: endpoint.failureCount,
      metadata: { ...endpoint.metadata },
    };
    // UPSERT atomique sur la PK : 1 round-trip, pas de `findOne` d'existence
    // (dont l'`await` laisse deux écritures concurrentes du même endpoint voir
    // « absent » → deux insert → E11000 pour le perdant). `id` en critère suffit
    // à poser `_id` (Mongo ajoute les égalités du filtre au document inséré).
    // Parité stricte avec l'adapter Drizzle.
    await this.#repo.upsert({ id: endpoint.id }, data);
  }

  async findById(id: string): Promise<IWebhookEndpoint | null> {
    const row = await this.#repo.findOne({ id });
    return row ? this.#toEndpoint(row) : null;
  }

  async update(id: string, patch: WebhookEndpointUpdate): Promise<void> {
    // updateOne est un no-op (renvoie null) si l'id est inconnu → conforme au contrat.
    const { events, metadata, ...rest } = patch;
    const data: Partial<WebhookEndpointRow> = { ...rest };
    if (events !== undefined) data.events = [...events];
    if (metadata !== undefined) data.metadata = { ...metadata };
    await this.#repo.updateOne({ id }, data);
  }

  async delete(id: string): Promise<void> {
    await this.#repo.delete({ id });
  }

  async listAll(): Promise<IWebhookEndpoint[]> {
    const rows = await this.#repo.find({});
    return rows.map((row) => this.#toEndpoint(row));
  }
}
