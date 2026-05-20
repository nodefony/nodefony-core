/**
 * `@nodefony/orm-core` — fondation multi-ORM de Nodefony.
 *
 * Expose les contrats abstraits (`IOrm`, `IEntity`, `IRepository`,
 * `ITransaction`) consommés par les adapters (`@nodefony/sequelize`,
 * `@nodefony/mongoose`, `@nodefony/drizzle`...). Lib pure : aucun runtime
 * Module, pas d'enregistrement dans `@modules()`. Les drivers concrets sont les
 * Modules ; ils s'enregistrent eux-mêmes dans le `OrmRegistry` à leur boot.
 */
export type {
  IOrm,
  IEntity,
  IEntityRelation,
  IRepository,
  OrmCriteria,
  ITransaction,
} from "./nodefony/interfaces/index";

// ─── Runtime (P5.2) — registres singletons + classes de base ────────────────
export { OrmRegistry, ormRegistry } from "./nodefony/src/OrmRegistry";
export { EntityRegistry, entityRegistry } from "./nodefony/src/EntityRegistry";
export { Orm } from "./nodefony/src/Orm";
export { Entity } from "./nodefony/src/Entity";
