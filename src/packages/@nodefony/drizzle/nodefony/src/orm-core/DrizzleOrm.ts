import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
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
  type DrizzleResolvedRelation,
} from "./DrizzleRepository";
import { DrizzleTransaction } from "./DrizzleTransaction";

/** Options de connexion de l'adapter Drizzle + `better-sqlite3`. */
export interface DrizzleOrmOptions {
  /** Fichier SQLite (`":memory:"` par défaut pour les tests). */
  filename?: string;
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
  #db: DrizzleDb | null = null;
  #connected = false;
  /** Tables Drizzle indexées par nom logique d'entité (lazy). */
  #tables: Record<string, SQLiteTable> | null = null;
  /** Relations résolues : entité → champ → relation eager-load (lazy). */
  #relations: Record<string, Record<string, DrizzleResolvedRelation>> | null =
    null;
  /** Repositories mémoïsés par nom d'entité (lazy). */
  #repositories: Record<string, IRepository> | null = null;
  readonly #filename: string;

  /**
   * @param name - clé unique de l'ORM dans le `ormRegistry` (ex. `"db_test"`).
   * @param options - options de connexion (`filename`).
   */
  constructor(name: string, options: DrizzleOrmOptions = {}) {
    super(name);
    this.#filename = options.filename ?? ":memory:";
  }

  /** Entités enregistrées dans `entityRegistry` ciblant cet ORM. */
  #ownEntities(): IEntity[] {
    return entityRegistry.list().filter((entity) => entity.orm === this.name);
  }

  /** FK déterministe camelCase `<entité>Id` (parité avec Mongoose). */
  #foreignKey(entityName: string): string {
    return `${entityName.charAt(0).toLowerCase()}${entityName.slice(1)}Id`;
  }

  /** Dérive le `CREATE TABLE` SQLite depuis la table Drizzle (dev/test). */
  #createTableSQL(table: SQLiteTable): string {
    const { name, columns } = getTableConfig(table);
    const defs = columns.map((col) => {
      const parts = [`"${col.name}"`, col.getSQLType()];
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
    return `CREATE TABLE IF NOT EXISTS "${name}" (${defs.join(", ")})`;
  }

  /** Résout les relations déclaratives d'une entité en métadonnées eager-load. */
  #resolveRelations(
    entity: IEntity,
    tables: Record<string, SQLiteTable>,
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
    target: SQLiteTable,
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
    const client = new BetterSqlite3(this.#filename);
    const db = drizzle(client);
    this.#client = client;
    this.#db = db;
    this.#tables = Object.create(null) as Record<string, SQLiteTable>;
    this.#relations = Object.create(null) as Record<
      string,
      Record<string, DrizzleResolvedRelation>
    >;

    const entities = this.#ownEntities();

    // 1) Schema-as-code : la table EST le schéma → DDL dérivé + création.
    for (const entity of entities) {
      const table = entity.schema as SQLiteTable;
      this.#tables[entity.name] = table;
      entity.model = table;
      client.exec(this.#createTableSQL(table));
    }

    // 2) Résolution des relations déclaratives (eager-load manuel).
    for (const entity of entities) {
      this.#relations[entity.name] = this.#resolveRelations(
        entity,
        this.#tables,
      );
    }

    this.#connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.#client) {
      this.#client.close();
    }
    this.#client = null;
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
    const { columns } = getTableConfig(table);
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
    return {
      driver: "sqlite",
      target: this.#safeTarget(),
      version: this.#sqliteVersion(),
      ormVersion: DrizzleOrm.#ormVersion(),
    };
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
        | { v?: string }
        | undefined;
      return row?.v;
    } catch {
      return undefined;
    }
  }
}
