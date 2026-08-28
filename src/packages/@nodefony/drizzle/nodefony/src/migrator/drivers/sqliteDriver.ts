import BetterSqlite3 from "better-sqlite3";
import { schemaReader, type ISchemaReader } from "../catalog";
import { HISTORY_TABLE, type IMigrationDriver } from "../types";

/**
 * Pilote SQLite de l'applicateur — connexion `better-sqlite3` dédiée.
 *
 * **Pas de verrou explicite** : SQLite est à écrivain unique par nature. Ce
 * n'est pas un manque à combler, c'est la description exacte de la situation —
 * la sérialisation est faite par le moteur, et une table de verrou maison ne
 * ferait qu'ajouter une pièce à déverrouiller à la main le jour où un process
 * meurt.
 */
export class SqliteMigrationDriver implements IMigrationDriver {
  readonly dialect = "sqlite" as const;
  readonly transactionalDdl = true;
  readonly #db: BetterSqlite3.Database;

  /**
   * @param filename - fichier de la base, ou `:memory:`.
   */
  constructor(filename: string) {
    this.#db = new BetterSqlite3(filename);
    if (filename !== ":memory:") {
      // Mêmes réglages que l'adapter : une base migrée puis ouverte par
      // l'application ne doit pas changer de mode de journalisation en route.
      this.#db.pragma("journal_mode = WAL");
      this.#db.pragma("synchronous = NORMAL");
    }
  }

  /** @inheritdoc */
  exec(sql: string): Promise<void> {
    this.#db.exec(sql);
    return Promise.resolve();
  }

  /** @inheritdoc */
  query<T extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const statement = this.#db.prepare(sql);
    // `reader` dit si le statement rend des lignes : `all()` sur un INSERT
    // lève chez better-sqlite3, et `run()` sur un SELECT ne rend rien.
    if (!statement.reader) {
      statement.run(...(params as unknown[]));
      return Promise.resolve([]);
    }
    return Promise.resolve(statement.all(...(params as unknown[])) as T[]);
  }

  /** Lecture du catalogue — implémentation PARTAGÉE avec l'ORM. */
  readonly #catalog: ISchemaReader = schemaReader("sqlite", (sql, params) =>
    this.query(sql, params),
  );

  /** @inheritdoc */
  tableExists(table: string): Promise<boolean> {
    return this.#catalog.tableExists(table);
  }

  /** @inheritdoc */
  columnsOf(table: string): Promise<string[]> {
    return this.#catalog.columnsOf(table);
  }

  /** @inheritdoc */
  begin(): Promise<void> {
    // `IMMEDIATE` prend le verrou d'écriture TOUT DE SUITE : sans lui, SQLite
    // n'essaie qu'à la première écriture et peut alors échouer sur une base
    // occupée, une transaction déjà ouverte derrière soi.
    return this.exec("BEGIN IMMEDIATE");
  }

  /** @inheritdoc */
  commit(): Promise<void> {
    return this.exec("COMMIT");
  }

  /** @inheritdoc */
  rollback(): Promise<void> {
    return this.exec("ROLLBACK");
  }

  /** @inheritdoc */
  lock(): Promise<void> {
    return Promise.resolve();
  }

  /** @inheritdoc */
  unlock(): Promise<void> {
    return Promise.resolve();
  }

  /** @inheritdoc */
  close(): Promise<void> {
    this.#db.close();
    return Promise.resolve();
  }

  /** Table d'historique servie par ce pilote — pour les diagnostics. */
  get historyTable(): string {
    return HISTORY_TABLE;
  }
}
