/**
 * Critère de filtre passé aux opérations de lecture/écriture d'un repository.
 *
 * Volontairement abstrait (`Record<string, unknown>`) : chaque adapter ORM
 * traduit ce critère dans sa syntaxe native (clause `WHERE` SQL, query Mongo,
 * conditions Drizzle...). Le socle reste portable cross-ORM.
 */
export type OrmCriteria = Record<string, unknown>;

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
   * @param criteria - filtre optionnel.
   * @returns la liste des entités trouvées (vide si aucune).
   */
  find(criteria?: OrmCriteria): Promise<T[]>;

  /**
   * Retourne la première entité correspondant au critère, ou `null`.
   *
   * @param criteria - filtre de sélection.
   */
  findOne(criteria: OrmCriteria): Promise<T | null>;

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
  update(criteria: OrmCriteria, data: Partial<T>): Promise<T | null>;

  /**
   * Supprime les entités correspondant au critère.
   *
   * @param criteria - filtre de sélection.
   * @returns nombre d'entités supprimées.
   */
  delete(criteria: OrmCriteria): Promise<number>;

  /**
   * Compte les entités correspondant au critère (toutes si omis).
   *
   * @param criteria - filtre optionnel.
   */
  count(criteria?: OrmCriteria): Promise<number>;
}
