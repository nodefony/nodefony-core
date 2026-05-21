import type { Sequelize, Transaction } from "sequelize";
import type { ITransaction } from "@nodefony/orm-core";

/**
 * Adapte une transaction Sequelize au contrat portable {@link ITransaction}.
 *
 * Obtenue dans le callback de `SequelizeOrm.transaction()`, qui gère le
 * commit/rollback automatique (commit si la closure résout, rollback si elle
 * rejette). Les méthodes {@link SequelizeTransaction.commit} /
 * {@link SequelizeTransaction.rollback} sont exposées pour un contrôle manuel
 * (mode non managé) mais ne doivent PAS être appelées dans le callback managé
 * (double commit). Les savepoints utilisent du SQL brut via la connexion.
 */
export class SequelizeTransaction implements ITransaction {
  readonly #sequelize: Sequelize;
  readonly #tx: Transaction;

  /**
   * @param sequelize - connexion native (pour les requêtes savepoint).
   * @param tx - transaction Sequelize sous-jacente.
   */
  constructor(sequelize: Sequelize, tx: Transaction) {
    this.#sequelize = sequelize;
    this.#tx = tx;
  }

  /** Valide définitivement la transaction. */
  async commit(): Promise<void> {
    await this.#tx.commit();
  }

  /** Annule toutes les opérations de la transaction. */
  async rollback(): Promise<void> {
    await this.#tx.rollback();
  }

  /** Crée un savepoint nommé (SQL brut sur la connexion transactionnelle). */
  async savepoint(name: string): Promise<void> {
    await this.#sequelize.query(`SAVEPOINT ${name}`, { transaction: this.#tx });
  }

  /** Annule jusqu'au savepoint sans terminer la transaction. */
  async rollbackTo(name: string): Promise<void> {
    await this.#sequelize.query(`ROLLBACK TO SAVEPOINT ${name}`, {
      transaction: this.#tx,
    });
  }

  /** Expose la transaction Sequelize native (trappe bas niveau). */
  getNative<C = unknown>(): C {
    return this.#tx as C;
  }
}
