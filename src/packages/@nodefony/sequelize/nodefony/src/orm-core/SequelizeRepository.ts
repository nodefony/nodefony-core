import type { Model, ModelStatic, WhereOptions } from "sequelize";
import type { IRepository, OrmCriteria } from "@nodefony/orm-core";

/**
 * Repository portable (contrat {@link IRepository}) au-dessus d'un modèle
 * Sequelize compilé.
 *
 * Traduit le CRUD abstrait en appels Sequelize et **renvoie des objets plats**
 * (`get({ plain: true })`) — jamais des instances `Model` (le métier ne doit pas
 * dépendre du driver). Les requêtes riches (jointures/eager-load, opérateurs)
 * ne sont PAS exprimables ici : passer par `IOrm.getNativeConnection()` (limite
 * documentée — cf ADR-0003, risque #1 « abstraction qui fuit »).
 *
 * @typeParam T - forme plate de l'entité gérée.
 */
export class SequelizeRepository<T = unknown> implements IRepository<T> {
  readonly #model: ModelStatic<Model>;

  /**
   * @param model - modèle Sequelize compilé (issu de `sequelize.define`).
   */
  constructor(model: ModelStatic<Model>) {
    this.#model = model;
  }

  /** Toutes les lignes correspondant au critère (toutes si omis). */
  async find(criteria?: OrmCriteria): Promise<T[]> {
    const rows = await this.#model.findAll(
      criteria ? { where: criteria as WhereOptions } : undefined,
    );
    return rows.map((row) => row.get({ plain: true }) as T);
  }

  /** Première ligne correspondant au critère, ou `null`. */
  async findOne(criteria: OrmCriteria): Promise<T | null> {
    const row = await this.#model.findOne({ where: criteria as WhereOptions });
    return row ? (row.get({ plain: true }) as T) : null;
  }

  /** Persiste une nouvelle ligne et renvoie sa version plate. */
  async create(data: Partial<T>): Promise<T> {
    const row = await this.#model.create(data as Record<string, unknown>);
    return row.get({ plain: true }) as T;
  }

  /** Met à jour les lignes du critère et renvoie la première à jour, ou `null`. */
  async update(criteria: OrmCriteria, data: Partial<T>): Promise<T | null> {
    await this.#model.update(data as Record<string, unknown>, {
      where: criteria as WhereOptions,
    });
    return this.findOne(criteria);
  }

  /** Supprime les lignes du critère ; renvoie le nombre supprimé. */
  async delete(criteria: OrmCriteria): Promise<number> {
    return this.#model.destroy({ where: criteria as WhereOptions });
  }

  /** Compte les lignes correspondant au critère (toutes si omis). */
  async count(criteria?: OrmCriteria): Promise<number> {
    return this.#model.count(
      criteria ? { where: criteria as WhereOptions } : undefined,
    );
  }
}
