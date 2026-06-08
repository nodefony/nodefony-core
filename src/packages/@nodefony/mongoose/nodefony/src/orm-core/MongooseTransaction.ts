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
  #done = false;

  /**
   * @param session - session MongoDB transactionnelle sous-jacente.
   */
  constructor(session: ClientSession) {
    this.#session = session;
  }

  /** Indique si la transaction est déjà terminée (commit ou rollback). */
  isDone(): boolean {
    return this.#done;
  }

  /**
   * Valide la transaction (no-op si déjà terminée — idempotent, parité avec
   * `DrizzleTransaction`). En mode managé (défaut via `IOrm.transaction`), le
   * commit/abort est piloté par `session.withTransaction` : un appel manuel est
   * inutile, et l'idempotence évite un double-commit accidentel.
   */
  async commit(): Promise<void> {
    if (this.#done) {
      return;
    }
    this.#done = true;
    await this.#session.commitTransaction();
  }

  /** Annule la transaction (no-op si déjà terminée — idempotent). */
  async rollback(): Promise<void> {
    if (this.#done) {
      return;
    }
    this.#done = true;
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
