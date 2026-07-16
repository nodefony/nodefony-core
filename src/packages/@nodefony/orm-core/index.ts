/**
 * `@nodefony/orm-core` — fondation multi-ORM de Nodefony.
 *
 * Expose les contrats abstraits (`IOrm`, `IEntity`, `IRepository`,
 * `ITransaction`) consommés par les adapters (`@nodefony/mongoose`,
 * `@nodefony/drizzle`...). Lib pure : aucun runtime
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
  UpdateData,
  UpdateOperators,
  RepositoryReadOptions,
  ITransaction,
} from "./nodefony/interfaces/index";

// ─── Critères riches (P7.4) — helper de détection d'opérateurs (lib pure) ────
export { OPERATOR_KEYS, isFieldOperators } from "./nodefony/src/criteria";
export type { OperatorKey } from "./nodefony/src/criteria";
export {
  UPDATE_OPERATOR_KEYS,
  isUpdateOperators,
} from "./nodefony/src/criteria";
export type { UpdateOperatorKey } from "./nodefony/src/criteria";

// ─── Erreurs ORM data-level (aucun couplage API) ─────────────────────────────
export { UnknownCriteriaField } from "./nodefony/src/errors";

// ─── Runtime (P5.2) — registres singletons + classes de base ────────────────
export { OrmRegistry, ormRegistry } from "./nodefony/src/OrmRegistry";
export { EntityRegistry, entityRegistry } from "./nodefony/src/EntityRegistry";
export { Orm } from "./nodefony/src/Orm";
export { Entity } from "./nodefony/src/Entity";

// ─── Service CRUD générique — socle réutilisable sur IRepository<T> ──────────
export { AbstractCrudService } from "./nodefony/src/AbstractCrudService";
export type { ServiceWiring } from "./nodefony/src/serviceWiring";

// ─── Data plane ORM (graphe canonique IA-first + admin API + export DBML) ────
export {
  buildOrmGraph,
  buildConnectionHealth,
  buildOrmFlow,
  toDbml,
  createOrmAdminApi,
  registerOrmAdminApi,
} from "./nodefony/src/OrmAdminApi";
export { queryFlowMonitor } from "./nodefony/src/QueryFlowMonitor";
export { buildOrmLeanHealth } from "./nodefony/src/buildOrmLeanHealth";

// ─── Câblage runtime d'un driver (factorise la dette C5 — appelé par chaque ORM) ─
export {
  wireOrmAdminPlane,
  resolveOrmFlowEnabled,
} from "./nodefony/src/ormWiring";
export type {
  ISlowQuery,
  IQueryFlow,
  IOrmFlowReport,
} from "./nodefony/interfaces/IOrmFlow";
export type {
  IColumnInfo,
  IConnectionInfo,
  IRelationInfo,
  IEntityGraphNode,
  IOrmSummary,
  IOrmGraph,
  IConnectionError,
  IConnectionHealth,
} from "./nodefony/interfaces/IOrmGraph";
export type {
  ILatencyWindow,
  IOrmStorageProbe,
  IOrmPoolProbe,
  IOrmProbe,
} from "./nodefony/interfaces/IOrmProbe";

// ─── Décorateurs (P5.3) — @entity / @repository (WeakMap, sans reflect) ──────
export {
  entity,
  entities,
  DEFAULT_CONNECTOR,
  repository,
} from "./nodefony/src/decorators/index";
export { defineEntity } from "./nodefony/src/defineEntity";
export type { IEntityDefinition } from "./nodefony/src/defineEntity";
export type { EntitiesOptions } from "./nodefony/src/decorators/index";
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
