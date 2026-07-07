import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import BetterSqlite3 from "better-sqlite3";
import { is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  getTableConfig as getPgTableConfig,
  PgTable,
} from "drizzle-orm/pg-core";
import {
  getTableConfig as getMysqlTableConfig,
  MySqlTable,
} from "drizzle-orm/mysql-core";
// `import type` UNIQUEMENT (effacé à la compilation) → @types/pg et les types
// embarqués de mysql2 servent au typage, les drivers runtime sont des
// `optionalDependencies` chargées en LAZY (`await import`) dans `#connectPostgres`
// / `#connectMysql` (jamais au top-level : un déploiement SQLite n'a ni pg ni mysql2).
import type { Pool } from "pg";
import type { Pool as MysqlPool } from "mysql2/promise";
import { Orm, entityRegistry } from "@nodefony/orm-core";
import type {
  IColumnInfo,
  IConnectionInfo,
  IEntity,
  IEntityRelation,
  IOrmProbe,
  IRepository,
  ITransaction,
} from "@nodefony/orm-core";
import {
  DrizzleRepository,
  type DrizzleDb,
  type DrizzleTable,
  type DrizzleResolvedRelation,
} from "./DrizzleRepository";
import { DrizzleTransaction } from "./DrizzleTransaction";
import type { SqlDialect } from "../../interfaces/IDrizzleConfig";

/** Options de connexion de l'adapter Drizzle (driver selon `dialect`). */
export interface DrizzleOrmOptions {
  /**
   * Dialecte SQL : `sqlite` (défaut, driver better-sqlite3) · `postgres` (driver
   * `pg`, lazy) · `mysql` (driver `mysql2`, lazy). Sélectionne le client ET la
   * variante de table que les entités enregistrent.
   */
  dialect?: SqlDialect;
  /** Fichier SQLite (`":memory:"` par défaut) — dialecte `sqlite` uniquement. */
  filename?: string;
  /**
   * Chaîne de connexion (`postgres://…`, `mysql://…`) — dialectes `postgres`/
   * `mysql`. Requise pour ces dialectes.
   */
  url?: string;
}

/**
 * Sous-ensemble structural d'une colonne Drizzle utilisé pour dériver le DDL
 * (dev/test) — satisfait par `SQLiteColumn` ET `PgColumn` → générateur de
 * `CREATE TABLE` partagé entre dialectes ({@link DrizzleOrm.buildCreateTable}).
 */
interface DDLColumn {
  name: string;
  primary: boolean;
  notNull: boolean;
  isUnique?: boolean;
  getSQLType(): string;
}

/**
 * Adapter Drizzle (driver `better-sqlite3`) **branché sur `@nodefony/orm-core`**
 * — 3ᵉ adapter du banc multi-ORM (P7.4), choix SQL #1 moderne.
 *
 * Particularité vs les autres ORM : Drizzle est **schema-as-code** — il n'y
 * a pas de « compilation » de modèle. `entity.schema` *est* déjà une table
 * Drizzle (`sqliteTable(...)`). L'adapter :
 * - dérive le DDL de chaque table via `getTableConfig()` et le crée (dev/test ;
 *   la prod passera par `drizzle-kit`) — pas de `sync()` natif côté Drizzle ;
 * - résout les relations déclaratives ({@link IEntityRelation}) en métadonnées
 *   d'**eager-load manuel** (cf {@link DrizzleRepository}), pour rester générique
 *   sans imposer la couche `relations()` de Drizzle ;
 * - pilote les transactions à la main (`BEGIN`/`COMMIT`/`ROLLBACK`) car
 *   `better-sqlite3` est synchrone (cf {@link DrizzleTransaction}).
 *
 * Trappe SQL brut : {@link DrizzleOrm.getNativeConnection} expose le db Drizzle
 * (tag `sql`) pour les jointures arbitraires (ADR-0003 risque #1).
 */
export class DrizzleOrm extends Orm {
  #client: BetterSqlite3.Database | null = null;
  /** Pool `pg` (dialecte postgres) — `null` hors postgres ou non connecté. */
  #pgPool: Pool | null = null;
  /** Pool `mysql2/promise` (dialecte mysql) — `null` hors mysql ou non connecté. */
  #mysqlPool: MysqlPool | null = null;
  #db: DrizzleDb | null = null;
  #connected = false;
  /**
   * Tables Drizzle indexées par nom logique d'entité (lazy) — union
   * multi-dialecte {@link DrizzleTable} (variante sqlite OU pg selon le
   * connecteur), consommée telle quelle par le `DrizzleRepository` porté.
   */
  #tables: Record<string, DrizzleTable> | null = null;
  /** Relations résolues : entité → champ → relation eager-load (lazy). */
  #relations: Record<string, Record<string, DrizzleResolvedRelation>> | null =
    null;
  /** Repositories mémoïsés par nom d'entité (lazy). */
  #repositories: Record<string, IRepository> | null = null;
  readonly #dialect: SqlDialect;
  readonly #filename: string;
  readonly #url: string | undefined;

  /**
   * @param name - clé unique de l'ORM dans le `ormRegistry` (ex. `"db_test"`).
   * @param options - options de connexion (`dialect`, `filename` sqlite, `url` pg).
   */
  constructor(name: string, options: DrizzleOrmOptions = {}) {
    super(name);
    this.#dialect = options.dialect ?? "sqlite";
    this.#filename = options.filename ?? ":memory:";
    this.#url = options.url;
  }

  /** Dialecte SQL de ce connecteur. */
  get dialect(): SqlDialect {
    return this.#dialect;
  }

  /**
   * Emplacement PHYSIQUE lisible de la base, pour l'écran Studio « Stores »
   * (« où sont écrites mes données ? »). Fichier SQLite **relativisé** au cwd
   * (anti info-leak, cf {@link DrizzleOrm.#safeTarget}) — `undefined` pour
   * `:memory:` (volatil) et pour un backend RÉSEAU (postgres/mysql), dont
   * l'emplacement EST l'infra déclarée, déjà surfacée à part (le Studio dérive
   * alors « backend réseau — voir l'infra »). Stable dès la construction
   * (`#filename` fixé au ctor, indépendant du connect).
   */
  get location(): string | undefined {
    if (this.#dialect !== "sqlite" || this.#filename === ":memory:") {
      return undefined;
    }
    return this.#safeTarget();
  }

  /** Entités enregistrées dans `entityRegistry` ciblant cet ORM. */
  #ownEntities(): IEntity[] {
    return entityRegistry.list().filter((entity) => entity.orm === this.name);
  }

  /** FK déterministe camelCase `<entité>Id` (parité avec Mongoose). */
  #foreignKey(entityName: string): string {
    return `${entityName.charAt(0).toLowerCase()}${entityName.slice(1)}Id`;
  }

  /**
   * Générateur de `CREATE TABLE IF NOT EXISTS` partagé entre dialectes (dev/test).
   * Émet uniquement les contraintes colonne (PK / NOT NULL / UNIQUE) à partir du
   * type SQL natif de chaque colonne (`getSQLType()` rend `text`/`integer` en
   * SQLite, `text`/`bigint`/`jsonb` en Postgres, `varchar(512)`/`json` en MySQL
   * → DDL adapté sans code spécifique). Le quoting d'identifiants diverge :
   * `"…"` (SQL standard, SQLite/PG) vs backtick MySQL (qui ne lit `"…"` qu'en
   * mode ANSI_QUOTES, jamais garanti). La prod reste pilotée par drizzle-kit.
   */
  #buildCreateTable(name: string, columns: DDLColumn[], quote = '"'): string {
    const defs = columns.map((col) => {
      const parts = [`${quote}${col.name}${quote}`, col.getSQLType()];
      if (col.primary) {
        parts.push("PRIMARY KEY");
      }
      if (col.notNull) {
        parts.push("NOT NULL");
      }
      if (col.isUnique) {
        parts.push("UNIQUE");
      }
      return parts.join(" ");
    });
    return `CREATE TABLE IF NOT EXISTS ${quote}${name}${quote} (${defs.join(", ")})`;
  }

  /** Dérive le `CREATE TABLE` SQLite depuis la table Drizzle (dev/test). */
  #createTableSQL(table: SQLiteTable): string {
    const { name, columns } = getTableConfig(table);
    return this.#buildCreateTable(name, columns);
  }

  /** Dérive le `CREATE TABLE` Postgres depuis la table Drizzle (dev/test). */
  #createTablePgSQL(table: PgTable): string {
    const { name, columns } = getPgTableConfig(table);
    return this.#buildCreateTable(name, columns);
  }

  /** Dérive le `CREATE TABLE` MySQL depuis la table Drizzle (dev/test). */
  #createTableMysqlSQL(table: MySqlTable): string {
    const { name, columns } = getMysqlTableConfig(table);
    return this.#buildCreateTable(name, columns, "`");
  }

  /** Résout les relations déclaratives d'une entité en métadonnées eager-load. */
  #resolveRelations(
    entity: IEntity,
    tables: Record<string, DrizzleTable>,
  ): Record<string, DrizzleResolvedRelation> {
    const resolved: Record<string, DrizzleResolvedRelation> = {};
    for (const relation of entity.relations ?? []) {
      const target = tables[relation.target];
      if (!target) {
        throw new Error(
          `DrizzleOrm "${this.name}": relation target "${relation.target}" ` +
            `(from "${entity.name}.${relation.field}") not registered for this ORM.`,
        );
      }
      resolved[relation.field] = this.#resolveOne(entity, relation, target);
    }
    return resolved;
  }

  /** Construit une relation résolue (FK déterministe selon la cardinalité). */
  #resolveOne(
    entity: IEntity,
    relation: IEntityRelation,
    target: DrizzleTable,
  ): DrizzleResolvedRelation {
    switch (relation.type) {
      case "one-to-many":
        // FK sur la cible, nommée d'après la source (`userId` sur Room).
        return {
          type: "one-to-many",
          targetTable: target,
          foreignKey: relation.foreignKey ?? this.#foreignKey(entity.name),
          localKey: "id",
          targetKey: "id",
        };
      case "many-to-one":
      case "one-to-one":
        // FK sur la source, nommée d'après la cible.
        return {
          type: relation.type,
          targetTable: target,
          foreignKey: relation.foreignKey ?? this.#foreignKey(relation.target),
          localKey: "id",
          targetKey: "id",
        };
      case "many-to-many":
        throw new Error(
          `DrizzleOrm "${this.name}": many-to-many ("${entity.name}.${relation.field}") ` +
            `non portable — déclarer via getNativeConnection().`,
        );
    }
  }

  protected async onConnect(): Promise<void> {
    this.#tables = Object.create(null) as Record<string, DrizzleTable>;
    this.#relations = Object.create(null) as Record<
      string,
      Record<string, DrizzleResolvedRelation>
    >;
    const entities = this.#ownEntities();

    // 1) Connexion + DDL dérivé (schema-as-code) selon le dialecte.
    switch (this.#dialect) {
      case "sqlite":
        this.#connectSqlite(entities);
        break;
      case "postgres":
        await this.#connectPostgres(entities);
        break;
      case "mysql":
        await this.#connectMysql(entities);
        break;
    }

    // 2) Résolution des relations déclaratives (eager-load manuel) — commun.
    for (const entity of entities) {
      this.#relations[entity.name] = this.#resolveRelations(
        entity,
        this.#tables,
      );
    }
    this.#connected = true;
  }

  /** Connexion SQLite (better-sqlite3, synchrone) + création des tables (dev/test). */
  #connectSqlite(entities: IEntity[]): void {
    const client = new BetterSqlite3(this.#filename);
    // WAL : lectures concurrentes des écritures + meilleure durabilité — indispensable
    // dès qu'on assume sqlite en prod mono-nœud (défaut « sqlite partout », cf Rails 8).
    // `synchronous=NORMAL` = compromis sûr+rapide recommandé AVEC WAL. Sans objet sur
    // `:memory:` (pas de fichier journal) → gaté sur un fichier réel.
    if (this.#filename !== ":memory:") {
      client.pragma("journal_mode = WAL");
      client.pragma("synchronous = NORMAL");
    }
    this.#client = client;
    this.#db = drizzle(client);
    for (const entity of entities) {
      this.#assertDialectTable(entity, SQLiteTable, "sqlite");
      const table = entity.schema as SQLiteTable;
      this.#tables![entity.name] = table;
      entity.model = table;
      client.exec(this.#createTableSQL(table));
    }
  }

  /**
   * Garde fail-loud : une entité dont la table n'est pas du dialecte du
   * connecteur (ex. variante sqlite enregistrée sur un connecteur postgres)
   * doit échouer avec un message ACTIONNABLE — pas le `TypeError: Cannot
   * convert undefined or null to object` cryptique de `getTableConfig`.
   */
  #assertDialectTable(
    entity: IEntity,
    tableCtor: typeof SQLiteTable | typeof PgTable | typeof MySqlTable,
    dialect: string,
  ): void {
    if (!is(entity.schema as Record<string, unknown>, tableCtor)) {
      throw new Error(
        `DrizzleOrm "${this.name}" (${dialect}): entity "${entity.name}" is not ` +
          `ported to this dialect (its schema is not a ${dialect} table). Port it ` +
          `via a createXTable("${dialect}") factory, or keep this connector on a ` +
          `dialect the entity supports (multi-dialect worksite).`,
      );
    }
  }

  /**
   * Connexion **Postgres** : le driver `pg` (optionalDependency) et l'adapter
   * `drizzle-orm/node-postgres` sont chargés en LAZY (`await import`) — un
   * déploiement SQLite ne les tire jamais. Pool partagé ; DDL dérivé pour dev/test
   * (prod = drizzle-kit). Échec d'import → message actionnable (`npm i pg`).
   */
  async #connectPostgres(entities: IEntity[]): Promise<void> {
    if (!this.#url) {
      throw new Error(
        `DrizzleOrm "${this.name}": dialect "postgres" requires a connection \`url\`.`,
      );
    }
    let PoolCtor: new (config: { connectionString?: string }) => Pool;
    let pgDrizzle: (client: Pool) => unknown;
    try {
      // Interop CJS/ESM : `pg` expose son API sur `default` (CJS) ou en named.
      const pgNs = (await import("pg")) as unknown as {
        default?: { Pool: typeof PoolCtor };
        Pool?: typeof PoolCtor;
      };
      const resolved = pgNs.Pool ?? pgNs.default?.Pool;
      if (!resolved) {
        throw new Error("`pg` did not expose a `Pool` constructor");
      }
      PoolCtor = resolved;
      pgDrizzle = (await import("drizzle-orm/node-postgres"))
        .drizzle as unknown as (client: Pool) => unknown;
    } catch (e) {
      throw new Error(
        `DrizzleOrm "${this.name}": the postgres dialect needs the optional ` +
          `driver \`pg\` (run \`npm i pg\`). ${(e as Error).message}`,
      );
    }
    const pool = new PoolCtor({ connectionString: this.#url });
    this.#pgPool = pool;
    this.#db = pgDrizzle(pool) as DrizzleDb;
    for (const entity of entities) {
      this.#assertDialectTable(entity, PgTable, "postgres");
      const table = entity.schema as PgTable;
      this.#tables![entity.name] = table;
      entity.model = table;
      await pool.query(this.#createTablePgSQL(table));
    }
  }

  /**
   * Connexion **MySQL** : le driver `mysql2` (optionalDependency) et l'adapter
   * `drizzle-orm/mysql2` sont chargés en LAZY (`await import`) — même patron que
   * `#connectPostgres`. Pool promise ouvert en `timezone: "Z"` : les colonnes
   * `datetime(3)` (kind `dateMs` du colKit) sont écrites/relues en UTC — mêmes
   * instants que `timestamptz` PG, sans dépendre de la timezone du serveur.
   */
  async #connectMysql(entities: IEntity[]): Promise<void> {
    if (!this.#url) {
      throw new Error(
        `DrizzleOrm "${this.name}": dialect "mysql" requires a connection \`url\`.`,
      );
    }
    let pool: MysqlPool;
    let mysqlDrizzle: (client: MysqlPool) => unknown;
    try {
      const mysqlNs = (await import("mysql2/promise")) as unknown as {
        default?: { createPool: (opts: unknown) => MysqlPool };
        createPool?: (opts: unknown) => MysqlPool;
      };
      const createPool = mysqlNs.createPool ?? mysqlNs.default?.createPool;
      if (!createPool) {
        throw new Error("`mysql2/promise` did not expose `createPool`");
      }
      mysqlDrizzle = (await import("drizzle-orm/mysql2"))
        .drizzle as unknown as (client: MysqlPool) => unknown;
      pool = createPool({ uri: this.#url, timezone: "Z" });
    } catch (e) {
      throw new Error(
        `DrizzleOrm "${this.name}": the mysql dialect needs the optional ` +
          `driver \`mysql2\` (run \`npm i mysql2\`). ${(e as Error).message}`,
      );
    }
    this.#mysqlPool = pool;
    this.#db = mysqlDrizzle(pool) as DrizzleDb;
    for (const entity of entities) {
      this.#assertDialectTable(entity, MySqlTable, "mysql");
      const table = entity.schema as MySqlTable;
      this.#tables![entity.name] = table;
      entity.model = table;
      await pool.query(this.#createTableMysqlSQL(table));
    }
  }

  async disconnect(): Promise<void> {
    if (this.#client) {
      this.#client.close();
    }
    if (this.#pgPool) {
      await this.#pgPool.end();
    }
    if (this.#mysqlPool) {
      await this.#mysqlPool.end();
    }
    this.#client = null;
    this.#pgPool = null;
    this.#mysqlPool = null;
    this.#db = null;
    this.#connected = false;
    this.#tables = null;
    this.#relations = null;
    this.#repositories = null;
  }

  isConnected(): boolean {
    return this.#connected;
  }

  getRepository<T = unknown>(name: string): IRepository<T> {
    const table = this.#tables?.[name];
    if (!table || !this.#db) {
      throw new Error(
        `DrizzleOrm "${this.name}": no entity table registered under "${name}".`,
      );
    }
    if (this.#repositories === null) {
      this.#repositories = Object.create(null) as Record<string, IRepository>;
    }
    let repository = this.#repositories[name];
    if (repository === undefined) {
      repository = new DrizzleRepository(
        this.#db,
        table,
        this.#relations?.[name] ?? {},
        this.name,
        this.#dialect,
      );
      this.#repositories[name] = repository;
    }
    return repository as IRepository<T>;
  }

  async transaction<R>(work: (tx: ITransaction) => Promise<R>): Promise<R> {
    const db = this.#db;
    const client = this.#client;
    if (!db || !client) {
      throw new Error(`DrizzleOrm "${this.name}": not connected.`);
    }
    // Transaction manuelle : better-sqlite3 est synchrone, le helper Drizzle
    // committe avant les `await` du contrat async (cf DrizzleTransaction).
    client.exec("BEGIN");
    const tx = new DrizzleTransaction(db, client);
    try {
      const result = await work(tx);
      await tx.commit(); // no-op si la closure a déjà commit/rollback
      return result;
    } catch (error) {
      await tx.rollback(); // no-op si déjà terminée
      throw error;
    }
  }

  getNativeConnection<C = unknown>(): C {
    if (!this.#db) {
      throw new Error(`DrizzleOrm "${this.name}": not connected.`);
    }
    return this.#db as C;
  }

  /**
   * Ping bas-coût : `SELECT 1` via le client `better-sqlite3` (synchrone).
   * Mesure un round-trip réel vers le fichier SQLite pour le diagnostic.
   *
   * @throws si le client n'est pas connecté.
   */
  async ping(): Promise<void> {
    if (this.#pgPool) {
      await this.#pgPool.query("SELECT 1");
      return;
    }
    if (this.#mysqlPool) {
      await this.#mysqlPool.query("SELECT 1");
      return;
    }
    if (!this.#client) {
      throw new Error(`DrizzleOrm "${this.name}": not connected.`);
    }
    this.#client.prepare("SELECT 1").get();
  }

  /**
   * Sonde de stockage SQLite via PRAGMA (synchrone, bon marché) : taille
   * (`page_count × page_size`), mode de journal (WAL ?), pages libres
   * (fragmentation). Best-effort — `{}` si non connecté ou PRAGMA indisponible.
   *
   * @returns sonde `storage` + `extra` (driver), ou `{}`.
   */
  async probe(): Promise<IOrmProbe> {
    const client = this.#client;
    if (!client) return {};
    try {
      const num = (sql: string, key: string): number | undefined => {
        const row = client.prepare(sql).get() as Record<string, unknown>;
        const v = row?.[key];
        return typeof v === "number" ? v : undefined;
      };
      const str = (sql: string, key: string): string | undefined => {
        const row = client.prepare(sql).get() as Record<string, unknown>;
        const v = row?.[key];
        return typeof v === "string" ? v : undefined;
      };
      const pages = num("PRAGMA page_count", "page_count");
      const pageSize = num("PRAGMA page_size", "page_size");
      return {
        storage: {
          pages,
          pageSize,
          sizeBytes:
            pages !== undefined && pageSize !== undefined
              ? pages * pageSize
              : undefined,
          journalMode: str("PRAGMA journal_mode", "journal_mode"),
          freePages: num("PRAGMA freelist_count", "freelist_count"),
        },
        extra: { connections: 1 },
      };
    } catch {
      return {};
    }
  }

  /**
   * Colonnes normalisées d'une entité, dérivées du DDL Drizzle
   * (`getTableConfig`) — alimente le graphe canonique / ERD / contexte IA.
   *
   * @param name - nom logique de l'entité.
   * @returns colonnes (`[]` si l'entité n'est pas connue de cet ORM).
   */
  override describeEntity(name: string): IColumnInfo[] {
    const table = this.#tables?.[name];
    if (!table) {
      return [];
    }
    const columns: DDLColumn[] =
      this.#dialect === "postgres"
        ? getPgTableConfig(table as PgTable).columns
        : this.#dialect === "mysql"
          ? getMysqlTableConfig(table as MySqlTable).columns
          : getTableConfig(table as SQLiteTable).columns;
    return columns.map((col) => ({
      name: col.name,
      type: col.getSQLType(),
      primaryKey: col.primary,
      nullable: !col.notNull,
      unique: col.isUnique ?? false,
    }));
  }

  /**
   * Décrit la connexion : driver `sqlite` (better-sqlite3) + cible (chemin du
   * fichier, `:memory:` pour les tests). Aucun credential (SQLite = fichier local).
   * Le chemin est **relativisé** à la racine du process : on ne fuite jamais
   * l'arborescence absolue du serveur (home, structure FS) dans le data plane.
   *
   * @returns driver + cible (chemin relatif, basename si hors projet, ou `:memory:`).
   */
  override describeConnection(): IConnectionInfo {
    if (this.#dialect === "postgres" || this.#dialect === "mysql") {
      // Cible réseau sans credentials (jamais l'user/password de l'`url` dans
      // le data plane).
      return {
        driver: this.#dialect,
        target: this.#safeUrlTarget(
          this.#dialect,
          this.#dialect === "postgres" ? "5432" : "3306",
        ),
        ormVersion: DrizzleOrm.#ormVersion(),
      };
    }
    return {
      driver: "sqlite",
      target: this.#safeTarget(),
      version: this.#sqliteVersion(),
      ormVersion: DrizzleOrm.#ormVersion(),
    };
  }

  /** Cible réseau affichable : `host:port/db`, **sans** user/password (anti-leak). */
  #safeUrlTarget(fallback: string, defaultPort: string): string {
    if (!this.#url) {
      return fallback;
    }
    try {
      const u = new URL(this.#url);
      return `${u.hostname}:${u.port || defaultPort}${u.pathname}`;
    } catch {
      return fallback;
    }
  }

  /** Version de la lib `drizzle-orm` (résolue + cachée une seule fois). */
  static #cachedOrmVersion: string | null | undefined;
  static #ormVersion(): string | undefined {
    if (DrizzleOrm.#cachedOrmVersion === undefined) {
      DrizzleOrm.#cachedOrmVersion =
        DrizzleOrm.#resolvePkgVersion("drizzle-orm") ?? null;
    }
    return DrizzleOrm.#cachedOrmVersion ?? undefined;
  }

  /**
   * Version d'un package npm via son `package.json` — `createRequire` +
   * remontée FS. (`require("<pkg>/package.json")` direct échoue souvent :
   * `exports` ne publie pas toujours `./package.json`.)
   */
  static #resolvePkgVersion(name: string): string | undefined {
    try {
      const req = createRequire(import.meta.url);
      let dir = path.dirname(req.resolve(name));
      for (let i = 0; i < 8; i++) {
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
            name?: string;
            version?: string;
          };
          if (pkg.name === name) return pkg.version;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      /* package introuvable / illisible → version inconnue */
    }
    return undefined;
  }

  /** Cible affichable : `:memory:` tel quel, sinon chemin relatif au cwd
   *  (basename si hors projet) — jamais d'absolu (anti info-leak). */
  #safeTarget(): string {
    if (this.#filename === ":memory:" || !path.isAbsolute(this.#filename)) {
      return this.#filename;
    }
    const rel = path.relative(process.cwd(), this.#filename);
    return rel && !rel.startsWith("..") ? rel : path.basename(this.#filename);
  }

  /** Version du moteur SQLite (`SELECT sqlite_version()`), si connecté. */
  #sqliteVersion(): string | undefined {
    if (!this.#client) return undefined;
    try {
      const row = this.#client.prepare("SELECT sqlite_version() AS v").get() as
        { v?: string } | undefined;
      return row?.v;
    } catch {
      return undefined;
    }
  }
}
