import { Op } from "sequelize";
import type {
  FindOptions,
  Model,
  ModelStatic,
  Order,
  Transaction,
  WhereOptions,
} from "sequelize";
import { RequestContext, redactSecrets } from "nodefony";
import type { IProfilerQuery } from "nodefony";
import { isFieldOperators } from "@nodefony/orm-core";
import type {
  Criteria,
  FieldOperators,
  IRepository,
  ITransaction,
  RepositoryReadOptions,
} from "@nodefony/orm-core";

/**
 * Repository portable (contrat {@link IRepository}) au-dessus d'un modèle
 * Sequelize compilé.
 *
 * Traduit le CRUD abstrait en appels Sequelize et **renvoie des objets plats**
 * (`get({ plain: true })`) — jamais des instances `Model`. Supporte :
 * - l'**eager-load portable** via `options.relations` (mappé sur les associations
 *   déclarées → `include`), résolvant la fuite « jointure » du cas commun ;
 * - la **liaison transactionnelle** via {@link SequelizeRepository.withTransaction}
 *   (toutes les opérations passent `{ transaction }`).
 *
 * @typeParam T - forme plate de l'entité gérée.
 */
export class SequelizeRepository<T = unknown> implements IRepository<T> {
  readonly #model: ModelStatic<Model>;
  readonly #tx: Transaction | null;

  /**
   * @param model - modèle Sequelize compilé (issu de `sequelize.define`).
   * @param tx - transaction native à laquelle lier les opérations (ou `null`).
   */
  constructor(model: ModelStatic<Model>, tx: Transaction | null = null) {
    this.#model = model;
    this.#tx = tx;
  }

  /** Traduit les opérateurs riches portables (`$gt`/`$in`...) en symboles `Op.*`. */
  #mapOperators(ops: FieldOperators<unknown>): Record<symbol, unknown> {
    const out: Record<symbol, unknown> = {};
    if (ops.$eq !== undefined) out[Op.eq] = ops.$eq;
    if (ops.$ne !== undefined) out[Op.ne] = ops.$ne;
    if (ops.$gt !== undefined) out[Op.gt] = ops.$gt;
    if (ops.$gte !== undefined) out[Op.gte] = ops.$gte;
    if (ops.$lt !== undefined) out[Op.lt] = ops.$lt;
    if (ops.$lte !== undefined) out[Op.lte] = ops.$lte;
    if (ops.$in !== undefined) out[Op.in] = ops.$in;
    if (ops.$nin !== undefined) out[Op.notIn] = ops.$nin;
    if (ops.$like !== undefined) out[Op.like] = ops.$like;
    return out;
  }

  /** Traduit un critère portable en clause `where` Sequelize (égalité + opérateurs). */
  #toWhere(criteria: Criteria<T>): WhereOptions {
    const where: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(criteria)) {
      where[field] = isFieldOperators(value) ? this.#mapOperators(value) : value;
    }
    return where as WhereOptions;
  }

  /** Construit les `FindOptions` Sequelize depuis critère + options portables. */
  #findOptions(
    criteria?: Criteria<T>,
    options?: RepositoryReadOptions,
  ): FindOptions {
    const find: FindOptions = {};
    if (criteria) {
      find.where = this.#toWhere(criteria);
    }
    if (this.#tx) {
      find.transaction = this.#tx;
    }
    if (options?.relations?.length) {
      find.include = options.relations.map((name) => {
        if (!this.#model.associations[name]) {
          throw new Error(
            `SequelizeRepository(${this.#model.name}): relation "${name}" non déclarée.`,
          );
        }
        return { association: name };
      });
    }
    if (options?.limit !== undefined) {
      find.limit = options.limit;
    }
    if (options?.offset !== undefined) {
      find.offset = options.offset;
    }
    if (options?.order?.length) {
      find.order = options.order as Order;
    }
    return find;
  }

  /** `{ transaction }` si lié, sinon `undefined` (factorisation write ops). */
  #txOpt(): { transaction: Transaction } | undefined {
    return this.#tx ? { transaction: this.#tx } : undefined;
  }

  /**
   * Tap profiler dev-only : si un buffer de requêtes est actif sur le scope
   * courant (ALS, lu **en synchrone ici** où le contexte est encore valide),
   * ajoute `benchmark` + un `logging` par requête qui pousse dans ce buffer.
   *
   * POURQUOI per-query (et pas `logging` global sur l'instance) : le pool de
   * connexions Sequelize résout sur un contexte async **détaché** → l'ALS y est
   * perdue (cf BUG-001/002). La closure capture la référence du buffer au
   * moment de l'appel (contexte valide), donc le callback n'a plus besoin de
   * relire l'ALS. Hors dev/scope : `base` renvoyé tel quel → coût = 1 lecture
   * ALS, zéro benchmark.
   *
   * @param base - options Sequelize de la requête (ou `undefined`).
   * @returns les mêmes options, augmentées du tap si profiling actif.
   */
  #prof<O extends object | undefined>(base: O): O {
    const buf = RequestContext.get()?.queries;
    if (!buf) {
      return base;
    }
    return {
      ...(base as object),
      benchmark: true,
      logging: (sql: string, timing?: number): void => {
        // Sequelize `logging` fournit le SQL **interpolé** (valeurs inline) →
        // un INSERT/UPDATE User y mettrait le hash du mot de passe. Redaction
        // AVANT troncature (le `***` raccourcit, donc l'ordre est correct) —
        // défense en profondeur, le profiler reste dev-only mais ne doit jamais
        // exposer un credential au browser/debug bar.
        const safe = redactSecrets(sql);
        buf.push({
          sql: safe.length > 2000 ? `${safe.slice(0, 2000)}…` : safe,
          durationMs: typeof timing === "number" ? timing : 0,
          connector: "sequelize",
        } satisfies IProfilerQuery);
      },
    } as unknown as O;
  }

  async find(
    criteria?: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T[]> {
    const rows = await this.#model.findAll(
      this.#prof(this.#findOptions(criteria, options)),
    );
    return rows.map((row) => row.get({ plain: true }) as T);
  }

  async findOne(
    criteria: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T | null> {
    const row = await this.#model.findOne(
      this.#prof(this.#findOptions(criteria, options)),
    );
    return row ? (row.get({ plain: true }) as T) : null;
  }

  async create(data: Partial<T>): Promise<T> {
    const row = await this.#model.create(
      data as Record<string, unknown>,
      this.#prof(this.#txOpt()),
    );
    return row.get({ plain: true }) as T;
  }

  async update(criteria: Criteria<T>, data: Partial<T>): Promise<T | null> {
    await this.#model.update(
      data as Record<string, unknown>,
      this.#prof({
        where: this.#toWhere(criteria),
        ...this.#txOpt(),
      }),
    );
    return this.findOne(criteria);
  }

  async delete(criteria: Criteria<T>): Promise<number> {
    return this.#model.destroy(
      this.#prof({
        where: this.#toWhere(criteria),
        ...this.#txOpt(),
      }),
    );
  }

  async count(criteria?: Criteria<T>): Promise<number> {
    return this.#model.count(
      this.#prof({
        ...(criteria ? { where: this.#toWhere(criteria) } : {}),
        ...this.#txOpt(),
      }),
    );
  }

  withTransaction(tx: ITransaction): IRepository<T> {
    return new SequelizeRepository<T>(this.#model, tx.getNative<Transaction>());
  }
}
