import type { IRepository } from "@nodefony/orm-core";
import type { IPage } from "nodefony";
import { assertPageQuery, escapeRegExp } from "nodefony";
// Contrat en `import type` (effacé à la compilation) ; le VOCABULAIRE DE TRI,
// lui, est une valeur — et il s'importe au lieu de se recopier : deux listes de
// champs triables divergent en silence. Le module tire déjà `@nodefony/security`
// au runtime par son point d'enregistrement (`registerWebhookStore`).
import {
  WEBHOOK_DEFAULT_ORDER,
  WEBHOOK_SORTABLE_FIELDS,
} from "@nodefony/security";
import { mongoOrder, toMongoSort } from "./mongoOrder";
import type {
  IWebhookEndpoint,
  IWebhookListQuery,
  IWebhookStore,
  WebhookEndpointUpdate,
} from "@nodefony/security";
import type { Connection, Model } from "mongoose";
import type { MongooseOrm } from "./orm-core/index";

/** Modèle Mongoose à document libre (boundary — comme `MongooseRepository`). */
type LooseModel = Model<Record<string, unknown>>;
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
  /**
   * {@inheritDoc IWebhookStore.sortableFields}
   *
   * Capacité pleine : le vocabulaire public entier est trié par Mongo, `id`
   * compris — traduit en `_id` au moment de la requête.
   */
  readonly sortableFields = WEBHOOK_SORTABLE_FIELDS;
  readonly #repo: IRepository<WebhookEndpointRow>;
  readonly #model: LooseModel | null;

  /**
   * @param repo - repository de la collection `webhook_endpoint`.
   * @param model - modèle Mongoose natif, requis par le seul listing paginé
   *   (recherche `q` = `$or` sur deux champs, hors `Criteria` AND-only).
   *   `null` = `listPage` refuse plutôt que de tout charger en silence.
   */
  constructor(
    repo: IRepository<WebhookEndpointRow>,
    model: LooseModel | null = null,
  ) {
    this.#repo = repo;
    this.#model = model;
  }

  /**
   * Construit le store depuis un {@link MongooseOrm} connecté. L'entité
   * (`registerWebhookEndpointEntity`) doit avoir été enregistrée **avant**
   * `connect()`.
   *
   * @param orm - ORM Mongoose connecté hébergeant la collection du store.
   */
  static from(orm: MongooseOrm): MongooseWebhookStore {
    const connection = orm.getNativeConnection<Connection>();
    return new MongooseWebhookStore(
      orm.getRepository<WebhookEndpointRow>(WEBHOOK_ENDPOINT_ENTITY),
      connection.model<Record<string, unknown>>(WEBHOOK_ENDPOINT_ENTITY),
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

  /**
   * Modèle natif ou erreur explicite — un `listPage` qui retomberait sur un
   * `find({})` complet trahirait silencieusement la garantie du contrat.
   */
  #nativeModel(): LooseModel {
    if (this.#model === null) {
      throw new Error(
        "MongooseWebhookStore: listing paginé indisponible (store construit " +
          "sans modèle natif). Utiliser MongooseWebhookStore.from(orm).",
      );
    }
    return this.#model;
  }

  /**
   * Filtre Mongo des filtres du listing. `events: <event>` = **containment de
   * tableau natif** (Mongo matche un scalaire contre chaque élément) ; `q` =
   * `$or` de deux `$regex/i` — le `$or` sort du `Criteria` AND-only, d'où la
   * query native.
   */
  #listFilter(query: IWebhookListQuery): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (query.enabled !== undefined) filter.enabled = query.enabled;
    if (query.failing !== undefined) {
      // « En échec » = au moins un échec consécutif courant. La forme Mongo est
      // une comparaison, pas un booléen stocké : `failureCount` est un compteur.
      filter.failureCount = query.failing ? { $gt: 0 } : 0;
    }
    if (query.event !== undefined) filter.events = query.event;
    if (query.q !== undefined && query.q.length > 0) {
      // Échappe les métacaractères : une recherche utilisateur n'est PAS une regex.
      const needle = escapeRegExp(query.q);
      filter.$or = [
        { url: { $regex: needle, $options: "i" } },
        { description: { $regex: needle, $options: "i" } },
      ];
    }
    return filter;
  }

  /**
   * {@inheritDoc IWebhookStore.listPage}
   *
   * Query native : `find(filter).sort(…).skip().limit(limit+1)` — une page,
   * jamais la collection. Le `limit + 1` donne `hasNext` sans compter.
   *
   * Le tri demandé est **traduit** avant de descendre : au repos, l'endpoint n'a
   * pas de champ `id` (l'identifiant EST le `_id`), et Mongo ne se plaint pas
   * d'un tri sur un champ absent — il rend un ordre arbitraire. Sans traduction,
   * un `?order=id` serait donc inerte ici et correct partout ailleurs. À défaut
   * d'`order`, l'ordre par défaut `createdAt DESC, _id ASC` reste déterministe.
   */
  async listPage(query: IWebhookListQuery): Promise<IPage<IWebhookEndpoint>> {
    assertPageQuery(query, "offset");
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const model = this.#nativeModel();
    const filter = this.#listFilter(query);
    // Borné à ce que ce store DÉCLARE, PUIS traduit dans le schéma Mongo — les
    // deux gestes, dans cet ordre, sont portés par `mongoOrder`.
    const order = mongoOrder(
      query.order,
      this.sortableFields,
      WEBHOOK_DEFAULT_ORDER,
    );
    const docs = await model
      .find(filter)
      .sort(toMongoSort(order))
      .skip(offset)
      .limit(limit + 1)
      .exec();
    const hasNext = docs.length > limit;
    const page = hasNext ? docs.slice(0, limit) : docs;
    const items = page.map((doc) =>
      this.#toEndpoint(
        doc.toObject({ virtuals: true }) as unknown as WebhookEndpointRow,
      ),
    );
    const total =
      query.withTotal === false
        ? undefined
        : await model.countDocuments(filter).exec();
    return { items, total, limit, offset, hasNext };
  }

  /** {@inheritDoc IWebhookStore.countEndpoints} */
  async countEndpoints(query: IWebhookListQuery): Promise<number> {
    return this.#nativeModel().countDocuments(this.#listFilter(query)).exec();
  }
}
