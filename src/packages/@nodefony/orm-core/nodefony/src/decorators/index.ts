/**
 * Barrel des décorateurs orm-core (P5.3).
 *
 * `@entity` + `@repository` + helpers d'introspection des métadonnées
 * (stockées via `WeakMap`, sans `reflect-metadata`).
 */
export { entity, type EntityOptions } from "./entityDecorator";
export { repository, type RepositoryOptions } from "./repositoryDecorator";
export {
  getEntityMeta,
  hasEntityMeta,
  getRepositoryMeta,
  hasRepositoryMeta,
  type EntityMetadata,
  type RepositoryMetadata,
  type DecoratedClass,
} from "./metadataStore";
