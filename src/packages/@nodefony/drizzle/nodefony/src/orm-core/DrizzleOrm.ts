import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import BetterSqlite3 from "better-sqlite3";
import { is } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  getTableConfig,
  SQLiteSyncDialect,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";
import {
  getTableConfig as getPgTableConfig,
  PgDialect,
  PgTable,
} from "drizzle-orm/pg-core";
import {
  getTableConfig as getMysqlTableConfig,
  MySqlDialect,
  MySqlTable,
} from "drizzle-orm/mysql-core";
// `import type` UNIQUEMENT (effacé à la compilation) → @types/pg et les types
// embarqués de mysql2 servent au typage, les drivers runtime sont des
// `optionalDependencies` chargées en LAZY (`await import`) dans `#connectPostgres`
// / `#connectMysql` (jamais au top-level : un déploiement SQLite n'a ni pg ni mysql2).
import type { Pool, PoolClient } from "pg";
import type {
  Pool as MysqlPool,
  PoolConnection as MysqlPoolConnection,
} from "mysql2/promise";
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

/**
 * État interne du pool `mysql2` (INTERNE, best-effort) — ce que le driver ne
 * publie pas mais que la sonde du data plane a besoin de lire.
 *
 * `mysql2/promise` enveloppe le pool callback (`promisePool.pool`), dont les
 * compteurs sont des champs `_`-préfixés (des `Denque`, d'où `length`). Contrat
 * non garanti par le driver : tout est optionnel ici, la sonde narrowe champ par
 * champ (cf {@link DrizzleOrm.probe}). Le jour où `mysql2` renomme, la sonde
 * devient partielle et le banc de contrat le signale — pas de crash, pas de
 * silence.
 */
interface MysqlPoolInternals {
  pool?: {
    config?: { connectionLimit?: number };
    /** Connexions ouvertes (libres + empruntées). */
    _allConnections?: { length?: number };
    /** Connexions disponibles. */
    _freeConnections?: { length?: number };
    /** Demandes en attente d'une connexion. */
    _connectionQueue?: { length?: number };
  };
}

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
  /**
   * Le schéma doit-il être DÉRIVÉ du code à la connexion ?
   *
   * `true` (défaut) : `CREATE TABLE IF NOT EXISTS` et les index déclarés sont
   * émis à chaque connexion — c'est le confort du développement et l'usage
   * direct en banc de test.
   *
   * `false` : la connexion ne touche PAS au schéma. C'est ce que veulent les
   * modes `migrate` et `none` : le schéma y appartient aux migrations, et une
   * création dérivée qui passerait par-dessus créerait précisément la
   * divergence que les migrations existent pour empêcher — une table posée par
   * le démarrage n'a aucune trace dans l'historique, donc plus personne ne sait
   * d'où elle vient.
   */
  deriveSchema?: boolean;
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
 * Sous-ensemble structural d'un index Drizzle, tel que le rendent les trois
 * `getTableConfig` (`.indexes[].config`).
 */
interface DDLIndex {
  config: {
    name: string;
    unique: boolean;
    columns: readonly { name?: string }[];
  };
}

/**
 * Sous-ensemble structural d'une contrainte `CHECK`, tel que le rendent les
 * trois `getTableConfig` (`.checks[]`).
 */
interface DDLCheck {
  name: string;
  value: SQL;
}

/**
 * Rend le prédicat d'une contrainte `CHECK` en SQL littéral, avec la grammaire
 * du dialecte demandé.
 *
 * Un `CHECK` ne peut porter **aucun paramètre lié** : une définition de table
 * n'a pas de place où en fournir la valeur. Le prédicat qui en produirait un
 * est donc écarté plutôt qu'émis avec un `?` que le serveur refuserait — le
 * colKit, seul producteur de contraintes du framework, compose exclusivement en
 * `sql.raw`.
 *
 * @param check - contrainte lue sur la table Drizzle.
 * @param dialect - dialecte SQL cible (grammaire de citation et de paramètre).
 * @returns le prédicat littéral, ou `null` s'il porte un paramètre lié.
 */
function renderCheck(check: DDLCheck, dialect: SqlDialect): string | null {
  const query =
    dialect === "postgres"
      ? new PgDialect().sqlToQuery(check.value)
      : dialect === "mysql"
        ? new MySqlDialect().sqlToQuery(check.value)
        : new SQLiteSyncDialect().sqlToQuery(check.value);
  return query.params.length === 0 ? query.sql : null;
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
  /**
   * Détacheurs des listeners de cycle de vie posés sur le pool natif.
   * `null` tant qu'aucun pool réseau n'est ouvert (SQLite n'en a pas) — lazy,
   * et surtout : un `disconnect()`/`connect()` répété empilerait sinon un jeu
   * de listeners par cycle.
   */
  #unwire: Array<() => void> | null = null;

  /**
   * Ce que cet adapter sait de l'état de sa connexion, **par dialecte**.
   *
   * `postgres`/`mysql` traduisent les signaux de leur pool → `"events"`.
   * `sqlite` est une base EMBARQUÉE : il n'y a ni serveur à perdre ni socket
   * à surveiller, donc rien à constater — dire `"assumed"` n'est pas un aveu
   * de faiblesse, c'est la description exacte de la situation.
   */
  override get liveness(): "events" | "assumed" {
    return this.#dialect === "sqlite" ? "assumed" : "events";
  }

  /** Pool `pg` (dialecte postgres) — `null` hors postgres ou non connecté. */
  #pgPool: Pool | null = null;
  /** Pool `mysql2/promise` (dialecte mysql) — `null` hors mysql ou non connecté. */
  #mysqlPool: MysqlPool | null = null;
  #db: DrizzleDb | null = null;
  /**
   * Ouvre une transaction sur le driver du connecteur — posée par le
   * `#connectX` du dialecte, `null` hors connexion.
   *
   * **Pourquoi une fabrique par dialecte plutôt qu'un `switch` dans
   * {@link DrizzleOrm.transaction}** : une transaction postgres/mysql exige une
   * connexion DÉDIÉE empruntée au pool (le `BEGIN` et les écritures doivent
   * tomber sur la MÊME connexion, sinon aucune atomicité) et le db Drizzle qui
   * lui est lié — donc la factory `drizzle` du driver, importée en LAZY au
   * connect. La closure capture ce que seul le connect connaît, et
   * `transaction()` reste un chemin unique, sans réimport ni branche.
   */
  #beginTx: (() => Promise<DrizzleTransaction>) | null = null;
  /**
   * File d'attente des transactions **sqlite** (lazy, `null` au repos) — dernier
   * maillon de la chaîne : chaque transaction attend le précédent, et libère le
   * suivant en se terminant.
   *
   * **Pourquoi** : la connexion `better-sqlite3` est UNIQUE → c'est un pool de
   * taille 1. Sans file, deux transactions concurrentes (= deux requêtes HTTP
   * simultanées) émettent deux `BEGIN` sur la même connexion et la seconde
   * échoue (`cannot start a transaction within a transaction`) — un framework
   * qui assume sqlite en prod mono-nœud doit encaisser ça. postgres/mysql n'en
   * ont pas besoin : leur pool EST la file d'attente (prouvé au banc — 15
   * transactions simultanées sur un pool de 10 passent).
   */
  #sqliteTxGate: Promise<void> | null = null;
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
  /**
   * Le schéma est-il dérivé du code à la connexion ? (cf `deriveSchema`)
   *
   * Fixé au constructeur : changer d'avis en cours de vie ferait qu'une
   * reconnexion poserait des tables qu'un exploitant croyait sous contrôle des
   * migrations.
   */
  readonly #deriveSchema: boolean;
  readonly #filename: string;
  readonly #url: string | undefined;

  /**
   * @param name - clé unique de l'ORM dans le `ormRegistry` (ex. `"db_test"`).
   * @param options - options de connexion (`dialect`, `filename` sqlite, `url` pg).
   */
  constructor(name: string, options: DrizzleOrmOptions = {}) {
    super(name);
    this.#dialect = options.dialect ?? "sqlite";
    this.#deriveSchema = options.deriveSchema !== false;
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
    return entityRegistry
      .list()
      .filter((entity) => entity.connector === this.name);
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
  #buildCreateTable(
    name: string,
    columns: DDLColumn[],
    quote = '"',
    checks: readonly DDLCheck[] = [],
    dialect: SqlDialect = "sqlite",
  ): string {
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
    // Les `CHECK` sont émis ICI, contrairement aux index : une contrainte de
    // table ne s'ajoute pas après coup de façon portable (SQLite ne sait pas
    // l'attacher à une table existante). Le prix est connu et assumé — une base
    // de développement déjà créée ne la reçoit pas, comme pour toute évolution
    // de colonne sous `CREATE TABLE IF NOT EXISTS`. Le gain est qu'en
    // développement le serveur refuse exactement ce qu'il refusera en
    // production : la contrainte de la migration `0000` et celle du DDL dérivé
    // sortent de la MÊME déclaration colKit.
    for (const check of checks) {
      const predicate = renderCheck(check, dialect);
      if (predicate === null) {
        continue;
      }
      defs.push(
        `CONSTRAINT ${quote}${check.name}${quote} CHECK (${predicate})`,
      );
    }
    return `CREATE TABLE IF NOT EXISTS ${quote}${name}${quote} (${defs.join(", ")})`;
  }

  /**
   * Dérive les `CREATE INDEX` des index déclarés sur la table (dev/test).
   *
   * Les index étaient construits sur la table Drizzle mais jamais émis : une
   * colonne déclarée indexée ne l'était nulle part, et rien ne le disait. La
   * requête restait correcte, seulement lente — le pire genre d'écart, celui qui
   * ne se voit qu'en charge.
   *
   * Pourquoi ici et pas dans `#buildCreateTable` : un index est un objet SÉPARÉ
   * de la table en SQL standard, et `CREATE TABLE IF NOT EXISTS` ne le porterait
   * pas. Émis à part, il arrive AUSSI sur une base de développement déjà créée —
   * ce qu'aucune clause de table ne permettrait.
   *
   * Les clés étrangères, elles, ne sont toujours PAS émises : elles se déclarent
   * DANS le `CREATE TABLE`, donc elles n'atteindraient jamais une base existante,
   * et elles imposeraient de créer les tables dans l'ordre de leurs dépendances
   * (indécidable sur un cycle). C'est le travail du DDL de production
   * (drizzle-kit), pas d'un dérivé de développement.
   *
   * @param table - nom de la table portant les index.
   * @param indexes - index déclarés (`getTableConfig(...).indexes`).
   * @param quote - caractère de citation des identifiants du dialecte.
   * @returns une instruction par index (vide s'il n'y en a aucun).
   */
  #buildCreateIndexes(
    table: string,
    indexes: readonly DDLIndex[],
    quote = '"',
  ): string[] {
    const statements: string[] = [];
    for (const entry of indexes) {
      const { name, unique, columns } = entry.config;
      const names = columns
        .map((column) => column.name)
        .filter((column): column is string => typeof column === "string");
      // Un index sur une expression (et non sur des colonnes nommées) n'est pas
      // portable entre moteurs : on le laisse au DDL de production plutôt que
      // d'en produire une traduction approximative.
      if (names.length === 0 || names.length !== columns.length) continue;
      const cols = names
        .map((column) => `${quote}${column}${quote}`)
        .join(", ");
      statements.push(
        `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ` +
          `${quote}${name}${quote} ON ${quote}${table}${quote} (${cols})`,
      );
    }
    return statements;
  }

  /** Dérive le `CREATE TABLE` SQLite depuis la table Drizzle (dev/test). */
  #createTableSQL(table: SQLiteTable): string {
    const { name, columns, checks } = getTableConfig(table);
    return this.#buildCreateTable(name, columns, '"', checks, "sqlite");
  }

  /** Dérive les `CREATE INDEX` SQLite depuis la table Drizzle (dev/test). */
  #createIndexesSQL(table: SQLiteTable): string[] {
    const { name, indexes } = getTableConfig(table);
    return this.#buildCreateIndexes(name, indexes as unknown as DDLIndex[]);
  }

  /** Dérive le `CREATE TABLE` Postgres depuis la table Drizzle (dev/test). */
  #createTablePgSQL(table: PgTable): string {
    const { name, columns, checks } = getPgTableConfig(table);
    return this.#buildCreateTable(name, columns, '"', checks, "postgres");
  }

  /** Dérive les `CREATE INDEX` Postgres depuis la table Drizzle (dev/test). */
  #createIndexesPgSQL(table: PgTable): string[] {
    const { name, indexes } = getPgTableConfig(table);
    return this.#buildCreateIndexes(name, indexes as unknown as DDLIndex[]);
  }

  /** Dérive le `CREATE TABLE` MySQL depuis la table Drizzle (dev/test). */
  #createTableMysqlSQL(table: MySqlTable): string {
    const { name, columns, checks } = getMysqlTableConfig(table);
    return this.#buildCreateTable(name, columns, "`", checks, "mysql");
  }

  /**
   * Dérive les `CREATE INDEX` MySQL depuis la table Drizzle (dev/test).
   *
   * MySQL ne connaît pas `CREATE INDEX IF NOT EXISTS` : la clause est retirée, et
   * l'exécution tolère l'erreur « index déjà existant » (le seul cas où rejouer
   * le DDL de développement doit rester silencieux).
   */
  #createIndexesMysqlSQL(table: MySqlTable): string[] {
    const { name, indexes } = getMysqlTableConfig(table);
    return this.#buildCreateIndexes(
      name,
      indexes as unknown as DDLIndex[],
      "`",
    ).map((statement) => statement.replace(" IF NOT EXISTS", ""));
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
    // Un `connect()` rejoué (DDL de développement relancé) ne doit pas
    // empiler : sans cette reprise, l'ancien pool restait ouvert — sockets
    // fuités — et ses écoutes continuaient de parler au nom d'un ORM dont la
    // connexion courante est ailleurs.
    await this.#releasePrevious();
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
    const db = drizzle(client);
    this.#db = db;
    // Connexion unique et synchrone : la transaction encadre le db du connecteur
    // lui-même (rien à emprunter) — mais elle attend son TOUR (cf #sqliteTxGate).
    this.#beginTx = async (): Promise<DrizzleTransaction> => {
      const previous = this.#sqliteTxGate;
      let release!: () => void;
      const mine = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.#sqliteTxGate = mine;
      // Prendre sa place dans la file AVANT d'attendre : deux appels simultanés
      // se chaînent (`mine` de l'un est le `previous` de l'autre) au lieu de
      // partir tous les deux sur un `BEGIN`.
      if (previous) {
        await previous;
      }
      client.exec("BEGIN");
      return new DrizzleTransaction(db, {
        exec: (sql: string): Promise<void> => {
          client.exec(sql);
          return Promise.resolve();
        },
        quoteIdent: (name: string): string => `"${name}"`,
        release: (): void => {
          // Dernière de la file → on la rend au repos (lazy).
          if (this.#sqliteTxGate === mine) {
            this.#sqliteTxGate = null;
          }
          release(); // libère la suivante
        },
      });
    };
    for (const entity of entities) {
      this.#assertDialectTable(entity, SQLiteTable, "sqlite");
      const table = entity.schema as SQLiteTable;
      this.#tables![entity.name] = table;
      entity.model = table;
      if (!this.#deriveSchema) {
        continue;
      }
      client.exec(this.#createTableSQL(table));
      for (const statement of this.#createIndexesSQL(table)) {
        client.exec(statement);
      }
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
    let PoolCtor: new (config: {
      connectionString?: string;
      keepAlive?: boolean;
      keepAliveInitialDelayMillis?: number;
    }) => Pool;
    // `Pool | PoolClient` : le MÊME `drizzle` sert le pool (requêtes ordinaires)
    // et une connexion empruntée (transaction) — l'adapter node-postgres accepte
    // les deux, c'est ce qui rend la transaction portable sans second import.
    let pgDrizzle: (client: Pool | PoolClient) => unknown;
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
        .drizzle as unknown as (client: Pool | PoolClient) => unknown;
    } catch (e) {
      throw new Error(
        `DrizzleOrm "${this.name}": the postgres dialect needs the optional ` +
          `driver \`pg\` (run \`npm i pg\`). ${(e as Error).message}`,
        { cause: e },
      );
    }
    // `keepAlive` : `pg` le laisse à FAUX par défaut, et rien ne le posait.
    // Sans lui, une coupure RÉSEAU silencieuse — NAT qui expire, règle de
    // pare-feu, câble — laisse un socket zombie que rien ne réveille : ni le
    // client ni le serveur n'a fermé quoi que ce soit, aucun événement n'est
    // émis, et la première requête à s'y aventurer attend son timeout TCP.
    // Le keepalive fait mourir ces sockets, donc émettre l'erreur, donc
    // constater la perte. Coût : un paquet toutes les 10 s par connexion.
    const pool = new PoolCtor({
      connectionString: this.#url,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    // AVANT le ping, pas après : le `SELECT 1` ci-dessous ouvre la PREMIÈRE
    // connexion, et c'est déjà une connexion qui peut tomber. Câbler ensuite
    // laissait un trou au moment le plus fragile — l'établissement.
    this.#wirePgLifecycle(pool);
    // Ping RÉEL au connect : le pool pg est LAZY (aucune I/O tant qu'aucune
    // requête) → sans ce SELECT 1, une base injoignable « connecterait » en
    // silence et n'échouerait qu'à la première requête métier (session read)
    // — l'échec doit sortir AU BOOT (cf BootConfigurationError côté service).
    try {
      await pool.query("SELECT 1");
    } catch (e) {
      this.#unwireAll(); // le ping a échoué : pas de listener orphelin
      await pool.end().catch(() => undefined); // pas de handle fuité
      throw e;
    }
    this.#pgPool = pool;
    this.#db = pgDrizzle(pool) as DrizzleDb;
    // Tout ce qui suit peut encore échouer (DDL, relations). `connect()`
    // doit être ATOMIQUE : un échec tardif laissait jusqu'ici un pool ouvert
    // et des écoutes câblées sur un ORM que l'appelant croit mort.
    try {
      await this.#finishPostgres(entities, pool, pgDrizzle);
    } catch (e) {
      this.#unwireAll();
      await pool.end().catch(() => undefined);
      this.#pgPool = null;
      this.#db = null;
      this.#beginTx = null;
      throw e;
    }
  }

  /** Suite de la connexion postgres — isolée pour rendre `connect()` atomique. */
  async #finishPostgres(
    entities: IEntity[],
    pool: Pool,
    pgDrizzle: (client: Pool | PoolClient) => unknown,
  ): Promise<void> {
    // Transaction = UNE connexion empruntée au pool, rendue au commit/rollback.
    // Sans cet emprunt, `BEGIN` et les écritures partiraient sur des connexions
    // différentes du pool : aucune atomicité, et un `BEGIN` orphelin recyclé.
    this.#beginTx = async (): Promise<DrizzleTransaction> => {
      const cx = await pool.connect();
      // 🔴 MÊME défaut que celui fermé sur le pool, par le chemin resté
      // ouvert. `pg-pool` RETIRE son auditeur `error` du client tant qu'il
      // sert (`pg-pool/index.js:344`, réattaché en tête de `_release`) : le
      // temps d'une transaction, la connexion n'en a donc AUCUN. Si le serveur
      // tombe pendant, `pg` émet `error` dessus (`client.js:210`) — un
      // `EventEmitter` qui émet `error` sans auditeur LÈVE, et rien n'installe
      // de `uncaughtException` dans le framework : le pod meurt, en pleine
      // transaction, là même où l'application avait le plus à perdre.
      // Constaté au banc de coupure réelle, qui rendait « 6 tests passés,
      // 1 erreur non capturée » — un vert qui portait un crash.
      const puitsTx = (err: Error): void => {
        this.connectionLost(
          `pg (transaction) : ${err?.message ?? String(err)}`,
        );
      };
      cx.on("error", puitsTx);
      /** Rend la connexion, en retirant d'abord NOTRE puits. */
      const rendre = (err?: unknown): void => {
        // Synchrone jusqu'au `release`, donc aucune fenêtre sans auditeur :
        // `_release` réattache celui du pool avant toute autre chose.
        cx.removeListener("error", puitsTx);
        // `release(err)` DÉTRUIT la connexion au lieu de la recycler. Un rejet
        // non-`Error` (une string jetée) doit détruire aussi → `true`, jamais
        // `undefined` (qui recyclerait une connexion à l'état inconnu).
        cx.release(
          err === undefined ? undefined : err instanceof Error ? err : true,
        );
      };
      try {
        await cx.query("BEGIN");
      } catch (e) {
        rendre(e as Error); // BEGIN raté → connexion suspecte, pas de recyclage
        throw e;
      }
      return new DrizzleTransaction(pgDrizzle(cx) as DrizzleDb, {
        exec: async (sql: string): Promise<void> => {
          await cx.query(sql);
        },
        quoteIdent: (name: string): string => `"${name}"`,
        release: rendre,
      });
    };
    for (const entity of entities) {
      this.#assertDialectTable(entity, PgTable, "postgres");
      const table = entity.schema as PgTable;
      this.#tables![entity.name] = table;
      entity.model = table;
      if (!this.#deriveSchema) {
        continue;
      }
      await pool.query(this.#createTablePgSQL(table));
      for (const statement of this.#createIndexesPgSQL(table)) {
        await pool.query(statement);
      }
    }
  }

  /**
   * Referme ce qu'un établissement précédent avait ouvert, s'il y en a eu un.
   * Silencieux et idempotent : au premier `connect()` il n'y a rien à faire.
   */
  async #releasePrevious(): Promise<void> {
    if (!this.#pgPool && !this.#mysqlPool && !this.#client) {
      return;
    }
    this.#unwireAll();
    const sink = (): void => undefined;
    this.#pgPool?.on("error", sink);
    try {
      this.#client?.close();
      await this.#pgPool?.end();
      await this.#mysqlPool?.end();
    } catch {
      /* fermeture au mieux : on va rouvrir juste après */
    }
    this.#client = null;
    this.#pgPool = null;
    this.#mysqlPool = null;
  }

  /** Détache tous les listeners de cycle de vie posés sur les pools natifs. */
  #unwireAll(): void {
    if (!this.#unwire) {
      return;
    }
    for (const off of this.#unwire) {
      off();
    }
    this.#unwire = null;
  }

  /**
   * Traduit le cycle de vie du pool **`pg`** en signaux du contrat `orm-core`.
   *
   * 🔴 Ce listener n'est pas du confort, il empêche un CRASH. `pg-pool` fait
   * `pool.emit("error", …)` quand un client **inactif** tombe (serveur
   * redémarré, coupure réseau, `pg_terminate_backend`) ; un `EventEmitter` qui
   * émet `error` sans auditeur **lève**, et rien n'installe de
   * `uncaughtException` dans le framework — le pod tombait. Constaté au banc :
   * `docker stop` du serveur PostgreSQL ⇒ process mort, code 1.
   *
   * Le RETOUR se lit sur `connect` **et** `acquire`. `connect` seul ne suffit
   * pas : `pg` ne recrée un client que si aucun n'est disponible, donc après
   * une coupure brève le pool peut reprendre du service en réutilisant un
   * client sain — sans jamais émettre `connect`, laissant l'ORM marqué tombé
   * alors que la base répond. `acquire` couvre les deux cas.
   * `connectionRestored()` étant idempotent, les acquisitions d'un pool en
   * bonne santé ne comptent rien.
   */
  #wirePgLifecycle(pool: Pool): void {
    const onError = (err: Error): void => {
      this.connectionLost(`pg: ${err?.message ?? String(err)}`);
    };
    const onConnect = (): void => {
      this.connectionRestored();
    };
    pool.on("error", onError);
    pool.on("connect", onConnect);
    pool.on("acquire", onConnect);
    (this.#unwire ??= []).push(() => {
      pool.removeListener("error", onError);
      pool.removeListener("connect", onConnect);
      pool.removeListener("acquire", onConnect);
    });
  }

  /**
   * Traduit le cycle de vie du pool **`mysql2`** en signaux du contrat.
   *
   * `mysql2` n'expose PAS d'événement `error` sur le pool : ce sont les
   * `PoolConnection` qui émettent (elles posent d'ailleurs leur propre
   * `once("error")` pour se retirer du pool — c'est la seule raison pour
   * laquelle MySQL ne fait pas tomber le process là où `pg` le fait). On
   * s'abonne donc à chaque connexion créée ; `connection` sert aussi de
   * signal de RETOUR, le pool en ouvrant une neuve dès que le serveur répond.
   *
   * 🔴 **Mais cet `error` n'arrive PAS quand le serveur tombe.** Mesuré, un
   * `docker stop` sous une connexion établie : le socket rend `end` puis
   * `close`, la requête en vol est rejetée en `PROTOCOL_CONNECTION_LOST`
   * (`fatal: true`) — et la connexion n'émet rien, `mysql2` délivrant l'erreur
   * fatale au demandeur plutôt qu'à l'émetteur. L'écoute ci-dessus ne couvre
   * donc que les erreurs survenues connexion INACTIVE ; s'y fier seul laissait
   * l'ORM marqué connecté jusqu'au battement suivant, quand `pg` bascule
   * aussitôt par `pool.on("error")`.
   *
   * D'où la seconde écoute, sur le **socket** — le seul à parler dans ce cas.
   * Sa fermeture n'est pas une preuve (une connexion inactive recyclée en
   * ferme un aussi), donc elle ne conclut rien : elle déclenche un battement
   * ANTICIPÉ, qui tranche par une requête. Cleanup : `once` se retire en
   * partant, et le socket meurt avec la connexion qui le porte.
   */
  #wireMysqlLifecycle(pool: MysqlPool): void {
    const onConnection = (cx: {
      on: (e: string, f: (x: Error) => void) => void;
      stream?: { once: (e: string, f: () => void) => void };
    }): void => {
      this.connectionRestored();
      cx.on("error", (err: Error) => {
        // Une connexion attardée peut émettre APRÈS `disconnect()` — voire
        // après qu'un autre pool a pris sa place. Sans cette vérification,
        // elle inscrirait une erreur au compte d'un ORM déjà fermé.
        if (this.#mysqlPool !== pool) {
          return;
        }
        this.connectionLost(`mysql: ${err?.message ?? String(err)}`);
      });
      cx.stream?.once("close", () => {
        if (this.#mysqlPool !== pool) {
          return;
        }
        this.beatNow();
      });
    };
    const emitter = pool as unknown as {
      on: (e: string, f: (c: never) => void) => void;
      removeListener: (e: string, f: (c: never) => void) => void;
    };
    emitter.on("connection", onConnection as unknown as (c: never) => void);
    (this.#unwire ??= []).push(() => {
      emitter.removeListener(
        "connection",
        onConnection as unknown as (c: never) => void,
      );
    });
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
    // `MysqlPool | MysqlPoolConnection` : même raison qu'en postgres — le pool
    // pour les requêtes ordinaires, une connexion empruntée pour la transaction.
    let mysqlDrizzle: (client: MysqlPool | MysqlPoolConnection) => unknown;
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
        .drizzle as unknown as (
        client: MysqlPool | MysqlPoolConnection,
      ) => unknown;
      // `enableKeepAlive` — même raison qu'en postgres (socket zombie après
      // une coupure réseau silencieuse). `mysql2` l'expose au niveau de la
      // connexion, le pool le propage à chacune de celles qu'il crée.
      pool = createPool({
        uri: this.#url,
        timezone: "Z",
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
      });
      // Câblé AVANT le ping — même raison qu'en postgres, et une de plus ici :
      // `mysql2` ne signale ses connexions qu'à leur CRÉATION. Une connexion
      // ouverte avant l'abonnement n'aurait jamais d'auditeur d'erreur, et sa
      // chute passerait inaperçue jusqu'au prochain renouvellement du pool.
      this.#wireMysqlLifecycle(pool);
    } catch (e) {
      throw new Error(
        `DrizzleOrm "${this.name}": the mysql dialect needs the optional ` +
          `driver \`mysql2\` (run \`npm i mysql2\`). ${(e as Error).message}`,
        { cause: e },
      );
    }
    // Ping RÉEL au connect (même raison que #connectPostgres : pool lazy).
    try {
      await pool.query("SELECT 1");
    } catch (e) {
      this.#unwireAll();
      await pool.end().catch(() => undefined); // pas de handle fuité
      throw e;
    }
    this.#mysqlPool = pool;
    this.#db = mysqlDrizzle(pool) as DrizzleDb;
    // Atomicité — même raison quen postgres : un DDL qui lève ne doit pas
    // laisser un pool ouvert derrière un connect() qui a rejeté.
    try {
      await this.#finishMysql(entities, pool, mysqlDrizzle);
    } catch (e) {
      this.#unwireAll();
      await pool.end().catch(() => undefined);
      this.#mysqlPool = null;
      this.#db = null;
      this.#beginTx = null;
      throw e;
    }
  }

  /** Suite de la connexion mysql — isolée pour rendre `connect()` atomique. */
  async #finishMysql(
    entities: IEntity[],
    pool: MysqlPool,
    mysqlDrizzle: (client: MysqlPool | MysqlPoolConnection) => unknown,
  ): Promise<void> {
    // Transaction = UNE connexion empruntée au pool (même raison qu'en postgres).
    // mysql2 n'a pas de `release(err)` : rendre une connexion à l'état inconnu
    // est impossible à exprimer → `destroy()` explicite (le pool en rouvrira une).
    this.#beginTx = async (): Promise<DrizzleTransaction> => {
      const cx = await pool.getConnection();
      try {
        await cx.query("BEGIN");
      } catch (e) {
        cx.destroy();
        throw e;
      }
      return new DrizzleTransaction(mysqlDrizzle(cx) as DrizzleDb, {
        exec: async (sql: string): Promise<void> => {
          await cx.query(sql);
        },
        // Backticks : `"x"` est une CHAÎNE en mysql/mariadb (hors ANSI_QUOTES),
        // pas un identifiant → `SAVEPOINT "sp"` est une erreur de syntaxe.
        quoteIdent: (name: string): string => `\`${name}\``,
        release: (err?: unknown): void => {
          if (err === undefined) {
            cx.release();
          } else {
            cx.destroy();
          }
        },
      });
    };
    for (const entity of entities) {
      this.#assertDialectTable(entity, MySqlTable, "mysql");
      const table = entity.schema as MySqlTable;
      this.#tables![entity.name] = table;
      entity.model = table;
      if (!this.#deriveSchema) {
        continue;
      }
      await pool.query(this.#createTableMysqlSQL(table));
      for (const statement of this.#createIndexesMysqlSQL(table)) {
        try {
          await pool.query(statement);
        } catch (error) {
          // MySQL n'a pas de `CREATE INDEX IF NOT EXISTS` : rejouer le DDL de
          // développement sur une base existante lève `ER_DUP_KEYNAME`. C'est le
          // SEUL cas toléré — toute autre erreur remonte, une table sans son
          // index se paierait en requêtes lentes que rien n'expliquerait.
          const code = (error as { code?: string }).code;
          if (code !== "ER_DUP_KEYNAME") throw error;
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    // L'ordre compte, et il se lit à l'envers de l'intuition.
    //
    // 1. `alive = false` d'ABORD : un arrêt VOLONTAIRE n'est pas une perte de
    //    connexion. Le drainage d'un pool émet des événements, et sans cette
    //    ligne un `error` arrivé pendant `end()` inscrirait un incident — et
    //    un `onOrmLost` — pour chaque arrêt propre de l'application.
    // 2. Détacher nos écoutes, qui n'ont plus rien à traduire.
    // 3. Mais poser un PUITS `error` avant de fermer : détacher sans lui
    //    rouvrirait le défaut que ce câblage existe pour fermer — un pool `pg`
    //    qui émet `error` sans le moindre auditeur fait tomber le process, et
    //    la fenêtre de fermeture est précisément un moment où il en émet.
    this.alive = false;
    this.stopHeartbeat();
    this.#unwireAll();
    const sink = (): void => undefined;
    this.#pgPool?.on("error", sink);
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
    this.#beginTx = null; // la closure capture le pool fermé → `not connected`
    this.#sqliteTxGate = null;
    this.#tables = null;
    this.#relations = null;
    this.#repositories = null;
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

  /**
   * Exécute `work` dans une transaction, sur les TROIS dialectes : commit si la
   * closure résout, rollback si elle rejette (cf {@link DrizzleTransaction}).
   *
   * Un repository n'entre dans la transaction que lié par `withTransaction(tx)` :
   * en postgres/mysql, la transaction tient une connexion dédiée du pool, tandis
   * que `getRepository()` écrit via le pool — donc hors transaction.
   *
   * @param work - travail transactionnel ; reçoit la transaction à lier aux repositories.
   * @returns la valeur rendue par `work`.
   * @throws `not connected` hors connexion ; sinon l'erreur de `work`, après rollback.
   */
  async transaction<R>(work: (tx: ITransaction) => Promise<R>): Promise<R> {
    const begin = this.#beginTx;
    if (!begin) {
      throw new Error(`DrizzleOrm "${this.name}": not connected.`);
    }
    const tx = await begin();
    try {
      const result = await work(tx);
      await tx.commit(); // no-op si la closure a déjà commit/rollback
      return result;
    } catch (error) {
      // Un rollback en échec (connexion morte) ne doit JAMAIS masquer l'erreur
      // d'origine — c'est elle qui explique l'abandon. La connexion est de toute
      // façon détruite par le driver, pas recyclée.
      await tx.rollback().catch(() => undefined); // no-op si déjà terminée
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
   * Ping bas-coût : `SELECT 1` — round-trip RÉEL vers la base, routé par
   * dialecte (pool pg/mysql, client better-sqlite3 synchrone).
   *
   * @throws si le connecteur n'est pas connecté.
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
   * Sonde driver-spécifique, **routée par dialecte** — alimente le data plane
   * admin (panneau Studio ORM) :
   * - **sqlite** : stockage via PRAGMA (synchrone, bon marché) — taille
   *   (`page_count × page_size`), mode de journal (WAL ?), pages libres ;
   * - **postgres / mysql** : état du **pool**, la métrique qui compte sur une
   *   base serveur (sa saturation est une falaise de débit) — lu sur des
   *   compteurs EN MÉMOIRE, donc sans requête réseau.
   *
   * Le stockage d'une base serveur n'est PAS sondé : il coûterait une requête
   * (`pg_database_size`…) à chaque appel, pour une donnée que l'admin du SGBD
   * expose déjà. Mieux vaut ne rien promettre que promettre en silence.
   *
   * Best-effort — `{}` seulement si le connecteur n'est pas connecté.
   *
   * @returns sonde `storage` (sqlite) ou `pool` (serveur), `{}` hors connexion.
   */
  async probe(): Promise<IOrmProbe> {
    if (this.#pgPool) {
      return this.#probePgPool(this.#pgPool);
    }
    if (this.#mysqlPool) {
      return this.#probeMysqlPool(this.#mysqlPool);
    }
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
   * Sonde du pool **postgres** — compteurs publics du driver `pg`, lus en
   * mémoire (aucune requête).
   *
   * @param pool - pool `pg` du connecteur.
   * @returns sonde `pool` (taille max, idle, empruntées, en attente).
   */
  #probePgPool(pool: Pool): IOrmProbe {
    // `options.max` = plafond configuré ; `pg` applique 10 par défaut quand il
    // n'est pas posé — l'annoncer explicitement plutôt que laisser un trou (la
    // saturation à 10 est justement ce qu'on cherche à voir venir).
    const max = pool.options?.max;
    return {
      pool: {
        size: typeof max === "number" ? max : 10,
        available: pool.idleCount,
        borrowed: pool.totalCount - pool.idleCount,
        pending: pool.waitingCount,
      },
    };
  }

  /**
   * Sonde du pool **mysql** — `mysql2` ne publie AUCUN compteur (contrairement
   * à `pg`) : seuls des champs internes portent l'état, sous le pool callback
   * (`promisePool.pool`). Accès défensif (chaque champ narrowé, jamais de cast
   * aveugle) → un renommage chez `mysql2` rend une sonde PARTIELLE, jamais une
   * exception ; et le banc de contrat, qui exige ces champs sur les dialectes
   * serveur, vire au rouge pour le dire.
   *
   * @param pool - pool `mysql2/promise` du connecteur.
   * @returns sonde `pool` (champs omis si le driver ne les expose plus).
   */
  #probeMysqlPool(pool: MysqlPool): IOrmProbe {
    const internals = (pool as unknown as MysqlPoolInternals).pool;
    const len = (q: { length?: number } | undefined): number | undefined =>
      typeof q?.length === "number" ? q.length : undefined;
    const all = len(internals?._allConnections);
    const free = len(internals?._freeConnections);
    return {
      pool: {
        size: internals?.config?.connectionLimit,
        available: free,
        // « Empruntées » n'est pas publié : c'est ouvertes − libres.
        borrowed:
          all !== undefined && free !== undefined ? all - free : undefined,
        pending: len(internals?._connectionQueue),
      },
    };
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
   * Décrit le schéma ENTIER attendu par le code : une entrée par table.
   *
   * Même calcul que {@link DrizzleOrm.describeEntity}, à l'échelle du
   * connecteur — et c'est le point : le rattrapage de colonnes au démarrage, le
   * constat de divergence et l'écran d'administration comparent tous « ce que
   * le code déclare » à « ce que la base contient ». Trois lecteurs, un seul
   * producteur ; recopier ce parcours ailleurs le ferait diverger du jour où
   * un dialecte s'ajoute.
   *
   * @returns une entrée par table, avec son NOM EN BASE (≠ nom d'entité).
   */
  describeTables(): {
    entity: string;
    table: string;
    columns: IColumnInfo[];
  }[] {
    const out: { entity: string; table: string; columns: IColumnInfo[] }[] = [];
    for (const entity of this.#ownEntities()) {
      const table = this.#tables?.[entity.name];
      if (!table) {
        continue;
      }
      const nom =
        this.#dialect === "postgres"
          ? getPgTableConfig(table as PgTable).name
          : this.#dialect === "mysql"
            ? getMysqlTableConfig(table as MySqlTable).name
            : getTableConfig(table as SQLiteTable).name;
      out.push({
        entity: entity.name,
        table: nom,
        columns: this.describeEntity(entity.name),
      });
    }
    return out;
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
