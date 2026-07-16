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
 * Pilotage transactionnel d'**une connexion**, abstrait du driver (INTERNE).
 *
 * Existe parce que les trois drivers pilotent une transaction différemment :
 * `better-sqlite3` est synchrone sur une connexion unique (rien à rendre), là
 * où `pg` et `mysql2` empruntent une connexion DÉDIÉE à leur pool — qu'il faut
 * impérativement rendre, sous peine d'épuiser le pool en quelques transactions.
 * {@link DrizzleTransaction} ne connaît que ce contrat : le choix du driver
 * appartient à la fabrique posée au connect (cf `DrizzleOrm`).
 */
export interface ITxDriver {
  /** Exécute une instruction de contrôle (`COMMIT`, `SAVEPOINT …`). */
  exec(sql: string): Promise<void>;
  /**
   * Cite un identifiant SQL (nom de savepoint) — **trait de dialecte** :
   * `"x"` est l'identifiant standard (postgres, sqlite) mais désigne une CHAÎNE
   * en mysql/mariadb hors mode `ANSI_QUOTES`, qui veut des backticks. D'où la
   * délégation au driver plutôt qu'un quoting en dur ici.
   */
  quoteIdent(name: string): string;
  /**
   * Rend la connexion. **`err` renseigné → la connexion est DÉTRUITE**, jamais
   * recyclée : après un `COMMIT`/`ROLLBACK` en échec, son état transactionnel
   * est inconnu — la rendre au pool contaminerait l'emprunteur suivant avec une
   * transaction ouverte. No-op sur une connexion unique (sqlite).
   */
  release(err?: unknown): void;
}

/**
 * Adapte une transaction SQL au contrat portable {@link ITransaction}, sur les
 * trois dialectes (sqlite, postgres, mysql).
 *
 * **Pourquoi une transaction manuelle (`BEGIN`/`COMMIT`/`ROLLBACK`) et pas le
 * helper `db.transaction()` de Drizzle** : `better-sqlite3` est **synchrone** ;
 * son helper attend un callback synchrone et committe au `return` — donc *avant*
 * que les `await` du contrat async (`IRepository`) ne s'exécutent. Encadrer le
 * travail par `BEGIN`…`COMMIT` garantit que toutes les opérations (ordonnées par
 * les `await`) tombent dans la même transaction.
 *
 * **Une transaction vit sur UNE connexion** : {@link DrizzleTransaction.getNative}
 * rend le db Drizzle lié à cette connexion précise (la connexion unique en
 * sqlite ; une connexion empruntée au pool en postgres/mysql). Un repository
 * n'entre dans la transaction que lié par `withTransaction(tx)` — celui rendu par
 * `orm.getRepository()` passe, lui, par le pool, donc HORS transaction.
 *
 * Mode managé (cf `DrizzleOrm.transaction`) : commit auto si la closure résout,
 * rollback auto si elle rejette. `commit`/`rollback` exposés (idempotents via le
 * drapeau interne) pour un pilotage manuel éventuel.
 */
export class DrizzleTransaction implements ITransaction {
  readonly #db: DrizzleDb;
  readonly #driver: ITxDriver;
  #done = false;

  /**
   * @param db - handle Drizzle lié à la connexion **déjà en `BEGIN`**.
   * @param driver - pilotage transactionnel de cette connexion.
   */
  constructor(db: DrizzleDb, driver: ITxDriver) {
    this.#db = db;
    this.#driver = driver;
  }

  /** Indique si la transaction est déjà terminée (commit ou rollback). */
  isDone(): boolean {
    return this.#done;
  }

  /** Valide la transaction (no-op si déjà terminée). */
  async commit(): Promise<void> {
    await this.#finish("COMMIT");
  }

  /** Annule la transaction (no-op si déjà terminée). */
  async rollback(): Promise<void> {
    await this.#finish("ROLLBACK");
  }

  /**
   * Termine la transaction et rend la connexion — **toujours**, y compris quand
   * l'instruction échoue (sinon le pool fuit une connexion par échec). Le
   * drapeau tombe AVANT l'exécution : un `COMMIT` en échec termine quand même la
   * transaction, et le `rollback()` automatique qui suit doit être un no-op
   * plutôt qu'une seconde instruction sur une connexion déjà rendue.
   *
   * @throws l'erreur du driver, la connexion ayant alors été détruite.
   */
  async #finish(statement: "COMMIT" | "ROLLBACK"): Promise<void> {
    if (this.#done) {
      return;
    }
    this.#done = true;
    try {
      await this.#driver.exec(statement);
      this.#driver.release();
    } catch (error) {
      this.#driver.release(error);
      throw error;
    }
  }

  /** Crée un savepoint nommé (nom validé — anti-injection, cf {@link assertSavepointName}). */
  async savepoint(name: string): Promise<void> {
    this.#assertLive("savepoint");
    assertSavepointName(name);
    await this.#driver.exec(`SAVEPOINT ${this.#driver.quoteIdent(name)}`);
  }

  /** Annule jusqu'au savepoint sans terminer la transaction (nom validé). */
  async rollbackTo(name: string): Promise<void> {
    this.#assertLive("rollbackTo");
    assertSavepointName(name);
    await this.#driver.exec(
      `ROLLBACK TO SAVEPOINT ${this.#driver.quoteIdent(name)}`,
    );
  }

  /**
   * Garde fail-loud : écrire après `commit`/`rollback` viserait une connexion
   * déjà rendue au pool — donc la transaction d'un TIERS, ou aucune. Le dire ici
   * plutôt que laisser le driver rendre une erreur cryptique (ou pire, réussir
   * sur la connexion d'un autre emprunteur).
   *
   * @throws si la transaction est terminée.
   */
  #assertLive(verb: string): void {
    if (this.#done) {
      throw new Error(
        `DrizzleTransaction: ${verb}() called after the transaction ended ` +
          `(its connection was already released).`,
      );
    }
  }

  /** Expose le handle Drizzle lié à la connexion encadrée par la transaction. */
  getNative<C = unknown>(): C {
    return this.#db as C;
  }
}
