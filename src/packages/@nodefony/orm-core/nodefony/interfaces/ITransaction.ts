/**
 * Unité de travail transactionnelle abstraite (commit / rollback / savepoint).
 *
 * Obtenue dans le callback de `IOrm.transaction()`. Les transactions cross-ORM
 * (2PC) ne sont PAS garanties : une transaction porte sur un seul ORM/connexion.
 * La sémantique des savepoints dépend du driver (peut être un no-op).
 */
export interface ITransaction {
  /** Valide définitivement les opérations de la transaction. */
  commit(): Promise<void>;

  /** Annule toutes les opérations depuis le début de la transaction. */
  rollback(): Promise<void>;

  /**
   * Crée un point de sauvegarde nommé pour un rollback partiel ultérieur.
   *
   * @param name - identifiant du savepoint.
   */
  savepoint(name: string): Promise<void>;

  /**
   * Annule jusqu'à un savepoint sans terminer la transaction.
   *
   * @param name - savepoint cible.
   */
  rollbackTo(name: string): Promise<void>;

  /**
   * Expose l'objet transaction natif du driver (trappe bas niveau).
   *
   * @typeParam C - type natif attendu (ex. `Transaction` de l'ORM).
   */
  getNative<C = unknown>(): C;
}
