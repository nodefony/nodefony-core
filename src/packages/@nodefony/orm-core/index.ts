/**
 * `@nodefony/orm-core` — fondation multi-ORM de Nodefony.
 *
 * Expose les contrats abstraits (`IOrm`, `IEntity`, `IRepository`,
 * `ITransaction`) consommés par les adapters (`@nodefony/sequelize`,
 * `@nodefony/mongoose`, `@nodefony/drizzle`...). Lib pure : aucun runtime
 * Module, pas d'enregistrement dans `@modules()`. Le registre singleton et
 * les classes de base (`OrmRegistry`, `Orm`, `Entity`, `EntityRegistry`)
 * arrivent en P5.2.
 */
export type {
  IOrm,
  IEntity,
  IEntityRelation,
  IRepository,
  OrmCriteria,
  ITransaction,
} from "./nodefony/interfaces/index";
