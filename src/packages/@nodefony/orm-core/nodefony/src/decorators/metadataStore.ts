import type { IEntityRelation } from "../../interfaces/index";

/**
 * Constructeur de classe ciblé par un décorateur orm-core (paramètres libres).
 *
 * `never[]` en rest accepte n'importe quelle signature de constructeur concrète
 * tout en restant assignable comme clé `WeakMap`. Évite `any` (règle projet).
 */
export type DecoratedClass = new (...args: never[]) => object;

/**
 * Métadonnée attachée à une classe par {@link entity}.
 *
 * @typeParam S - type du schéma natif du driver.
 */
export interface EntityMetadata<S = unknown> {
  /** Nom logique de l'entité (clé de lookup). */
  readonly name: string;

  /** ORM cible enregistré dans le `ormRegistry`. */
  readonly orm: string;

  /** Module Nodefony propriétaire (regroupement graphe/ERD), si fourni. */
  readonly module?: string;

  /** Schéma natif du driver (forme libre), si fourni au décorateur. */
  readonly schema?: S;

  /** Relations déclaratives vers d'autres entités. */
  readonly relations?: ReadonlyArray<IEntityRelation>;

  /** Constructeur décoré (pour introspection / résolution lazy par le driver). */
  readonly target: DecoratedClass;
}

/**
 * Métadonnée attachée à une classe par {@link repository}.
 */
export interface RepositoryMetadata {
  /** Nom logique du repository (clé DI, ex. `"repository.user"`). */
  readonly name: string;

  /** Nom logique de l'entité gérée par ce repository. */
  readonly entity: string;

  /** ORM cible (lève l'ambiguïté si l'entité existe pour plusieurs ORM). */
  readonly orm?: string;

  /** Constructeur décoré. */
  readonly target: DecoratedClass;
}

/**
 * Stockage des métadonnées de décorateurs SANS `reflect-metadata`.
 *
 * orm-core est une lib pure : aucune dépendance runtime hors `nodefony`. Les
 * décorateurs `@entity`/`@repository` ne lisent jamais les types émis par TS
 * (`design:paramtypes`), donc un `WeakMap<classe, métadonnée>` process-wide
 * suffit — clé = constructeur, GC-friendly (pas de fuite si la classe est
 * déréférencée). Aucun polyfill Reflect requis.
 */
const ENTITY_META = new WeakMap<DecoratedClass, EntityMetadata>();
const REPOSITORY_META = new WeakMap<DecoratedClass, RepositoryMetadata>();

/** Enregistre la métadonnée `@entity` d'une classe. */
export function setEntityMeta(target: DecoratedClass, meta: EntityMetadata): void {
  ENTITY_META.set(target, meta);
}

/** Récupère la métadonnée `@entity` d'une classe, ou `undefined`. */
export function getEntityMeta(target: DecoratedClass): EntityMetadata | undefined {
  return ENTITY_META.get(target);
}

/** Indique si une classe porte une métadonnée `@entity`. */
export function hasEntityMeta(target: DecoratedClass): boolean {
  return ENTITY_META.has(target);
}

/** Enregistre la métadonnée `@repository` d'une classe. */
export function setRepositoryMeta(
  target: DecoratedClass,
  meta: RepositoryMetadata,
): void {
  REPOSITORY_META.set(target, meta);
}

/** Récupère la métadonnée `@repository` d'une classe, ou `undefined`. */
export function getRepositoryMeta(
  target: DecoratedClass,
): RepositoryMetadata | undefined {
  return REPOSITORY_META.get(target);
}

/** Indique si une classe porte une métadonnée `@repository`. */
export function hasRepositoryMeta(target: DecoratedClass): boolean {
  return REPOSITORY_META.has(target);
}
