import type { IRepository } from "@nodefony/orm-core";
// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'ORM vers `@nodefony/security`. L'application câble le
// store via `registerWebhookStore("drizzle", …)` ; le module drizzle reste pur.
import type {
  IWebhookEndpoint,
  IWebhookStore,
  WebhookEndpointUpdate,
} from "@nodefony/security";
import type { DrizzleOrm } from "./orm-core/DrizzleOrm";
import {
  WEBHOOK_ENDPOINT_ENTITY,
  type WebhookEndpointRow,
} from "../entity/webhookEndpointEntity";

/**
 * Store d'endpoints webhook **Drizzle** (driver `better-sqlite3`) —
 * implémentation SQL d'{@link IWebhookStore} au-dessus d'un unique repository
 * `@nodefony/orm-core` (`webhook_endpoint`). Persistance DURABLE du registre
 * (les endpoints survivent au redémarrage, contrairement à `MemoryWebhookStore`).
 *
 * **Approche B** : l'ORM ne connaît `@nodefony/security` qu'en `import type` → 0
 * dépendance runtime. C'est l'application qui enregistre la fabrique
 * (`registerWebhookStore("drizzle", …)`) et l'entité
 * (`registerWebhookEndpointEntity(orm)` avant `orm.connect()`).
 *
 * **100 % portable** (aucun SQL natif) — toutes les opérations passent par le
 * contrat `IRepository`, donc le code se transpose tel quel aux autres drivers.
 *
 * **Mapping Row ↔ contrat** minimal : `IWebhookEndpoint` est déjà « plat tout
 * `| null` » ; seuls les champs JSON `events` (`readonly` → mutable) et
 * `metadata` sont copiés défensivement.
 */
export class DrizzleWebhookStore implements IWebhookStore {
  readonly #repo: IRepository<WebhookEndpointRow>;

  /** @param repo - repository de la table `webhook_endpoint`. */
  constructor(repo: IRepository<WebhookEndpointRow>) {
    this.#repo = repo;
  }

  /**
   * Construit le store depuis un {@link DrizzleOrm} connecté. L'entité
   * (`registerWebhookEndpointEntity`) doit avoir été enregistrée **avant**
   * `orm.connect()`.
   *
   * @param orm - ORM Drizzle connecté hébergeant la table du store.
   */
  static from(orm: DrizzleOrm): DrizzleWebhookStore {
    return new DrizzleWebhookStore(
      orm.getRepository<WebhookEndpointRow>(WEBHOOK_ENDPOINT_ENTITY),
    );
  }

  /** Row plate → endpoint du contrat (`events` mutable accepté en `readonly`). */
  #toEndpoint(row: WebhookEndpointRow): IWebhookEndpoint {
    return { ...row };
  }

  /** Endpoint du contrat → row plate (copie défensive des champs JSON). */
  #toRow(e: IWebhookEndpoint): WebhookEndpointRow {
    return { ...e, events: [...e.events], metadata: { ...e.metadata } };
  }

  async save(endpoint: IWebhookEndpoint): Promise<void> {
    const row = this.#toRow(endpoint);
    const existing = await this.#repo.findOne({ id: endpoint.id });
    if (existing) {
      await this.#repo.updateOne({ id: endpoint.id }, row);
    } else {
      await this.#repo.create(row);
    }
  }

  async findById(id: string): Promise<IWebhookEndpoint | null> {
    const row = await this.#repo.findOne({ id });
    return row ? this.#toEndpoint(row) : null;
  }

  async update(id: string, patch: WebhookEndpointUpdate): Promise<void> {
    // updateOne est un no-op (renvoie null) si l'id est inconnu → conforme au contrat.
    const { events, metadata, ...rest } = patch;
    const row: Partial<WebhookEndpointRow> = { ...rest };
    if (events !== undefined) row.events = [...events];
    if (metadata !== undefined) row.metadata = { ...metadata };
    await this.#repo.updateOne({ id }, row);
  }

  async delete(id: string): Promise<void> {
    await this.#repo.delete({ id });
  }

  async listAll(): Promise<IWebhookEndpoint[]> {
    const rows = await this.#repo.find({});
    return rows.map((row) => this.#toEndpoint(row));
  }
}
