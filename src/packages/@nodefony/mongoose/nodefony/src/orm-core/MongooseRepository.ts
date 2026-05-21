import type { ClientSession, FilterQuery, Model } from "mongoose";
import { isFieldOperators } from "@nodefony/orm-core";
import type {
  Criteria,
  FieldOperators,
  IRepository,
  ITransaction,
  RepositoryReadOptions,
} from "@nodefony/orm-core";

/** Modèle Mongoose à document libre (boundary — typé finement côté repo). */
type LooseModel = Model<Record<string, unknown>>;

/**
 * Traduit un motif SQL `LIKE` (`%` = n caractères, `_` = un caractère) en RegExp
 * ancrée — `$like` portable n'a pas d'équivalent natif MongoDB.
 */
function sqlLikeToRegex(pattern: string): RegExp {
  // 1) échappe les méta-caractères regex, 2) traduit les jokers SQL.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`);
}

/**
 * Repository portable (contrat {@link IRepository}) au-dessus d'un modèle Mongoose.
 *
 * Démontre la portabilité du contrat sur un **store documentaire hétérogène** :
 * - `options.relations` → `populate()` (virtuels/refs déclarés), pas `include` ;
 * - **clé primaire `_id`** (MongoDB) ↔ `id` (contrat) : le critère `{ id }` est
 *   traduit en `{ _id }`, et la sortie (`toObject({ virtuals: true })`) porte le
 *   virtuel `id` (string hex de l'ObjectId) → contrat `id: string` respecté ;
 * - liaison transactionnelle via {@link MongooseRepository.withTransaction}
 *   (`{ session }` sur toutes les ops ; requiert un replica set).
 *
 * @typeParam T - forme plate de l'entité gérée.
 */
export class MongooseRepository<T = unknown> implements IRepository<T> {
  readonly #model: LooseModel;
  readonly #session: ClientSession | null;

  /**
   * @param model - modèle Mongoose compilé.
   * @param session - session transactionnelle à laquelle lier les ops (ou `null`).
   */
  constructor(model: LooseModel, session: ClientSession | null = null) {
    this.#model = model;
    this.#session = session;
  }

  /**
   * Traduit les opérateurs riches portables en opérateurs MongoDB.
   *
   * Quasi-identité : `$gt`/`$in`/`$nin`/`$ne`/`$eq`/`$lt`... sont natifs Mongo ;
   * seul `$like` (motif SQL) est converti en `$regex`.
   */
  #mongoOps(ops: FieldOperators<unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ops)) {
      if (key === "$like") {
        out.$regex = sqlLikeToRegex(value as string);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * Traduit le critère portable : `id` → `_id` (PK MongoDB) + opérateurs riches.
   */
  #filter(criteria?: Criteria<T>): FilterQuery<Record<string, unknown>> {
    if (!criteria) {
      return {};
    }
    const out: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(criteria)) {
      const key = field === "id" ? "_id" : field;
      out[key] = isFieldOperators(value) ? this.#mongoOps(value) : value;
    }
    return out as FilterQuery<Record<string, unknown>>;
  }

  /** Sérialise un document en objet plat (virtuels inclus → `id`, populates). */
  #plain(doc: { toObject: (o: { virtuals: boolean }) => unknown }): T {
    return doc.toObject({ virtuals: true }) as T;
  }

  async find(
    criteria?: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T[]> {
    let query = this.#model.find(this.#filter(criteria));
    if (this.#session) {
      query = query.session(this.#session);
    }
    if (options?.relations?.length) {
      query = query.populate(options.relations);
    }
    if (options?.offset !== undefined) {
      query = query.skip(options.offset);
    }
    if (options?.limit !== undefined) {
      query = query.limit(options.limit);
    }
    if (options?.order?.length) {
      query = query.sort(
        Object.fromEntries(
          options.order.map(([field, dir]) => [
            field,
            dir === "DESC" ? -1 : 1,
          ]),
        ),
      );
    }
    const docs = await query.exec();
    return docs.map((doc) => this.#plain(doc));
  }

  async findOne(
    criteria: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T | null> {
    let query = this.#model.findOne(this.#filter(criteria));
    if (this.#session) {
      query = query.session(this.#session);
    }
    if (options?.relations?.length) {
      query = query.populate(options.relations);
    }
    const doc = await query.exec();
    return doc ? this.#plain(doc) : null;
  }

  async create(data: Partial<T>): Promise<T> {
    const [doc] = await this.#model.create([data as Record<string, unknown>], {
      session: this.#session ?? undefined,
    });
    return this.#plain(doc);
  }

  async update(criteria: Criteria<T>, data: Partial<T>): Promise<T | null> {
    await this.#model.updateMany(
      this.#filter(criteria),
      data as Record<string, unknown>,
      { session: this.#session ?? undefined },
    );
    return this.findOne(criteria);
  }

  async delete(criteria: Criteria<T>): Promise<number> {
    const res = await this.#model.deleteMany(this.#filter(criteria), {
      session: this.#session ?? undefined,
    });
    return res.deletedCount ?? 0;
  }

  async count(criteria?: Criteria<T>): Promise<number> {
    return this.#model.countDocuments(this.#filter(criteria), {
      session: this.#session ?? undefined,
    });
  }

  withTransaction(tx: ITransaction): IRepository<T> {
    return new MongooseRepository<T>(this.#model, tx.getNative<ClientSession>());
  }
}
