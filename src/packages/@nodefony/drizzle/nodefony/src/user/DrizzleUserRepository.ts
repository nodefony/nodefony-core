import { sql } from "drizzle-orm";
import type {
  Criteria,
  IRepository,
  ITransaction,
  RepositoryReadOptions,
} from "@nodefony/orm-core";
import { BaseUser } from "@nodefony/user";
import type {
  IPasswordAuthenticatedUser,
  IUserRepository,
} from "@nodefony/user";
import type { DrizzleDb } from "../orm-core/DrizzleRepository";
import type { DrizzleOrm } from "../orm-core/DrizzleOrm";
import type { UserRow } from "./userTable";

/** Critère typé sur la ligne `User` (sous-ensemble compatible avec le contrat). */
type UserCriteria = Criteria<UserRow>;

/**
 * Adapter Drizzle du contrat {@link IUserRepository} — implémentation SQL **par
 * défaut** de la persistance utilisateur (P5.9).
 *
 * Décore le repository portable générique (`IRepository<UserRow>` de
 * {@link DrizzleOrm}) de deux responsabilités propres à l'utilisateur :
 * - **mapping ligne ↔ {@link BaseUser}** : les consommateurs reçoivent un objet
 *   porteur du comportement (`hasRole`/`isActive`/`isLocked`), pas une ligne nue ;
 * - **finders métier** : `findByIdentifier` (lookup unique) et
 *   `findBySocialProvider` (recherche dans le JSON `socialProviders` via
 *   `json_each`, pattern Shadow User OAuth).
 *
 * Le credential (`password`) transite par cette frontière — c'est attendu : le
 * repository **est** la frontière de persistance du hash (cf `IUserRepository`).
 */
export class DrizzleUserRepository implements IUserRepository {
  readonly #base: IRepository<UserRow>;
  readonly #db: DrizzleDb;

  /**
   * @param base - repository portable sur la table `User` (CRUD + criteria).
   * @param db - handle Drizzle (racine ou transaction) pour les requêtes JSON brutes.
   */
  constructor(base: IRepository<UserRow>, db: DrizzleDb) {
    this.#base = base;
    this.#db = db;
  }

  /**
   * Construit le repository utilisateur depuis un {@link DrizzleOrm} connecté.
   * L'entité `User` doit avoir été enregistrée (cf `registerUserEntity`) avant
   * `orm.connect()`.
   *
   * @param orm - ORM Drizzle connecté.
   * @returns le repository utilisateur prêt à l'emploi.
   */
  static from(orm: DrizzleOrm): DrizzleUserRepository {
    return new DrizzleUserRepository(
      orm.getRepository<UserRow>("User"),
      orm.getNativeConnection<DrizzleDb>(),
    );
  }

  /** Mappe une ligne plate en {@link BaseUser} (comportement + champs anti-migration). */
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

  async update(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: Partial<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const row = await this.#base.update(
      criteria as unknown as UserCriteria,
      data as Partial<UserRow>,
    );
    return row ? this.#toUser(row) : null;
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
   * Recherche par compte externe lié — scanne le JSON `socialProviders` via
   * `json_each` (1 requête), récupère l'`id`, puis recharge par le chemin typé
   * (parsing JSON/booléens cohérent). `null` si aucun lien.
   */
  async findBySocialProvider(
    provider: string,
    providerId: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const rows = (await this.#db.all(
      sql`SELECT "id" AS id FROM "User"
          WHERE EXISTS (
            SELECT 1 FROM json_each("User"."socialProviders")
            WHERE json_extract(value, '$.provider') = ${provider}
              AND json_extract(value, '$.providerId') = ${providerId}
          ) LIMIT 1`,
    )) as Array<{ id: string }>;
    if (rows.length === 0) {
      return null;
    }
    return this.findOne({
      id: rows[0].id,
    } as Criteria<IPasswordAuthenticatedUser>);
  }
}
