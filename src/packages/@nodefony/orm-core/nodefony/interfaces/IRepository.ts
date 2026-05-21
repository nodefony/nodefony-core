import type { ITransaction } from "./ITransaction";

/**
 * Critère de filtre brut passé aux opérations d'un repository.
 *
 * Volontairement abstrait (`Record<string, unknown>`) : chaque adapter ORM
 * traduit ce critère dans sa syntaxe native (clause `WHERE` SQL, query Mongo,
 * conditions Drizzle...). Le socle reste portable cross-ORM.
 */
export type OrmCriteria = Record<string, unknown>;

/**
 * Critère **partiellement typé** d'une entité `T`.
 *
 * `Partial<T>` type-vérifie l'égalité sur les champs connus (ex. `{ email }`
 * doit être un `string` si `T.email` l'est) ; l'intersection avec
 * {@link OrmCriteria} conserve une échappatoire pour les clés non typées
 * (opérateurs riches `$gt`/`$in`... à formaliser au branchement Drizzle, P7.4).
 *
 * @typeParam T - type de l'entité gérée.
 */
export type Criteria<T> = Partial<T> & OrmCriteria;

/**
 * Options de lecture (`find`/`findOne`) portables cross-ORM.
 *
 * `relations` charge des associations **déclarées** dans `@entity` (eager-load :
 * `include` Sequelize / `populate` Mongoose / `with` Drizzle) sans descendre au
 * natif pour le cas commun. Les jointures arbitraires restent du ressort de
 * `IOrm.getNativeConnection()`.
 */
export interface RepositoryReadOptions {
  /** Noms logiques des relations déclarées à charger (eager-load). */
  relations?: string[];

  /** Nombre maximum de lignes. */
  limit?: number;

  /** Décalage (pagination). */
  offset?: number;

  /** Tri : couples `[champ, sens]`. */
  order?: Array<[string, "ASC" | "DESC"]>;
}

/**
 * Contrat CRUD minimal exposé par un repository, indépendant de l'ORM sous-jacent.
 *
 * Un repository est obtenu via `IOrm.getRepository(name)` et manipule des entités
 * de type `T`. Les sémantiques fines (cascade, hooks, upsert) sont déléguées à
 * l'adapter concret ; ce contrat garantit uniquement le socle portable.
 *
 * @typeParam T - type de l'entité gérée par le repository.
 */
export interface IRepository<T = unknown> {
  /**
   * Retourne toutes les entités correspondant au critère (toutes si omis).
   *
   * @param criteria - filtre optionnel (partiellement typé).
   * @param options - eager-load / pagination / tri portables.
   * @returns la liste des entités trouvées (vide si aucune).
   */
  find(criteria?: Criteria<T>, options?: RepositoryReadOptions): Promise<T[]>;

  /**
   * Retourne la première entité correspondant au critère, ou `null`.
   *
   * @param criteria - filtre de sélection (partiellement typé).
   * @param options - eager-load portable (`relations`).
   */
  findOne(
    criteria: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T | null>;

  /**
   * Persiste une nouvelle entité et retourne sa version persistée (id généré, valeurs par défaut).
   *
   * @param data - champs de l'entité à créer.
   */
  create(data: Partial<T>): Promise<T>;

  /**
   * Met à jour les entités correspondant au critère et retourne l'entité mise à jour, ou `null`.
   *
   * @param criteria - filtre de sélection.
   * @param data - champs à modifier.
   */
  update(criteria: Criteria<T>, data: Partial<T>): Promise<T | null>;

  /**
   * Supprime les entités correspondant au critère.
   *
   * @param criteria - filtre de sélection.
   * @returns nombre d'entités supprimées.
   */
  delete(criteria: Criteria<T>): Promise<number>;

  /**
   * Compte les entités correspondant au critère (toutes si omis).
   *
   * @param criteria - filtre optionnel.
   */
  count(criteria?: Criteria<T>): Promise<number>;

  /**
   * Retourne une **vue de ce repository liée à une transaction** : toutes ses
   * opérations s'exécutent dans `tx` (commit/rollback gérés par
   * `IOrm.transaction()`). Résout la fuite « repository non tx-aware » (ADR-0003
   * risque #4) sans état global ni CLS.
   *
   * @param tx - transaction active (issue du callback de `IOrm.transaction`).
   * @returns un repository équivalent dont les écritures/lectures portent sur `tx`.
   */
  withTransaction(tx: ITransaction): IRepository<T>;
}
