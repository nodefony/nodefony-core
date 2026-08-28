import type { IMigrationDriver } from "../types";

/**
 * Préfixe de l'identité du verrou MySQL — **contrat inter-versions**.
 *
 * Au même titre que le nom de la table d'historique : deux versions du
 * framework qui ne s'excluent plus, c'est pendant un déploiement que ça se
 * paie.
 */
export const MYSQL_LOCK_PREFIX = "nodefony:migrations:";

/**
 * Expression SQL de l'identité du verrou — évaluée par le SERVEUR.
 *
 * **Pourquoi qualifier par `DATABASE()`** : `GET_LOCK` est global au SERVEUR,
 * pas à la base. Sans cette qualification, deux applications sans aucun rapport
 * hébergées sur la même instance se sérialiseraient — en silence, ce qui est le
 * pire des symptômes.
 *
 * **Pourquoi un repli haché** : MySQL borne le nom d'un verrou à 64 caractères
 * (MariaDB est plus permissif, mais c'est la contrainte la plus stricte qui
 * fait règle). Le préfixe en consomme 20 ; au-delà de 44 caractères de nom de
 * base, l'appel échouerait — et l'échec d'un verrou est un blocage total, avec
 * un message que rien ne rattache au nom de la base. Le repli reste
 * DÉTERMINISTE (fonction du seul nom de base), donc deux versions du framework
 * calculent toujours la même identité : le contrat tient.
 */
export const MYSQL_LOCK_NAME_SQL =
  `IF(CHAR_LENGTH(DATABASE()) <= 44, ` +
  `CONCAT('${MYSQL_LOCK_PREFIX}', DATABASE()), ` +
  `CONCAT('${MYSQL_LOCK_PREFIX}#', LEFT(SHA2(DATABASE(), 256), 32)))`;

/** Connexion `mysql2/promise` utilisée par le pilote (surface minimale). */
interface IMysqlConnection {
  query(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]>;
  on(event: "error", listener: (error: Error) => void): unknown;
  end(): Promise<void>;
}

/**
 * Pilote MySQL / MariaDB de l'applicateur — **une seule connexion**.
 *
 * `GET_LOCK` est un verrou de SESSION : un pool le rendrait inopérant. Il
 * s'auto-libère à la mort de la connexion — aucun verrou zombie.
 *
 * 🔴 **Le DDL n'est PAS transactionnel ici** : un `CREATE TABLE` valide
 * implicitement la transaction en cours. Un échec à mi-course laisse donc la
 * base dans un état partiel, avec un marqueur d'échec persistant — et c'est
 * exactement pourquoi il ne doit JAMAIS y avoir de reprise aveugle : c'est la
 * réparation, après inspection humaine, qui tranche.
 */
export class MysqlMigrationDriver implements IMigrationDriver {
  readonly dialect = "mysql" as const;
  readonly transactionalDdl = false;
  #cxOrNull: IMysqlConnection | null = null;
  #locked = false;
  #lost: string | null = null;
  readonly #url: string;

  /**
   * @param url - URL de connexion DIRECTE au serveur.
   */
  constructor(url: string) {
    this.#url = url;
  }

  /**
   * Ouvre la connexion dédiée.
   *
   * @throws Error si le pilote `mysql2` n'est pas installé.
   */
  async connect(): Promise<void> {
    let createConnection: (url: string) => Promise<IMysqlConnection>;
    try {
      const ns = (await import("mysql2/promise")) as unknown as {
        default?: { createConnection: typeof createConnection };
        createConnection?: typeof createConnection;
      };
      const resolved = ns.createConnection ?? ns.default?.createConnection;
      if (!resolved) {
        throw new Error("`mysql2` did not expose `createConnection`");
      }
      createConnection = resolved;
    } catch (e) {
      throw new Error(
        `Le dialecte mysql exige le pilote optionnel \`mysql2\` ` +
          `(\`npm i mysql2\`). ${(e as Error).message}`,
        { cause: e },
      );
    }
    const cx = await createConnection(this.#url);
    // Même raison qu'en PostgreSQL : un `KILL` de la session, un serveur qui
    // redémarre ou un pare-feu qui coupe émettent `error` sur la connexion.
    // Sans auditeur, l'émission LÈVE et tue le process de migration.
    cx.on("error", (error: Error) => {
      this.#lost = error?.message ?? String(error);
    });
    this.#lost = null;
    this.#cxOrNull = cx;
  }

  /** Connexion ouverte, ou une erreur qui dit quoi faire. */
  /** Motif de la perte de connexion, si elle a été constatée. */
  get lostReason(): string | null {
    return this.#lost;
  }

  get #cx(): IMysqlConnection {
    if (this.#cxOrNull === null) {
      throw new Error(
        this.#lost === null
          ? "MysqlMigrationDriver : `connect()` n'a pas été appelé."
          : `MysqlMigrationDriver : connexion perdue — ${this.#lost}`,
      );
    }
    return this.#cxOrNull;
  }

  /** @inheritdoc */
  async exec(sql: string): Promise<void> {
    await this.#cx.query(sql);
  }

  /** @inheritdoc */
  async query<T extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const [rows] = await this.#cx.query(sql, params);
    return Array.isArray(rows) ? (rows as T[]) : [];
  }

  /** @inheritdoc */
  async tableExists(table: string): Promise<boolean> {
    const rows = await this.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM information_schema.tables ` +
        `WHERE table_schema = DATABASE() AND table_name = ?`,
      [table],
    );
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /** @inheritdoc */
  async columnsOf(table: string): Promise<string[]> {
    // `AS name` : MySQL rend `COLUMN_NAME` et MariaDB `column_name` selon la
    // version — un alias explicite évite de dépendre de la casse rendue.
    const rows = await this.query<{ name: string }>(
      `SELECT column_name AS name FROM information_schema.columns ` +
        `WHERE table_schema = DATABASE() AND table_name = ?`,
      [table],
    );
    return rows.map((row) => String(row.name));
  }

  /** @inheritdoc */
  begin(): Promise<void> {
    return this.exec("START TRANSACTION");
  }

  /** @inheritdoc */
  commit(): Promise<void> {
    return this.exec("COMMIT");
  }

  /** @inheritdoc */
  rollback(): Promise<void> {
    return this.exec("ROLLBACK");
  }

  /**
   * Prend le verrou nommé, avec le délai natif de `GET_LOCK`.
   *
   * @param timeoutMs - délai maximal d'attente.
   * @throws Error si le verrou n'est pas obtenu dans le délai.
   */
  async lock(timeoutMs: number): Promise<void> {
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const rows = await this.query<{ got: number | null }>(
      `SELECT GET_LOCK(${MYSQL_LOCK_NAME_SQL}, ?) AS got`,
      [seconds],
    );
    const got = rows[0]?.got;
    if (Number(got) !== 1) {
      throw new Error(
        `Verrou de migration MySQL non obtenu en ${timeoutMs} ms ` +
          `(${got === null ? "erreur du serveur" : "délai dépassé"}) : ` +
          `une autre migration est en cours sur cette base.`,
      );
    }
    this.#locked = true;
  }

  /** @inheritdoc */
  async unlock(): Promise<void> {
    if (!this.#locked) {
      return;
    }
    this.#locked = false;
    await this.query(`SELECT RELEASE_LOCK(${MYSQL_LOCK_NAME_SQL}) AS released`);
  }

  /** @inheritdoc */
  async close(): Promise<void> {
    const cx = this.#cxOrNull;
    this.#cxOrNull = null;
    this.#locked = false;
    if (cx) {
      // Une connexion déjà morte refuse son `end()` : la fermeture est un
      // nettoyage, elle ne doit pas masquer la cause réelle.
      await cx.end().catch(() => undefined);
    }
  }
}
