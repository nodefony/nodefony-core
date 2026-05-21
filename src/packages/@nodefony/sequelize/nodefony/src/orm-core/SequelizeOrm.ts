import { Sequelize } from "sequelize";
import type { Model, ModelAttributes, ModelStatic, Options } from "sequelize";
import { Orm, entityRegistry } from "@nodefony/orm-core";
import type { IEntity, IRepository, ITransaction } from "@nodefony/orm-core";
import { SequelizeRepository } from "./SequelizeRepository";
import { SequelizeTransaction } from "./SequelizeTransaction";

/**
 * Adapter Sequelize **branché sur `@nodefony/orm-core`** (P5.4).
 *
 * Implémentation propre et minimale du contrat {@link Orm}/`IOrm`, **distincte**
 * du service legacy `nodefony/service/orm.ts` (qui étend l'ancien `Orm` du core
 * `nodefony`). Sert de banc de validation de l'abstraction multi-ORM avant de
 * migrer le driver de production (P7.1).
 *
 * Flux : à `connect()` (template de {@link Orm}), instancie un `Sequelize`
 * natif, **compile les entités enregistrées** pour cet ORM (lues dans
 * `entityRegistry` via leur `schema`/`relations`), câble les associations,
 * puis `sync()` (dev/test ; la prod passera par migrations). Chaque entité reçoit
 * son `model` compilé ; `getRepository(name)` sert un {@link SequelizeRepository}.
 *
 * Limites assumées (ADR-0003) : pas de jointure/eager-load via le repository
 * portable → `getNativeConnection()` ; transaction managée → threader la tx aux
 * repositories reste du ressort natif.
 */
export class SequelizeOrm extends Orm {
  #sequelize: Sequelize | null = null;
  #connected = false;
  /** Modèles compilés indexés par nom logique d'entité (lazy). */
  #models: Record<string, ModelStatic<Model>> | null = null;
  /** Repositories mémoïsés par nom d'entité (lazy). */
  #repositories: Record<string, IRepository> | null = null;
  readonly #options: Options;

  /**
   * @param name - clé unique de l'ORM dans le `ormRegistry` (ex. `"db_test"`).
   * @param options - options de connexion Sequelize (dialect, storage, host...).
   */
  constructor(name: string, options: Options) {
    super(name);
    this.#options = options;
  }

  /** Entités enregistrées dans `entityRegistry` ciblant cet ORM. */
  #ownEntities(): IEntity[] {
    return entityRegistry.list().filter((entity) => entity.orm === this.name);
  }

  /**
   * Nom de clé étrangère déterministe (camelCase) `<entité>Id`.
   *
   * Sequelize génère par défaut une FK PascalCase (`UserId`) ; on force le
   * camelCase (`userId`) pour un contrat stable et lisible côté repository
   * portable (le critère `{ userId }` doit matcher la colonne).
   */
  #foreignKey(entityName: string): string {
    return `${entityName.charAt(0).toLowerCase()}${entityName.slice(1)}Id`;
  }

  protected async onConnect(): Promise<void> {
    const sequelize = new Sequelize(this.#options);
    await sequelize.authenticate();
    this.#sequelize = sequelize;
    this.#models = Object.create(null) as Record<string, ModelStatic<Model>>;

    const entities = this.#ownEntities();

    // 1) Compilation des modèles depuis le schéma natif de chaque entité.
    for (const entity of entities) {
      const model = sequelize.define(
        entity.name,
        entity.schema as ModelAttributes,
        { tableName: entity.name, timestamps: false },
      );
      this.#models[entity.name] = model;
      entity.model = model;
    }

    // 2) Câblage des associations déclaratives.
    for (const entity of entities) {
      if (!entity.relations) {
        continue;
      }
      const source = this.#models[entity.name];
      for (const relation of entity.relations) {
        const target = this.#models[relation.target];
        if (!target) {
          throw new Error(
            `SequelizeOrm "${this.name}": relation target "${relation.target}" ` +
              `(from "${entity.name}.${relation.field}") not registered for this ORM.`,
          );
        }
        switch (relation.type) {
          case "one-to-many":
            // FK sur la cible, nommée d'après la source (`userId` sur Room).
            source.hasMany(target, {
              as: relation.field,
              foreignKey: relation.foreignKey ?? this.#foreignKey(entity.name),
            });
            break;
          case "many-to-one":
            // FK sur la source, nommée d'après la cible (inverse cohérent).
            source.belongsTo(target, {
              as: relation.field,
              foreignKey:
                relation.foreignKey ?? this.#foreignKey(relation.target),
            });
            break;
          case "one-to-one":
            source.hasOne(target, {
              as: relation.field,
              foreignKey: relation.foreignKey ?? this.#foreignKey(entity.name),
            });
            break;
          case "many-to-many":
            throw new Error(
              `SequelizeOrm "${this.name}": many-to-many ("${entity.name}.${relation.field}") ` +
                `non portable — déclarer via getNativeConnection().`,
            );
        }
      }
    }

    // 3) Création du schéma (dev/test uniquement ; prod = migrations).
    await sequelize.sync();
    this.#connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.#sequelize) {
      await this.#sequelize.close();
    }
    this.#sequelize = null;
    this.#connected = false;
    this.#models = null;
    this.#repositories = null;
  }

  isConnected(): boolean {
    return this.#connected;
  }

  getRepository<T = unknown>(name: string): IRepository<T> {
    const model = this.#models?.[name];
    if (!model) {
      throw new Error(
        `SequelizeOrm "${this.name}": no entity model registered under "${name}".`,
      );
    }
    if (this.#repositories === null) {
      this.#repositories = Object.create(null) as Record<string, IRepository>;
    }
    let repository = this.#repositories[name];
    if (repository === undefined) {
      repository = new SequelizeRepository(model);
      this.#repositories[name] = repository;
    }
    return repository as IRepository<T>;
  }

  async transaction<R>(work: (tx: ITransaction) => Promise<R>): Promise<R> {
    const sequelize = this.#sequelize;
    if (!sequelize) {
      throw new Error(`SequelizeOrm "${this.name}": not connected.`);
    }
    // Transaction managée : commit si la closure résout, rollback si elle rejette.
    return sequelize.transaction((native) =>
      work(new SequelizeTransaction(sequelize, native)),
    );
  }

  getNativeConnection<C = unknown>(): C {
    if (!this.#sequelize) {
      throw new Error(`SequelizeOrm "${this.name}": not connected.`);
    }
    return this.#sequelize as C;
  }
}
