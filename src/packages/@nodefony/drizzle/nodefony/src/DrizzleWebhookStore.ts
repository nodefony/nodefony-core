import type { Criteria, IRepository } from "@nodefony/orm-core";
import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
// Contrat en `import type` (effacé à la compilation) ; le VOCABULAIRE DE TRI,
// lui, est une valeur — et il s'importe au lieu de se recopier : deux listes de
// champs triables divergent en silence, et celle-ci garde en plus un `ORDER BY`
// concaténé. Le module tire déjà `@nodefony/security` au runtime par son point
// d'enregistrement (`registerStores.ts` → `registerWebhookStore`).
import { WEBHOOK_SORTABLE_FIELDS } from "@nodefony/security";
import type {
  IWebhookEndpoint,
  IWebhookListQuery,
  IWebhookStore,
  WebhookEndpointUpdate,
} from "@nodefony/security";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import type { DrizzleOrm } from "./orm-core/DrizzleOrm";
import type { DrizzleDb } from "./orm-core/DrizzleRepository";
import { countWebhookEndpoints, listWebhookIdsPage } from "./queryKit";
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
 * **Portable sauf le listing paginé** : le CRUD passe par le contrat
 * `IRepository` (transposable tel quel aux autres drivers) ; seuls `listPage` /
 * `countEndpoints` descendent au SQL natif via le `queryKit`, parce que le
 * filtre `event` cherche dans un tableau JSON — inexprimable en `Criteria`.
 *
 * **Mapping Row ↔ contrat** minimal : `IWebhookEndpoint` est déjà « plat tout
 * `| null` » ; seuls les champs JSON `events` (`readonly` → mutable) et
 * `metadata` sont copiés défensivement.
 */
export class DrizzleWebhookStore implements IWebhookStore {
  /**
   * {@inheritDoc IWebhookStore.sortableFields}
   *
   * Le moteur SQL trie sur n'importe laquelle de ces colonnes. Cette liste sert
   * DEUX fois : elle annonce la capacité au data plane, et elle borne le
   * `ORDER BY` construit par le queryKit (identifiant concaténé, non liable).
   */
  readonly sortableFields = WEBHOOK_SORTABLE_FIELDS;
  readonly #repo: IRepository<WebhookEndpointRow>;
  readonly #location: string | undefined;
  readonly #db: DrizzleDb | null;
  readonly #dialect: SqlDialect;

  /**
   * @param repo - repository de la table `webhook_endpoint`.
   * @param location - emplacement physique de la base (fichier SQLite) pour Studio
   *   ({@link DrizzleOrm.location}) ; `undefined` pour un backend réseau/`:memory:`.
   * @param db - handle Drizzle natif, requis par le seul listing paginé (filtre
   *   `event` = containment dans un tableau JSON, hors `Criteria` portable).
   *   `null` = store construit sans handle : `listPage` refuse plutôt que de
   *   charger toute la table en silence.
   * @param dialect - dialecte SQL du connecteur (route les requêtes du queryKit).
   */
  constructor(
    repo: IRepository<WebhookEndpointRow>,
    location?: string,
    db: DrizzleDb | null = null,
    dialect: SqlDialect = "sqlite",
  ) {
    this.#repo = repo;
    this.#location = location;
    this.#db = db;
    this.#dialect = dialect;
  }

  /**
   * Emplacement physique de la base (fichier SQLite) pour l'écran Studio « Stores »
   * — lu par `readStoreLocation`. `undefined` = backend réseau ou `:memory:`.
   */
  get location(): string | undefined {
    return this.#location;
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
      orm.location,
      orm.getNativeConnection<DrizzleDb>(),
      orm.dialect,
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
    // UPSERT atomique sur la PK `id` : 1 requête, pas de `findOne` d'existence
    // (dont l'`await` laisse deux écritures concurrentes du même endpoint voir
    // « absent » → deux INSERT → le perdant lève « UNIQUE constraint failed »).
    // `save` pose l'endpoint COMPLET → tout le reste est ré-appliqué au conflit.
    const { id, ...rest } = this.#toRow(endpoint);
    await this.#repo.upsert({ id }, rest as Partial<WebhookEndpointRow>);
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

  /**
   * Handle natif ou erreur explicite — un `listPage` qui retomberait sur un
   * `find({})` complet trahirait silencieusement la garantie du contrat
   * (« jamais plus d'une page en mémoire »).
   */
  #nativeDb(): DrizzleDb {
    if (this.#db === null) {
      throw new Error(
        "DrizzleWebhookStore: listing paginé indisponible (store construit " +
          "sans handle natif). Utiliser DrizzleWebhookStore.from(orm).",
      );
    }
    return this.#db;
  }

  /**
   * {@inheritDoc IWebhookStore.listPage}
   *
   * Chemin NATIF (queryKit) : le filtre `event` cherche dans un tableau JSON —
   * `json_each` (sqlite) / `@>` jsonb (postgres) / `JSON_CONTAINS` (mysql), non
   * exprimable en `Criteria` portable. On sélectionne les `id` de la page (SQL
   * pur, aucune ligne matérialisée), puis on recharge la page typée en 1
   * requête `IN (...)` — coût O(page), jamais O(table).
   */
  async listPage(query: IWebhookListQuery): Promise<IPage<IWebhookEndpoint>> {
    assertPageQuery(query, "offset");
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const db = this.#nativeDb();
    const filters = {
      enabled: query.enabled,
      event: query.event,
      failing: query.failing,
      q: query.q,
    };
    const { ids, hasNext } = await listWebhookIdsPage(
      db,
      this.#dialect,
      filters,
      {
        limit,
        offset,
        ...(query.order ? { order: query.order } : {}),
        // L'allowlist repasse ICI : le nom de colonne est concaténé dans le
        // `ORDER BY` (aucun paramètre ne lie un identifiant). Le data plane a
        // déjà refusé l'inconnu en 400 ; ce second filtre existe pour qu'un
        // appelant interne qui l'oublierait ne puisse pas ouvrir une injection.
        sortable: this.sortableFields,
      },
    );
    const total =
      query.withTotal === false
        ? undefined
        : await countWebhookEndpoints(db, this.#dialect, filters);
    if (ids.length === 0) {
      return { items: [], total, limit, offset, hasNext };
    }
    // `IN (...)` ne garantit PAS l'ordre → on ré-ordonne selon les ids du SQL.
    const rows = await this.#repo.find({
      id: { $in: ids },
    } as unknown as Criteria<WebhookEndpointRow>);
    const byId = new Map(rows.map((row) => [row.id, this.#toEndpoint(row)]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((e): e is IWebhookEndpoint => e !== undefined);
    return { items, total, limit, offset, hasNext };
  }

  /** {@inheritDoc IWebhookStore.countEndpoints} */
  countEndpoints(query: IWebhookListQuery): Promise<number> {
    return countWebhookEndpoints(this.#nativeDb(), this.#dialect, {
      enabled: query.enabled,
      event: query.event,
      failing: query.failing,
      q: query.q,
    });
  }
}
