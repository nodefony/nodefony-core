import { paginate, type Criteria, type IRepository } from "@nodefony/orm-core";
import type { IPage } from "nodefony";
// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'ORM vers `@nodefony/security`. L'application câble le
// store via `registerWebAuthnStore("mongoose", …)`.
import type {
  IWebAuthnCredential,
  IWebAuthnCredentialStore,
  IWebAuthnCredentialSummary,
  IWebAuthnListQuery,
  WebAuthnAuthUpdate,
} from "@nodefony/security";
import type { MongooseOrm } from "./orm-core/index";
import {
  WEBAUTHN_CREDENTIAL_ENTITY,
  type WebAuthnCredentialRow,
} from "../entity/webAuthnCredentialEntity";

/**
 * Store de credentials WebAuthn **Mongoose** (NoSQL) — implémentation d'
 * {@link IWebAuthnCredentialStore} au-dessus d'un unique repository
 * `@nodefony/orm-core` (`webauthn_credential`). Pendant documentaire de
 * `DrizzleWebAuthnCredentialStore`.
 *
 * **Approche B** : `@nodefony/security` n'est connu qu'en `import type` (0 dép
 * runtime). C'est l'application qui enregistre la fabrique
 * (`registerWebAuthnStore("mongoose", …)`) et l'entité
 * (`registerWebAuthnCredentialEntity(orm)` avant `orm.connect()`).
 *
 * **Spécificité Mongo** : la clé naturelle (credentialId) est portée par `_id`
 * (cf {@link webAuthnCredentialSchema}). Le contrat traduit `{ id }` → `{ _id }`,
 * donc les lookups passent par le champ `id` ; les **écritures** posent
 * explicitement `_id` (Mongo ne génère pas notre credentialId). Le mapping
 * `Row ↔ IWebAuthnCredential` normalise `nickname` (`null` → omis).
 */
export class MongooseWebAuthnCredentialStore implements IWebAuthnCredentialStore {
  readonly #repo: IRepository<WebAuthnCredentialRow>;

  /** @param repo - repository de la collection `webauthn_credential`. */
  constructor(repo: IRepository<WebAuthnCredentialRow>) {
    this.#repo = repo;
  }

  /**
   * Construit le store depuis un {@link MongooseOrm} connecté. L'entité
   * (`registerWebAuthnCredentialEntity`) doit avoir été enregistrée **avant**
   * `connect()`.
   *
   * @param orm - ORM Mongoose connecté hébergeant la collection du store.
   */
  static from(orm: MongooseOrm): MongooseWebAuthnCredentialStore {
    return new MongooseWebAuthnCredentialStore(
      orm.getRepository<WebAuthnCredentialRow>(WEBAUTHN_CREDENTIAL_ENTITY),
    );
  }

  /** Identité réelle d'un credential : `_id` fait foi, le virtuel `id` en repli. */
  #idOf(row: WebAuthnCredentialRow): string {
    return (row as { _id?: string })._id ?? row.id;
  }

  /** Row plate → credential du contrat (`nickname?` omis si `null`/absent). */
  #toCredential(row: WebAuthnCredentialRow): IWebAuthnCredential {
    return {
      id: this.#idOf(row),
      userId: row.userId,
      publicKey: row.publicKey,
      signCount: row.signCount,
      transports: row.transports,
      backupEligible: row.backupEligible,
      backupState: row.backupState,
      uvInitialized: row.uvInitialized,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      ...(row.nickname != null ? { nickname: row.nickname } : {}),
    };
  }

  async findById(credentialId: string): Promise<IWebAuthnCredential | null> {
    const row = await this.#repo.findOne({ id: credentialId });
    return row ? this.#toCredential(row) : null;
  }

  async findByUser(userId: string): Promise<IWebAuthnCredential[]> {
    const rows = await this.#repo.find({ userId });
    return rows.map((row) => this.#toCredential(row));
  }

  /** `countDocuments` natif — jamais un `find().length` (le plafond ne charge rien). */
  countByUser(userId: string): Promise<number> {
    return this.#repo.count({ userId });
  }

  async save(credential: IWebAuthnCredential): Promise<void> {
    const data = {
      userId: credential.userId,
      publicKey: credential.publicKey,
      signCount: credential.signCount,
      transports: [...credential.transports],
      backupEligible: credential.backupEligible,
      backupState: credential.backupState,
      uvInitialized: credential.uvInitialized,
      nickname: credential.nickname ?? null,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt,
    };
    // UPSERT atomique sur la PK : 1 round-trip, pas de `findOne` d'existence
    // (dont l'`await` laisse deux enregistrements concurrents de la même passkey
    // voir « absent » → deux insert → E11000 pour le perdant). `id` en critère
    // suffit à poser `_id` (Mongo ajoute les égalités du filtre au document
    // inséré). Parité stricte avec l'adapter Drizzle.
    await this.#repo.upsert({ id: credential.id }, data);
  }

  async update(credentialId: string, patch: WebAuthnAuthUpdate): Promise<void> {
    // updateOne est un no-op (renvoie null) si l'id est inconnu → conforme au contrat.
    await this.#repo.updateOne(
      { id: credentialId },
      {
        signCount: patch.signCount,
        backupState: patch.backupState,
        uvInitialized: patch.uvInitialized,
        lastUsedAt: patch.lastUsedAt,
      },
    );
  }

  async delete(credentialId: string): Promise<void> {
    await this.#repo.delete({ id: credentialId });
  }

  /**
   * Critères du listing admin. `q` = PRÉFIXE d'`userId` (`$like 'x%'`, traduit en
   * ancrage `^` côté Mongo), jamais une recherche non ancrée.
   */
  #listCriteria(query: IWebAuthnListQuery): Criteria<WebAuthnCredentialRow> {
    const criteria: Record<string, unknown> = {};
    if (query.userId !== undefined) {
      criteria.userId = query.userId;
    } else if (query.q !== undefined && query.q.length > 0) {
      criteria.userId = {
        $like: `${query.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`,
      };
    }
    if (query.backedUp !== undefined) {
      criteria.backupState = query.backedUp;
    }
    return criteria as unknown as Criteria<WebAuthnCredentialRow>;
  }

  /**
   * {@inheritDoc IWebAuthnCredentialStore.listPage}
   *
   * Même helper `paginate()` que l'adapter SQL (`skip`/`limit` + `countDocuments`).
   * La projection retire `publicKey` — elle ne franchit jamais la frontière du store.
   * ⚠️ L'identité vient de `_id` (`#idOf`), pas du champ `id` de la row.
   */
  async listPage(
    query: IWebAuthnListQuery,
  ): Promise<IPage<IWebAuthnCredentialSummary>> {
    const page = await paginate(this.#repo, {
      criteria: this.#listCriteria(query),
      limit: query.limit,
      offset: query.offset,
      withTotal: query.withTotal,
      order: [
        ["createdAt", "DESC"],
        ["_id", "ASC"], // tiebreaker → offset déterministe (la PK Mongo)
      ],
    });
    return {
      ...page,
      items: page.items.map((row) => ({
        id: this.#idOf(row),
        userId: row.userId,
        transports: row.transports,
        backupEligible: row.backupEligible,
        backupState: row.backupState,
        uvInitialized: row.uvInitialized,
        signCount: row.signCount,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        ...(row.nickname != null ? { nickname: row.nickname } : {}),
      })),
    };
  }

  /** {@inheritDoc IWebAuthnCredentialStore.countCredentials} */
  countCredentials(query: IWebAuthnListQuery): Promise<number> {
    return this.#repo.count(this.#listCriteria(query));
  }
}
