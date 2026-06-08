import type { ClientSession, Connection, Model } from "mongoose";
import { BaseUser } from "@nodefony/user";
import type {
  IPasswordAuthenticatedUser,
  IUserRepository,
} from "@nodefony/user";
import type {
  Criteria,
  IRepository,
  ITransaction,
  RepositoryReadOptions,
} from "@nodefony/orm-core";
import type { MongooseOrm } from "./orm-core/MongooseOrm";
import type { UserRow } from "../entity/userEntity";

/** Critère typé sur la ligne `User`. */
type UserCriteria = Criteria<UserRow>;
/** Modèle Mongoose à document libre (boundary — comme `MongooseRepository`). */
type LooseModel = Model<Record<string, unknown>>;

/**
 * Adapter Mongoose du contrat {@link IUserRepository} — persistance NoSQL de
 * l'utilisateur (P5.8), pendant documentaire de `DrizzleUserRepository` (P5.9).
 *
 * Décore le repository portable (`IRepository<UserRow>` de {@link MongooseOrm}) de
 * deux responsabilités propres à l'utilisateur :
 * - **mapping document ↔ `BaseUser`** : les consommateurs reçoivent le comportement
 *   (`hasRole`/`isActive`/`isLocked`), pas un document nu ;
 * - **finders métier** : `findByIdentifier` (lookup unique) et
 *   `findBySocialProvider` (scan du tableau `socialProviders` via `$elemMatch` —
 *   équivalent Mongo du `json_each` SQL de Drizzle, pattern Shadow User OAuth).
 *
 * Le credential (`password`) transite par cette frontière — attendu : le repository
 * **est** la frontière de persistance du hash (cf `IUserRepository`).
 */
export class MongooseUserRepository implements IUserRepository {
  readonly #base: IRepository<UserRow>;
  readonly #model: LooseModel;
  readonly #session: ClientSession | null;

  /**
   * @param base - repository portable sur l'entité `User` (CRUD + criteria).
   * @param model - modèle Mongoose natif `User` (pour le scan `$elemMatch`).
   * @param session - session transactionnelle liée aux ops natives, ou `null`.
   */
  constructor(
    base: IRepository<UserRow>,
    model: LooseModel,
    session: ClientSession | null = null,
  ) {
    this.#base = base;
    this.#model = model;
    this.#session = session;
  }

  /**
   * Construit le repository utilisateur depuis un {@link MongooseOrm} connecté.
   * L'entité `User` doit avoir été enregistrée (cf `registerUserEntity`) **avant**
   * `orm.connect()` (le modèle est compilé au connect).
   *
   * @param orm - ORM Mongoose connecté.
   * @returns le repository utilisateur prêt à l'emploi.
   */
  static from(orm: MongooseOrm): MongooseUserRepository {
    const connection = orm.getNativeConnection<Connection>();
    return new MongooseUserRepository(
      orm.getRepository<UserRow>("User"),
      connection.model<Record<string, unknown>>("User"),
    );
  }

  /** Mappe une ligne plate en `BaseUser` (comportement + champs anti-migration). */
  #toUser(row: UserRow): IPasswordAuthenticatedUser {
    return new BaseUser({
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
    return new MongooseUserRepository(
      this.#base.withTransaction(tx),
      this.#model,
      tx.getNative<ClientSession>(),
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
   * Recherche par compte externe lié — scanne le tableau `socialProviders` via
   * `$elemMatch` (1 requête, équivalent Mongo du `json_each` Drizzle). `null` si
   * aucun lien. Liée à la session transactionnelle courante le cas échéant.
   */
  async findBySocialProvider(
    provider: string,
    providerId: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    let query = this.#model.findOne({
      socialProviders: { $elemMatch: { provider, providerId } },
    });
    if (this.#session) {
      query = query.session(this.#session);
    }
    const doc = await query.exec();
    return doc
      ? this.#toUser(doc.toObject({ virtuals: true }) as unknown as UserRow)
      : null;
  }
}
