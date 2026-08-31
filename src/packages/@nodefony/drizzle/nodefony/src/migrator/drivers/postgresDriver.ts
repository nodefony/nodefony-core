import { createHash } from "node:crypto";
import type { IMigrationDriver } from "../types";
import { schemaReader, toDollarParams, type ISchemaReader } from "../catalog";
import { MigrationLockTimeoutError } from "../types";

export { toDollarParams };

/**
 * Clé du verrou consultatif PostgreSQL — **figée à vie**.
 *
 * Elle est dérivée par une RÈGLE, pas choisie : les huit premiers octets de
 * `sha256("nodefony:migrations")`, lus en entier signé big-endian. Une identité
 * « gravée » dont la valeur serait tirée au hasard d'un commit ne serait pas
 * gravée du tout — on ne pourrait plus la recalculer pour la vérifier.
 *
 * La changer ferait que deux versions du framework ne s'excluent plus
 * mutuellement : exactement pendant un déploiement, le seul moment qui compte.
 */
export const PG_LOCK_KEY: bigint = createHash("sha256")
  .update("nodefony:migrations")
  .digest()
  .readBigInt64BE(0);

/** Connexion `pg` utilisée par le pilote (surface minimale, typée). */
interface IPgClient {
  connect(): Promise<void>;
  query(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  on(event: "error", listener: (error: Error) => void): unknown;
  end(): Promise<void>;
}

/**
 * Pilote PostgreSQL de l'applicateur — **une seule connexion**, pas un pool.
 *
 * `pg_advisory_lock` est un verrou de SESSION : avec un pool, il serait pris
 * sur une connexion, le DDL exécuté sur une autre et la libération faite sur
 * une troisième — le verrou ne protégerait rien. D'où une connexion tenue du
 * verrou à sa libération.
 *
 * Le verrou s'auto-libère à la mort de la connexion : un process tué en plein
 * vol ne laisse **aucun verrou zombie** à lever à la main. C'est l'argument qui
 * a fait écarter une table de verrou.
 */
export class PostgresMigrationDriver implements IMigrationDriver {
  readonly dialect = "postgres" as const;
  readonly transactionalDdl = true;
  #client: IPgClient | null = null;
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
   * @throws Error si le pilote `pg` n'est pas installé.
   */
  async connect(): Promise<void> {
    let ClientCtor: new (config: { connectionString: string }) => IPgClient;
    try {
      // Interop CJS/ESM : `pg` expose son API sur `default` (CJS) ou en named.
      const ns = (await import("pg")) as unknown as {
        default?: { Client: typeof ClientCtor };
        Client?: typeof ClientCtor;
      };
      const resolved = ns.Client ?? ns.default?.Client;
      if (!resolved) {
        throw new Error("`pg` did not expose a `Client` constructor");
      }
      ClientCtor = resolved;
    } catch (e) {
      throw new Error(
        `Le dialecte postgres exige le pilote optionnel \`pg\` ` +
          `(\`npm i pg\`). ${(e as Error).message}`,
        { cause: e },
      );
    }
    const client = new ClientCtor({ connectionString: this.#url });
    // 🔴 AVANT le connect, pas après. Un `EventEmitter` qui émet `error` sans
    // auditeur LÈVE, et rien n'installe de `uncaughtException` dans le
    // framework : le serveur qui tombe, la session terminée par un
    // administrateur ou un pare-feu qui coupe tueraient le PROCESS de
    // migration, au lieu de rendre une erreur que l'appelant peut lire.
    // Constaté au banc : cinq tests verts qui portaient deux crashs.
    client.on("error", (error: Error) => {
      this.#lost = error?.message ?? String(error);
    });
    await client.connect();
    this.#lost = null;
    this.#client = client;
  }

  /** Connexion ouverte, ou une erreur qui dit quoi faire. */
  get #cx(): IPgClient {
    if (this.#client === null) {
      throw new Error(
        this.#lost === null
          ? "PostgresMigrationDriver : `connect()` n'a pas été appelé."
          : `PostgresMigrationDriver : connexion perdue — ${this.#lost}`,
      );
    }
    return this.#client;
  }

  /** Motif de la perte de connexion, si elle a été constatée. */
  get lostReason(): string | null {
    return this.#lost;
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
    const result = await this.#cx.query(toDollarParams(sql), params);
    return result.rows as T[];
  }

  /** Lecture du catalogue — implémentation PARTAGÉE avec l'ORM. */
  readonly #catalog: ISchemaReader = schemaReader("postgres", (sql, params) =>
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
    return this.exec("BEGIN");
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
   * Prend le verrou consultatif, en attente BORNÉE.
   *
   * `pg_advisory_lock` attend sans limite : un pod bloqué derrière un job mort
   * attendrait pour toujours, sans rien dire. On sonde donc avec
   * `pg_try_advisory_lock` jusqu'au délai imparti, ce qui rend l'attente
   * observable et l'échec explicite.
   *
   * `lock_timeout` est posé pour son VRAI rôle, distinct : borner l'attente des
   * verrous de TABLE que prennent les `ALTER` — sans lui, un `ALTER` coincé
   * derrière une transaction longue bloque toute la table en file d'attente.
   *
   * @param timeoutMs - délai maximal d'attente du verrou.
   * @returns une promesse résolue une fois le verrou tenu.
   * @throws Error si le verrou n'est pas obtenu dans le délai.
   */
  async lock(timeoutMs: number): Promise<void> {
    await this.exec(`SET lock_timeout = '${Math.max(1, timeoutMs)}ms'`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rows = await this.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(?::bigint) AS locked`,
        [PG_LOCK_KEY.toString()],
      );
      if (rows[0]?.locked === true) {
        this.#locked = true;
        return;
      }
      if (Date.now() >= deadline) {
        throw new MigrationLockTimeoutError(
          timeoutMs,
          `Verrou de migration PostgreSQL non obtenu en ${timeoutMs} ms ` +
            `(clé ${PG_LOCK_KEY.toString()}) : une autre migration est en cours.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** @inheritdoc */
  async unlock(): Promise<void> {
    if (!this.#locked) {
      return;
    }
    this.#locked = false;
    await this.query(`SELECT pg_advisory_unlock(?::bigint)`, [
      PG_LOCK_KEY.toString(),
    ]);
  }

  /** @inheritdoc */
  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    this.#locked = false;
    if (client) {
      // Une connexion déjà morte refuse son `end()` : la fermeture est un
      // nettoyage, elle ne doit pas masquer la cause réelle.
      await client.end().catch(() => undefined);
    }
  }
}
