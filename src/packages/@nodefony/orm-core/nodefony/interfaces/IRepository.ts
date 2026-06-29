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
 * de type `T`. Les sémantiques fines (cascade, hooks) sont déléguées à
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
   * Insère **plusieurs** entités en **une seule** requête (`INSERT … VALUES
   * (…),(…)` SQL / `insertMany` Mongo) et retourne leurs versions persistées
   * (ids générés, défauts appliqués), dans l'ordre. Un tableau vide est un
   * **no-op** (`[]`, aucune requête). Préférer à N appels `create` (N round-trips)
   * pour le seed / l'import / l'ingestion par lots.
   *
   * @param data - entités à créer.
   * @returns les entités persistées, dans le même ordre.
   */
  createMany(data: Partial<T>[]): Promise<T[]>;

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
   * Insère **ou** met à jour atomiquement l'entité identifiée par `criteria`
   * (clé unique), en **une seule** requête (`INSERT … ON CONFLICT DO UPDATE …
   * RETURNING` SQL / `findOneAndUpdate({ upsert })` Mongo) — jamais un `SELECT`
   * d'existence suivi d'un `INSERT`/`UPDATE` séparé (2 round-trips + une race
   * insert/update entre les deux).
   *
   * - **INSERT** (clé absente) : la ligne créée = `{ ...criteria, ...insertOnly,
   *   ...update }`.
   * - **UPDATE** (conflit de clé) : seul `update` est ré-appliqué (`SET`) ;
   *   `criteria` et `insertOnly` ne touchent PAS la ligne existante (ex.
   *   `createdAt` posé à la création est préservé).
   *
   * @param criteria - clé de conflit (colonnes **uniques**, égalité simple — pas
   *   d'opérateurs riches `$`). Sert aussi de valeurs d'insertion.
   * @param update - champs posés à l'insertion ET ré-appliqués en cas de conflit.
   * @param insertOnly - champs posés **uniquement** à l'insertion (ex. `createdAt`).
   * @returns l'entité persistée (ligne réelle via `RETURNING` / `returnDocument`).
   */
  upsert(
    criteria: Criteria<T>,
    update: Partial<T>,
    insertOnly?: Partial<T>,
  ): Promise<T>;

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
   * Incrémente **atomiquement** des champs numériques d'**au plus une** entité
   * (`SET f = f + ?` SQL / `$inc` Mongo), sans read-modify-write (donc sans race)
   * — pour les compteurs (stats, usage/tokens, rate-limit). Un delta négatif
   * décrémente. Retourne l'entité après modification, ou `null` si le critère ne
   * matche rien.
   *
   * @param criteria - filtre de sélection (au plus une entité affectée).
   * @param changes - deltas par champ (`{ hits: 1, credits: -5 }`).
   * @returns l'entité mise à jour, ou `null`.
   */
  increment(
    criteria: Criteria<T>,
    changes: Partial<Record<keyof T, number>>,
  ): Promise<T | null>;

  /**
   * Supprime les entités correspondant au critère.
   *
   * @param criteria - filtre de sélection.
   * @returns nombre d'entités supprimées.
   */
  delete(criteria: Criteria<T>): Promise<number>;

  /**
   * Supprime **au plus une** entité de façon **atomique** (symétrique
   * d'{@link IRepository.updateOne} ; `DELETE … LIMIT 1` SQL / `deleteOne` Mongo).
   *
   * @param criteria - filtre de sélection.
   * @returns `true` si une entité a été supprimée, `false` sinon.
   */
  deleteOne(criteria: Criteria<T>): Promise<boolean>;

  /**
   * Supprime **au plus une** entité et **retourne** sa valeur supprimée (ou
   * `null`), de façon atomique (`DELETE … RETURNING` SQL / `findOneAndDelete`
   * Mongo) — claim-and-remove (file de jobs, outbox, pop atomique).
   *
   * @param criteria - filtre de sélection.
   * @returns l'entité supprimée, ou `null` si aucune ne correspond.
   */
  findOneAndDelete(criteria: Criteria<T>): Promise<T | null>;

  /**
   * Compte les entités correspondant au critère (toutes si omis).
   *
   * @param criteria - filtre optionnel.
   */
  count(criteria?: Criteria<T>): Promise<number>;

  /**
   * Indique si **au moins une** entité correspond au critère, sans rapatrier la
   * ligne (`SELECT 1 … LIMIT 1` SQL / `exists` Mongo). Préférer à
   * `findOne(...) !== null` (aucune colonne chargée) et à `count(...) > 0` (pas de
   * comptage complet) pour un simple test d'existence.
   *
   * @param criteria - filtre de sélection.
   * @returns `true` si une entité correspond, `false` sinon.
   */
  exists(criteria: Criteria<T>): Promise<boolean>;

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
