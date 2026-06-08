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
 * Opérateurs de comparaison riches applicables à **un** champ, façon MongoDB.
 *
 * Forme tranchée en P7.4 (ADR-0003 risque #3) : objet d'opérateurs `$`-préfixés.
 * Raison : (1) familier (convention Mongo) ; (2) mappable par les **trois**
 * drivers — Mongoose en (quasi) identité (`$gt`/`$in` natifs, `$like`→`$regex`),
 * Drizzle via `gt()`/`inArray()`/`like()` (selon l'adapter). Le sous-ensemble
 * est volontairement minimal = intersection portable des 3 ORM.
 *
 * Plusieurs opérateurs sur le même champ se combinent en `AND`
 * (ex. `{ age: { $gte: 18, $lt: 65 } }`).
 *
 * @typeParam V - type de la valeur du champ ciblé.
 */
export interface FieldOperators<V> {
  /** Égalité stricte (équivalent à passer la valeur nue). */
  $eq?: V;
  /** Différent de. */
  $ne?: V;
  /** Strictement supérieur à. */
  $gt?: V;
  /** Supérieur ou égal à. */
  $gte?: V;
  /** Strictement inférieur à. */
  $lt?: V;
  /** Inférieur ou égal à. */
  $lte?: V;
  /** Appartient à l'ensemble. */
  $in?: readonly V[];
  /** N'appartient pas à l'ensemble. */
  $nin?: readonly V[];
  /** Motif SQL `LIKE` (`%`/`_`) — pertinent pour les champs texte uniquement. */
  $like?: string;
}

/**
 * Valeur de critère pour un champ : soit l'**égalité** directe (valeur nue),
 * soit un objet d'{@link FieldOperators} riche.
 *
 * @typeParam V - type de la valeur du champ.
 */
export type FieldCriteria<V> = V | FieldOperators<NonNullable<V>>;

/**
 * Critère **typé par champ** d'une entité `T`.
 *
 * Chaque champ connu accepte soit son égalité (`{ email }` doit être un `string`
 * si `T.email` l'est), soit un objet d'opérateurs riches typé sur la valeur du
 * champ (`{ age: { $gt: 18 } }`). L'intersection avec {@link OrmCriteria}
 * conserve une échappatoire pour les clés non typées (champ calculé, opérateur
 * natif non couvert). Chaque adapter traduit ce critère dans sa syntaxe native.
 *
 * @typeParam T - type de l'entité gérée.
 */
export type Criteria<T> = {
  [K in keyof T]?: FieldCriteria<T[K]>;
} & OrmCriteria;

/**
 * Options de lecture (`find`/`findOne`) portables cross-ORM.
 *
 * `relations` charge des associations **déclarées** dans `@entity` (eager-load :
 * `populate` Mongoose / `with` Drizzle) sans descendre au
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
   * Met à jour **au plus une** entité correspondant au critère, de façon
   * **atomique**, et retourne sa version persistée (ou `null` si aucune ne
   * correspond).
   *
   * Atomicité : une **seule** requête (`UPDATE … RETURNING` SQL /
   * `findOneAndUpdate` Mongo), jamais un `UPDATE` suivi d'une relecture séparée
   * — cette dernière renverrait `null` à tort dès que le critère porte sur un
   * champ modifié (ex. `updateOne({ status: "pending" }, { status: "done" })`).
   *
   * @param criteria - filtre de sélection. Un champ inconnu de l'entité lève
   *   `UnknownCriteriaField` (mêmes règles que `find`).
   * @param data - champs à modifier.
   * @returns l'entité mise à jour, ou `null` si le critère ne matche rien.
   */
  updateOne(criteria: Criteria<T>, data: Partial<T>): Promise<T | null>;

  /**
   * Met à jour **toutes** les entités correspondant au critère et retourne le
   * **nombre** de lignes modifiées (parité de signature avec
   * {@link IRepository.delete}).
   *
   * @param criteria - filtre de sélection. Un champ inconnu lève
   *   `UnknownCriteriaField`.
   * @param data - champs à modifier.
   * @returns le nombre d'entités mises à jour.
   */
  updateMany(criteria: Criteria<T>, data: Partial<T>): Promise<number>;

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
