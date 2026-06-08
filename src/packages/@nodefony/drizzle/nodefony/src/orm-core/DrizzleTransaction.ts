import type BetterSqlite3 from "better-sqlite3";
import type { ITransaction } from "@nodefony/orm-core";
import type { DrizzleDb } from "./DrizzleRepository";

/**
 * Nom de savepoint sûr (S1) : un `SAVEPOINT` est un **identifiant** SQL, pas une
 * valeur — il ne peut donc pas être *bindé* en paramètre. Pour éliminer toute
 * injection via un nom non contrôlé (`a"; DROP …`), on impose un identifiant
 * strictement alphanumérique. Un nom invalide échoue **tôt et clairement**.
 */
const SAVEPOINT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertSavepointName(name: string): void {
  if (!SAVEPOINT_NAME.test(name)) {
    throw new Error(
      `DrizzleTransaction: invalid savepoint name ${JSON.stringify(name)} — ` +
        `expected /^[A-Za-z_][A-Za-z0-9_]*$/ (savepoint is an identifier, not a bindable value).`,
    );
  }
}

/**
 * Adapte une transaction `better-sqlite3` au contrat portable {@link ITransaction}.
 *
 * **Pourquoi une transaction manuelle (`BEGIN`/`COMMIT`/`ROLLBACK`) et pas le
 * helper `db.transaction()` de Drizzle** : `better-sqlite3` est **synchrone** ;
 * son helper attend un callback synchrone et committe au `return` — donc *avant*
 * que les `await` du contrat async (`IRepository`) ne s'exécutent. La connexion
 * étant unique et synchrone, encadrer le travail par `BEGIN`…`COMMIT` garantit
 * que toutes les opérations (ordonnées par les `await`) tombent dans la même
 * transaction. {@link DrizzleTransaction.getNative} renvoie donc le **même** db
 * (une seule connexion) : un repository lié via `withTransaction` écrit dedans.
 *
 * Mode managé (cf `DrizzleOrm.transaction`) : commit auto si la closure résout,
 * rollback auto si elle rejette. `commit`/`rollback` exposés (idempotents via le
 * drapeau interne) pour un pilotage manuel éventuel.
 */
export class DrizzleTransaction implements ITransaction {
  readonly #db: DrizzleDb;
  readonly #client: BetterSqlite3.Database;
  #done = false;

  /**
   * @param db - handle Drizzle (connexion unique, déjà en `BEGIN`).
   * @param client - connexion `better-sqlite3` native (pilotage transactionnel).
   */
  constructor(db: DrizzleDb, client: BetterSqlite3.Database) {
    this.#db = db;
    this.#client = client;
  }

  /** Indique si la transaction est déjà terminée (commit ou rollback). */
  isDone(): boolean {
    return this.#done;
  }

  /** Valide la transaction (no-op si déjà terminée). */
  async commit(): Promise<void> {
    if (this.#done) {
      return;
    }
    this.#client.exec("COMMIT");
    this.#done = true;
  }

  /** Annule la transaction (no-op si déjà terminée). */
  async rollback(): Promise<void> {
    if (this.#done) {
      return;
    }
    this.#client.exec("ROLLBACK");
    this.#done = true;
  }

  /** Crée un savepoint nommé (nom validé — anti-injection, cf {@link assertSavepointName}). */
  async savepoint(name: string): Promise<void> {
    assertSavepointName(name);
    this.#client.exec(`SAVEPOINT "${name}"`);
  }

  /** Annule jusqu'au savepoint sans terminer la transaction (nom validé). */
  async rollbackTo(name: string): Promise<void> {
    assertSavepointName(name);
    this.#client.exec(`ROLLBACK TO SAVEPOINT "${name}"`);
  }

  /** Expose le handle Drizzle (connexion unique encadrée par la transaction). */
  getNative<C = unknown>(): C {
    return this.#db as C;
  }
}
