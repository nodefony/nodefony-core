// `import type` UNIQUEMENT : le pilote est chargé en LAZY par `connect()`, au
// même titre que `pg` et `mysql2` chez ses deux voisins. Un import de VALEUR
// ferait de ce binaire natif une dépendance dure de toute application.
import type BetterSqlite3 from "better-sqlite3";
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
  #database: BetterSqlite3.Database | null = null;
  readonly #filename: string;

  /**
   * @param filename - fichier de la base, ou `:memory:`.
   */
  constructor(filename: string) {
    this.#filename = filename;
  }

  /**
   * La base, ou l'erreur qui dit ce qu'il manque.
   *
   * Un accès avant `connect()` est une faute de programmation, pas un cas
   * d'exécution : le message le dit plutôt que de laisser tomber un
   * `Cannot read properties of null` à trois appels de là.
   */
  get #db(): BetterSqlite3.Database {
    if (!this.#database) {
      throw new Error(
        "SqliteMigrationDriver : `connect()` n'a pas été appelé — le pilote " +
          "`better-sqlite3` est chargé à la demande, comme `pg` et `mysql2`.",
      );
    }
    return this.#database;
  }

  /**
   * Ouvre la base, en chargeant le pilote à la demande.
   *
   * Même patron que `PostgresMigrationDriver.connect()` : `openMigrationDriver`
   * enchaîne `new` puis `await connect()` pour les trois dialectes, et aucune
   * application n'embarque un pilote qu'elle n'ouvre pas.
   *
   * @throws Error si le pilote `better-sqlite3` n'est pas installé.
   */
  async connect(): Promise<void> {
    let Sqlite: new (filename: string) => BetterSqlite3.Database;
    try {
      // Interop CJS/ESM : `better-sqlite3` expose son constructeur sur
      // `default` (CJS) — on lit les deux formes plutôt que de parier sur
      // l'empaquetage d'une version.
      const ns = (await import("better-sqlite3")) as unknown as {
        default?: typeof Sqlite;
      };
      const resolved = ns.default ?? (ns as unknown as typeof Sqlite);
      if (typeof resolved !== "function") {
        throw new Error("`better-sqlite3` did not expose a constructor");
      }
      Sqlite = resolved;
    } catch (e) {
      throw new Error(
        "Le dialecte sqlite exige le pilote optionnel `better-sqlite3` " +
          `(\`npm i better-sqlite3\`). ${(e as Error).message}`,
        { cause: e },
      );
    }
    const db = new Sqlite(this.#filename);
    if (this.#filename !== ":memory:") {
      // Mêmes réglages que l'adapter : une base migrée puis ouverte par
      // l'application ne doit pas changer de mode de journalisation en route.
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
    }
    this.#database = db;
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
  sameColumnName(declared: string, actual: string): boolean {
    return this.#catalog.sameColumnName(declared, actual);
  }

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
    // Fermer ce qui n'a jamais été ouvert est un cas NORMAL depuis que le
    // pilote se charge à la demande — un décor qui renonce entre le `new` et
    // le `connect()` ne doit pas lever ici.
    this.#database?.close();
    this.#database = null;
    return Promise.resolve();
  }

  /** Table d'historique servie par ce pilote — pour les diagnostics. */
  get historyTable(): string {
    return HISTORY_TABLE;
  }
}
