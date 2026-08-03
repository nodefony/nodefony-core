import type {
  Criteria,
  IRepository,
  ITransaction,
  RepositoryReadOptions,
} from "@nodefony/orm-core";
import {
  BaseUser,
  USER_SORTABLE_FIELDS,
  USER_DEFAULT_ORDER,
} from "@nodefony/user";
import type {
  IPasswordAuthenticatedUser,
  IUserListQuery,
  IUserRepository,
} from "@nodefony/user";
import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
import type { DrizzleDb } from "./orm-core/DrizzleRepository";
import type { DrizzleOrm } from "./orm-core/DrizzleOrm";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  countUsers,
  findUserIdBySocialProvider,
  listUserIdsPage,
} from "./queryKit";
import type { UserRow } from "../entity/userTable";

/** Critère typé sur la ligne `User` (sous-ensemble compatible avec le contrat). */
type UserCriteria = Criteria<UserRow>;

/**
 * Adapter Drizzle du contrat {@link IUserRepository} — implémentation SQL **par
 * défaut** de la persistance utilisateur (P5.9).
 *
 * Décore le repository portable générique (`IRepository<UserRow>` de
 * {@link DrizzleOrm}) de deux responsabilités propres à l'utilisateur :
 * - **mapping ligne ↔ `BaseUser`** : les consommateurs reçoivent un objet
 *   porteur du comportement (`hasRole`/`isActive`/`isLocked`), pas une ligne nue ;
 * - **finders métier** : `findByIdentifier` (lookup unique) et
 *   `findBySocialProvider` (recherche dans le JSON `socialProviders`, routée
 *   par dialecte via le queryKit — pattern Shadow User OAuth).
 *
 * Le credential (`password`) transite par cette frontière — c'est attendu : le
 * repository **est** la frontière de persistance du hash (cf `IUserRepository`).
 */
export class DrizzleUserRepository implements IUserRepository {
  /**
   * Même vocabulaire public que les autres repositories — ici le tri part
   * dans la requête, où il ne coûte qu'un index.
   */
  readonly sortableFields = USER_SORTABLE_FIELDS;

  readonly #base: IRepository<UserRow>;
  readonly #db: DrizzleDb;
  readonly #dialect: SqlDialect;

  /**
   * @param base - repository portable sur la table `User` (CRUD + criteria).
   * @param db - handle Drizzle (racine ou transaction) pour les requêtes JSON brutes.
   * @param dialect - dialecte SQL du connecteur (route les requêtes du queryKit).
   */
  constructor(
    base: IRepository<UserRow>,
    db: DrizzleDb,
    dialect: SqlDialect = "sqlite",
  ) {
    this.#base = base;
    this.#db = db;
    this.#dialect = dialect;
  }

  /**
   * Construit le repository utilisateur depuis un {@link DrizzleOrm} connecté.
   * L'entité `User` doit avoir été enregistrée (cf `registerUserEntity`) avant
   * `orm.connect()` — sur la variante de table du dialecte de l'ORM.
   *
   * @param orm - ORM Drizzle connecté.
   * @returns le repository utilisateur prêt à l'emploi.
   */
  static from(orm: DrizzleOrm): DrizzleUserRepository {
    return new DrizzleUserRepository(
      orm.getRepository<UserRow>("User"),
      orm.getNativeConnection<DrizzleDb>(),
      orm.dialect,
    );
  }

  /** Mappe une ligne plate en {@link BaseUser} (comportement + champs anti-migration). */
  #toUser(row: UserRow): IPasswordAuthenticatedUser {
    const user = new BaseUser({
      id: row.id,
      identifier: row.identifier,
      roles: row.roles,
      password: row.password,
      enabled: row.enabled,
      locked: row.locked,
      currentRole: row.currentRole,
      socialProviders: row.socialProviders,
      metadata: row.metadata,
    });
    // Timestamps d'ENTITÉ (colonnes `userTable`, hors contrat strict `IUser`) :
    // attachés sur l'objet retourné pour que les DTO admin les exposent — c'est
    // exactement la lecture défensive prévue par `toUserSummary` (« présents sur
    // l'entité ORM, absents du contrat »). Sans ça, createdAt/updatedAt = null.
    return Object.assign(user, {
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async find(
    criteria?: Criteria<IPasswordAuthenticatedUser>,
    options?: RepositoryReadOptions,
  ): Promise<IPasswordAuthenticatedUser[]> {
    const rows = await this.#base.find(
      criteria as unknown as UserCriteria,
      options,
    );
    return rows.map((row) => this.#toUser(row));
  }

  async findOne(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    options?: RepositoryReadOptions,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const row = await this.#base.findOne(
      criteria as unknown as UserCriteria,
      options,
    );
    return row ? this.#toUser(row) : null;
  }

  async create(
    data: Partial<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser> {
    const row = await this.#base.create(data as Partial<UserRow>);
    return this.#toUser(row);
  }

  async updateOne(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: Partial<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const row = await this.#base.updateOne(
      criteria as unknown as UserCriteria,
      data as Partial<UserRow>,
    );
    return row ? this.#toUser(row) : null;
  }

  async upsert(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    update: Partial<IPasswordAuthenticatedUser>,
    insertOnly?: Partial<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser> {
    const row = await this.#base.upsert(
      criteria as unknown as UserCriteria,
      update as Partial<UserRow>,
      insertOnly as Partial<UserRow> | undefined,
    );
    return this.#toUser(row);
  }

  async createMany(
    data: Partial<IPasswordAuthenticatedUser>[],
  ): Promise<IPasswordAuthenticatedUser[]> {
    const rows = await this.#base.createMany(data as Partial<UserRow>[]);
    return rows.map((row) => this.#toUser(row));
  }

  exists(criteria: Criteria<IPasswordAuthenticatedUser>): Promise<boolean> {
    return this.#base.exists(criteria as unknown as UserCriteria);
  }

  deleteOne(criteria: Criteria<IPasswordAuthenticatedUser>): Promise<boolean> {
    return this.#base.deleteOne(criteria as unknown as UserCriteria);
  }

  async findOneAndDelete(
    criteria: Criteria<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const row = await this.#base.findOneAndDelete(
      criteria as unknown as UserCriteria,
    );
    return row ? this.#toUser(row) : null;
  }

  async increment(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    changes: Partial<Record<keyof IPasswordAuthenticatedUser, number>>,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const row = await this.#base.increment(
      criteria as unknown as UserCriteria,
      changes as Partial<Record<keyof UserRow, number>>,
    );
    return row ? this.#toUser(row) : null;
  }

  updateMany(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: Partial<IPasswordAuthenticatedUser>,
  ): Promise<number> {
    return this.#base.updateMany(
      criteria as unknown as UserCriteria,
      data as Partial<UserRow>,
    );
  }

  delete(criteria: Criteria<IPasswordAuthenticatedUser>): Promise<number> {
    return this.#base.delete(criteria as unknown as UserCriteria);
  }

  count(criteria?: Criteria<IPasswordAuthenticatedUser>): Promise<number> {
    return this.#base.count(criteria as unknown as UserCriteria);
  }

  withTransaction(tx: ITransaction): IUserRepository {
    return new DrizzleUserRepository(
      this.#base.withTransaction(tx),
      tx.getNative<DrizzleDb>(),
      this.#dialect,
    );
  }

  findByIdentifier(
    identifier: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    return this.findOne({
      identifier,
    } as Criteria<IPasswordAuthenticatedUser>);
  }

  /**
   * Recherche par compte externe lié — cherche dans le JSON `socialProviders`
   * via le queryKit (forme native du dialecte : `json_each` SQLite / `@>`
   * jsonb PG, 1 requête), récupère l'`id`, puis recharge par le chemin typé
   * (parsing JSON/booléens cohérent). `null` si aucun lien.
   */
  async findBySocialProvider(
    provider: string,
    providerId: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const id = await findUserIdBySocialProvider(
      this.#db,
      this.#dialect,
      provider,
      providerId,
    );
    if (id === null) {
      return null;
    }
    return this.findOne({ id } as Criteria<IPasswordAuthenticatedUser>);
  }

  /**
   * {@inheritDoc IUserRepository.listPage}
   *
   * SQL natif (queryKit, routé par dialecte) → **uniquement les `id`** de la page
   * (containment de rôle + `LIKE` insensible casse non exprimables par le query
   * builder portable), puis rechargement des lignes complètes par le chemin typé
   * (`find({ id: $in })`, parsing JSON/booléens cohérent), **ré-ordonnées** selon
   * le tri SQL. Jamais plus d'une page matérialisée.
   */
  async listPage(
    query: IUserListQuery,
  ): Promise<IPage<IPasswordAuthenticatedUser>> {
    assertPageQuery(query, "offset");
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const filters = { role: query.role, enabled: query.enabled, q: query.q };
    const order = query.order?.length ? query.order : USER_DEFAULT_ORDER;

    const { ids, hasNext } = await listUserIdsPage(
      this.#db,
      this.#dialect,
      filters,
      {
        limit,
        offset,
        order,
      },
    );
    const total =
      query.withTotal === false
        ? undefined
        : await countUsers(this.#db, this.#dialect, filters);

    if (ids.length === 0) {
      return { items: [], total, limit, offset, hasNext };
    }
    // Recharge typée en 1 requête, puis ré-ordonne selon l'ordre du tri SQL
    // (le `IN (...)` ne garantit pas l'ordre) — coût O(page), borné par `limit`.
    const rows = await this.#base.find({
      id: { $in: ids },
    } as unknown as UserCriteria);
    const byId = new Map(rows.map((row) => [row.id, this.#toUser(row)]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((u): u is IPasswordAuthenticatedUser => u !== undefined);
    return { items, total, limit, offset, hasNext };
  }

  /** {@inheritDoc IUserRepository.countActiveAdmins} */
  countActiveAdmins(adminRole: string): Promise<number> {
    return countUsers(this.#db, this.#dialect, {
      enabled: true,
      role: adminRole,
    });
  }
}
