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
  Criteria,
  FieldCriteria,
  FieldOperators,
  RepositoryReadOptions,
  ITransaction,
} from "./nodefony/interfaces/index";

// ─── Critères riches (P7.4) — helper de détection d'opérateurs (lib pure) ────
export { OPERATOR_KEYS, isFieldOperators } from "./nodefony/src/criteria";
export type { OperatorKey } from "./nodefony/src/criteria";

// ─── Runtime (P5.2) — registres singletons + classes de base ────────────────
export { OrmRegistry, ormRegistry } from "./nodefony/src/OrmRegistry";
export { EntityRegistry, entityRegistry } from "./nodefony/src/EntityRegistry";
export { Orm } from "./nodefony/src/Orm";
export { Entity } from "./nodefony/src/Entity";

// ─── Service CRUD générique — socle réutilisable sur IRepository<T> ──────────
export { AbstractCrudService } from "./nodefony/src/AbstractCrudService";
export type { ServiceWiring } from "./nodefony/src/serviceWiring";

// ─── Décorateurs (P5.3) — @entity / @repository (WeakMap, sans reflect) ──────
export { entity, repository } from "./nodefony/src/decorators/index";
export {
  getEntityMeta,
  hasEntityMeta,
  getRepositoryMeta,
  hasRepositoryMeta,
} from "./nodefony/src/decorators/index";
export type {
  EntityOptions,
  RepositoryOptions,
  EntityMetadata,
  RepositoryMetadata,
  DecoratedClass,
} from "./nodefony/src/decorators/index";
