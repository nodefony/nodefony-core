import type { ClientSession } from "mongoose";
import type { ITransaction } from "@nodefony/orm-core";

/**
 * Adapte une `ClientSession` MongoDB au contrat portable {@link ITransaction}.
 *
 * Obtenue dans le callback de `MongooseOrm.transaction()`, qui gère le
 * commit/abort automatique via `session.withTransaction()`. Les transactions
 * MongoDB **exigent un replica set** (un standalone ne les supporte pas).
 *
 * MongoDB n'a **pas de savepoints** : {@link MongooseTransaction.savepoint} /
 * {@link MongooseTransaction.rollbackTo} sont des no-op documentés (limite du
 * driver, prévue par le contrat).
 */
export class MongooseTransaction implements ITransaction {
  readonly #session: ClientSession;

  /**
   * @param session - session MongoDB transactionnelle sous-jacente.
   */
  constructor(session: ClientSession) {
    this.#session = session;
  }

  /** Valide la transaction (mode non managé). */
  async commit(): Promise<void> {
    await this.#session.commitTransaction();
  }

  /** Annule la transaction (mode non managé). */
  async rollback(): Promise<void> {
    await this.#session.abortTransaction();
  }

  /** No-op : MongoDB ne gère pas les savepoints. */
  async savepoint(_name: string): Promise<void> {
    // Intentionnellement vide — limite du driver MongoDB (cf TSDoc classe).
  }

  /** No-op : MongoDB ne gère pas les savepoints. */
  async rollbackTo(_name: string): Promise<void> {
    // Intentionnellement vide — limite du driver MongoDB.
  }

  /** Expose la `ClientSession` native (trappe bas niveau). */
  getNative<C = unknown>(): C {
    return this.#session as C;
  }
}
