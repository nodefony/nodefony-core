import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  check as sqliteCheck,
  index as sqliteIndex,
  integer as sqliteInteger,
  sqliteTable,
  text as sqliteText,
  uniqueIndex as sqliteUniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  SQLiteColumn,
  SQLiteColumnBuilderBase,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";
import {
  bigint as pgBigint,
  boolean as pgBoolean,
  check as pgCheck,
  index as pgIndex,
  integer as pgInteger,
  jsonb as pgJsonb,
  pgTable,
  text as pgText,
  timestamp as pgTimestamp,
  uniqueIndex as pgUniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  PgColumn,
  PgColumnBuilderBase,
  PgTable,
} from "drizzle-orm/pg-core";
import {
  bigint as mysqlBigint,
  boolean as mysqlBoolean,
  check as mysqlCheck,
  customType as mysqlCustomType,
  datetime as mysqlDatetime,
  index as mysqlIndex,
  int as mysqlInt,
  mysqlTable,
  text as mysqlText,
  uniqueIndex as mysqlUniqueIndex,
  varchar as mysqlVarchar,
} from "drizzle-orm/mysql-core";
import type {
  MySqlColumn,
  MySqlColumnBuilderBase,
  MySqlTable,
} from "drizzle-orm/mysql-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";

/**
 * colKit — kit de colonnes partagé des **entités framework** (chantier
 * portabilité multi-dialecte, garde-fou G1 du comparatif ORM
 * mémoire IA `core-dev/audits/orm-comparatif-froid-2026-07.md`).
 *
 * **Pourquoi** : Drizzle est schema-as-code *par dialecte* (`sqliteTable` ≠
 * `pgTable`, builders de colonnes distincts). Sans kit, chaque entité duplique
 * sa déclaration par dialecte (×2 aujourd'hui, ×3 avec mysql) — vécu sur
 * `idempotencyEntity` (2 tables parallèles). Le colKit inverse le rapport :
 * **une spec logique par entité**, le kit produit la table du dialecte demandé.
 * Ajouter mysql (S4) = étendre CE fichier, pas les 8 entités.
 *
 * **Règles portées par construction** :
 * - mêmes **NOMS** de colonnes sur tous les dialectes → stores/repositories
 *   dialect-agnostiques (l'invariant central du chantier) ;
 * - divergences de TYPE assumées ici et nulle part ailleurs : epoch ms =
 *   `integer` SQLite (64-bit) / `bigint mode:"number"` PG+MySQL (`integer` PG
 *   32-bit déborde) ; JSON = `text mode:"json"` SQLite / `jsonb` PG / `json`
 *   MySQL ; booléen = `integer mode:"boolean"` SQLite / `boolean` PG+MySQL ;
 *   date JS (`dateMs`, exposée `Date`) = `integer mode:"timestamp_ms"` SQLite /
 *   `timestamptz(3)` PG / `datetime(3)` MySQL (pas `timestamp` : borne 2038) ;
 *   texte = `text` partout SAUF MySQL où une colonne PK/UNIQUE/indexée devient
 *   `varchar(512)` (InnoDB ne peut pas indexer TEXT sans longueur de préfixe ;
 *   512 × 4 bytes utf8mb4 = 2048 < 3072, la limite d'index DYNAMIC, et couvre
 *   la clé d'idempotence ~330 chars max) ;
 * - **entier 64 bits (`int64`) dès qu'une valeur peut croître sans borne
 *   connue** : `int` est un entier 32 bits signé sur les trois dialectes
 *   (2 147 483 647), et un compteur qui le dépasse ne rend pas une erreur
 *   lisible — il tronque ou refuse l'écriture, des années après la mise en
 *   production. `int` reste réservé aux valeurs bornées par le domaine (un
 *   nombre de chiffres, un code de statut HTTP) ;
 * - **valeurs énumérées bornées en base (`enum`) et non seulement dans le
 *   type** — la contrainte `CHECK` est émise dans le `CREATE TABLE` (DDL
 *   dérivé ET drizzle-kit), donc un écrivain qui contournerait la frontière
 *   typée est refusé par le serveur ;
 * - défauts en **`$defaultFn`/`$onUpdateFn` (JS-level) uniquement** — le DDL
 *   dérivé (`getTableConfig` → `DrizzleOrm.#buildCreateTable`) n'émet PAS les
 *   `DEFAULT` SQL (gotcha `userTable`). Les `index` déclarés, eux, SONT émis
 *   (`DrizzleOrm.#buildCreateIndexes`, `CREATE INDEX IF NOT EXISTS`) — les clés
 *   étrangères restent le domaine de drizzle-kit (migrations prod).
 *
 * **Interne au module** (décision audit) : pas d'export dans `index.ts` — les
 * entités de l'app choisissent LEUR dialecte et écrivent leurs tables Drizzle
 * natives ; exposer le kit serait une sur-promesse d'API à maintenir.
 */

/** Types logiques couverts par les entités framework (étendre ici si besoin). */
export type FrameworkColKind =
  "text" | "json" | "bool" | "epochMs" | "int" | "int64" | "dateMs" | "enum";

/** Modificateurs communs à toutes les colonnes, quel que soit le type logique. */
interface IFrameworkColMods {
  primaryKey?: boolean;
  notNull?: boolean;
  unique?: boolean;
  /** Défaut JS-level (`$defaultFn`) — JAMAIS de `DEFAULT` SQL (cf. doc du kit). */
  defaultFn?: () => unknown;
  /** Régénéré à chaque UPDATE (`$onUpdateFn`) — pendant SQL d'`updatedAt`. */
  onUpdateFn?: () => unknown;
}

/** Colonne scalaire — le type logique suffit à la décrire. */
interface IFrameworkScalarColSpec extends IFrameworkColMods {
  /** Type logique — traduit vers le type natif du dialecte. */
  kind: Exclude<FrameworkColKind, "enum">;
}

/**
 * Colonne à valeurs énumérées — stockée en texte, **bornée par un `CHECK`**
 * émis dans le `CREATE TABLE` (DDL dérivé dev/test ET drizzle-kit en prod).
 *
 * ⚠️ **Un `CHECK` se grave à vie** : une fois la migration `0000` publiée, y
 * ajouter une valeur impose une migration correctrice visible chez chaque
 * utilisateur. Ne l'employer que sur un ensemble **fermé par construction** —
 * les états d'un automate dont l'élargissement serait de toute façon une
 * rupture de contrat (ex. `if`/`done` du protocole d'idempotence). Un
 * **catalogue** appelé à s'étendre (algorithme de hachage, catégorie d'audit,
 * type de sujet) reste un `text` : son union vit sur le type `Row`, où elle ne
 * coûte rien à faire évoluer.
 */
interface IFrameworkEnumColSpec extends IFrameworkColMods {
  kind: "enum";
  /** Valeurs admises — au moins une, gravées dans la contrainte `CHECK`. */
  values: readonly [string, ...string[]];
}

/** Spécification logique d'une colonne d'entité framework. */
export type IFrameworkColSpec = IFrameworkScalarColSpec | IFrameworkEnumColSpec;

/** Index déclaratif — émis par le DDL dérivé (dev) et par drizzle-kit (prod). */
export interface IFrameworkIndexSpec {
  name: string;
  /** Noms de colonnes de la spec (validés au build — fail-loud). */
  on: readonly string[];
  unique?: boolean;
}

/** Spécification logique complète d'une table d'entité framework. */
export interface IFrameworkTableSpec {
  name: string;
  columns: Record<string, IFrameworkColSpec>;
  indexes?: readonly IFrameworkIndexSpec[];
}

/**
 * Vue structurelle commune des column builders Drizzle (sqlite ET pg exposent
 * ces méthodes chaînables) — permet d'appliquer les modificateurs d'une spec
 * sans générique cross-dialecte (le typage fin par dialecte est volontairement
 * abandonné ICI : les types publics des entités framework sont leurs interfaces
 * `XRow` manuelles, pas l'inférence Drizzle).
 */
interface ChainableColumnBuilder {
  primaryKey(): ChainableColumnBuilder;
  notNull(): ChainableColumnBuilder;
  unique(): ChainableColumnBuilder;
  $defaultFn(fn: () => unknown): ChainableColumnBuilder;
  $onUpdateFn(fn: () => unknown): ChainableColumnBuilder;
}

/** Applique les modificateurs d'une spec sur un builder (dialecte déjà choisi). */
function applyMods(
  builder: ChainableColumnBuilder,
  spec: IFrameworkColSpec,
): ChainableColumnBuilder {
  let out = builder;
  if (spec.primaryKey) {
    out = out.primaryKey();
  }
  if (spec.notNull) {
    out = out.notNull();
  }
  if (spec.unique) {
    out = out.unique();
  }
  if (spec.defaultFn) {
    out = out.$defaultFn(spec.defaultFn);
  }
  if (spec.onUpdateFn) {
    out = out.$onUpdateFn(spec.onUpdateFn);
  }
  return out;
}

/** Colonne SQLite d'une spec logique. */
function sqliteColumn(
  name: string,
  spec: IFrameworkColSpec,
): SQLiteColumnBuilderBase {
  let base: unknown;
  switch (spec.kind) {
    case "text":
    case "enum": // Valeurs bornées par un CHECK de table, pas par le type.
      base = sqliteText(name);
      break;
    case "json":
      base = sqliteText(name, { mode: "json" });
      break;
    case "bool":
      base = sqliteInteger(name, { mode: "boolean" });
      break;
    case "epochMs": // SQLite : INTEGER = 64-bit → epoch ms sûr.
    case "int64":
    case "int":
      base = sqliteInteger(name);
      break;
    case "dateMs":
      // Exposé en `Date` JS (≠ epochMs qui expose un number) — stocké en epoch
      // ms INTEGER, converti par le mode Drizzle.
      base = sqliteInteger(name, { mode: "timestamp_ms" });
      break;
  }
  return applyMods(
    base as ChainableColumnBuilder,
    spec,
  ) as unknown as SQLiteColumnBuilderBase;
}

/** Colonne Postgres d'une spec logique. */
function pgColumn(name: string, spec: IFrameworkColSpec): PgColumnBuilderBase {
  let base: unknown;
  switch (spec.kind) {
    case "text":
    case "enum": // Valeurs bornées par un CHECK de table, pas par un type ENUM
      // natif : un `CREATE TYPE` est un objet SÉPARÉ de la table, absent des
      // deux autres dialectes et invisible du DDL dérivé — le CHECK donne la
      // MÊME garantie partout, avec une seule règle.
      base = pgText(name);
      break;
    case "json":
      base = pgJsonb(name); // JSON natif indexable (≠ text SQLite).
      break;
    case "bool":
      base = pgBoolean(name);
      break;
    case "epochMs":
    case "int64":
      // `integer` PG = 32-bit → déborde sur un epoch ms (≈ 1.7e12). `bigint
      // mode:"number"` reste exact sous 2^53 (Number.MAX_SAFE_INTEGER).
      base = pgBigint(name, { mode: "number" });
      break;
    case "int":
      base = pgInteger(name);
      break;
    case "dateMs":
      // Même type JS que SQLite (`Date`) ; côté SQL le type natif diverge
      // (timestamptz ≠ INTEGER ms) — divergence assumée DANS le kit, comme
      // json/bool. Précision 3 = milliseconde (aligne le stockage SQLite).
      base = pgTimestamp(name, {
        withTimezone: true,
        mode: "date",
        precision: 3,
      });
      break;
  }
  return applyMods(
    base as ChainableColumnBuilder,
    spec,
  ) as unknown as PgColumnBuilderBase;
}

/** Colonnes d'index résolues + validées (fail-loud sur un nom inconnu). */
function indexColumns<C>(
  spec: IFrameworkTableSpec,
  ix: IFrameworkIndexSpec,
  table: Record<string, C>,
): [C, ...C[]] {
  const cols = ix.on.map((name) => {
    const col = table[name];
    if (!col) {
      throw new Error(
        `[@nodefony/drizzle] colKit "${spec.name}": index "${ix.name}" references ` +
          `unknown column "${name}" (declared: ${Object.keys(spec.columns).join(", ")}).`,
      );
    }
    return col;
  });
  if (cols.length === 0) {
    throw new Error(
      `[@nodefony/drizzle] colKit "${spec.name}": index "${ix.name}" has no column.`,
    );
  }
  return cols as [C, ...C[]];
}

/** Contrainte `CHECK` dérivée d'une colonne `enum` — nom + prédicat SQL. */
interface EnumCheck {
  name: string;
  value: SQL;
}

/**
 * Dérive les contraintes `CHECK` des colonnes `enum` d'une spec.
 *
 * Le prédicat est composé en **`sql.raw` intégral** — donc sans le moindre
 * paramètre lié : un placeholder n'a aucun sens dans une définition de table,
 * et `drizzle-kit` comme le DDL dérivé rendent la clause telle quelle. Les
 * valeurs viennent du code du framework, jamais d'une entrée ; l'apostrophe est
 * malgré tout doublée — un littéral SQL se compose toujours de la même façon.
 *
 * Le nom de la contrainte est `<table>_<colonne>_check` : il apparaîtra dans le
 * message d'erreur du serveur, et il est gravé dans la migration `0000`.
 *
 * @param spec - spec logique de la table.
 * @param quote - caractère de citation des identifiants du dialecte.
 * @returns une contrainte par colonne `enum` (vide s'il n'y en a aucune).
 */
function enumChecks(spec: IFrameworkTableSpec, quote: string): EnumCheck[] {
  const checks: EnumCheck[] = [];
  for (const [name, col] of Object.entries(spec.columns)) {
    if (col.kind !== "enum") {
      continue;
    }
    if (col.values.length === 0) {
      throw new Error(
        `[@nodefony/drizzle] colKit "${spec.name}": enum column "${name}" has no value.`,
      );
    }
    const list = col.values
      .map((value) => `'${value.replace(/'/g, "''")}'`)
      .join(", ");
    checks.push({
      name: `${spec.name}_${name}_check`,
      value: sql.raw(`${quote}${name}${quote} IN (${list})`),
    });
  }
  return checks;
}

/** Construit la variante SQLite d'une spec. */
function buildSqliteTable(spec: IFrameworkTableSpec): SQLiteTable {
  const columns: Record<string, SQLiteColumnBuilderBase> = {};
  for (const [name, col] of Object.entries(spec.columns)) {
    columns[name] = sqliteColumn(name, col);
  }
  const indexes = spec.indexes;
  const checks = enumChecks(spec, '"');
  if (!indexes?.length && !checks.length) {
    return sqliteTable(spec.name, columns);
  }
  return sqliteTable(spec.name, columns, (t) => {
    const out: Record<string, unknown> = {};
    for (const ix of indexes ?? []) {
      const cols = indexColumns(
        spec,
        ix,
        t as unknown as Record<string, SQLiteColumn>,
      );
      out[ix.name] = (
        ix.unique ? sqliteUniqueIndex(ix.name) : sqliteIndex(ix.name)
      ).on(...cols);
    }
    for (const ck of checks) {
      out[ck.name] = sqliteCheck(ck.name, ck.value);
    }
    return out as never;
  });
}

/** Construit la variante Postgres d'une spec. */
function buildPgTable(spec: IFrameworkTableSpec): PgTable {
  const columns: Record<string, PgColumnBuilderBase> = {};
  for (const [name, col] of Object.entries(spec.columns)) {
    columns[name] = pgColumn(name, col);
  }
  const indexes = spec.indexes;
  const checks = enumChecks(spec, '"');
  if (!indexes?.length && !checks.length) {
    return pgTable(spec.name, columns);
  }
  return pgTable(spec.name, columns, (t) => {
    const out: Record<string, unknown> = {};
    for (const ix of indexes ?? []) {
      const cols = indexColumns(
        spec,
        ix,
        t as unknown as Record<string, PgColumn>,
      );
      out[ix.name] = (ix.unique ? pgUniqueIndex(ix.name) : pgIndex(ix.name)).on(
        ...cols,
      );
    }
    for (const ck of checks) {
      out[ck.name] = pgCheck(ck.name, ck.value);
    }
    return out as never;
  });
}

/**
 * Longueur des colonnes `text` **indexables** en MySQL (`varchar(512)`) :
 * InnoDB ne peut pas porter de PK/UNIQUE/index sur un `TEXT` sans longueur de
 * préfixe → toute colonne `text` PK/UNIQUE/référencée par un index devient un
 * `varchar`. 512 chars × 4 bytes (utf8mb4) = 2048 bytes < 3072 (limite d'index
 * InnoDB en row format DYNAMIC, défaut MySQL ≥ 8.0) et couvre la plus longue
 * valeur framework (clé d'idempotence : `JSON.stringify([identity, clientKey])`
 * ≤ ~330 chars — `IDEMPOTENCY_KEY_MAX` 255 + identité sha256 + ponctuation).
 */
const MYSQL_INDEXED_TEXT_LENGTH = 512;

/**
 * Largeur des colonnes `enum` en MySQL (`varchar(64)`) — fixe et généreuse : la
 * valeur admise est bornée par la contrainte `CHECK`, pas par le type, donc
 * ajouter une valeur à l'énumération ne doit pas devenir un changement de type
 * de colonne. 64 chars couvre tout identifiant d'état, et reste indexable.
 */
const MYSQL_ENUM_LENGTH = 64;

/**
 * Type `json` du dialecte mysql, TOLÉRANT au serveur : MySQL possède un type
 * JSON binaire que mysql2 désérialise en objet, mais **MariaDB** (la cible
 * libre du projet, même dialecte) le stocke en alias LONGTEXT → le driver rend
 * une **string** brute. Le `json()` natif drizzle ne parse pas côté lecture →
 * un objet stocké reviendrait en string sur MariaDB (prouvé e2e). Ce customType
 * parse si string, passe tel quel sinon — un seul kind `json` pour les deux
 * serveurs.
 */
const mysqlJsonCompat = mysqlCustomType<{ data: unknown; driverData: unknown }>(
  {
    dataType() {
      return "json";
    },
    toDriver(value: unknown): unknown {
      return JSON.stringify(value);
    },
    fromDriver(value: unknown): unknown {
      return typeof value === "string" ? JSON.parse(value) : value;
    },
  },
);

/** Colonne MySQL d'une spec logique (`indexed` = référencée par un index de table). */
function mysqlColumn(
  name: string,
  spec: IFrameworkColSpec,
  indexed: boolean,
): MySqlColumnBuilderBase {
  let base: unknown;
  switch (spec.kind) {
    case "text":
      // TEXT n'est pas indexable sans préfixe en InnoDB → varchar dès que la
      // colonne est PK/UNIQUE/indexée (cf MYSQL_INDEXED_TEXT_LENGTH).
      base =
        spec.primaryKey || spec.unique || indexed
          ? mysqlVarchar(name, { length: MYSQL_INDEXED_TEXT_LENGTH })
          : mysqlText(name);
      break;
    case "enum":
      // Toujours varchar : un ensemble énuméré est court, et TEXT interdirait
      // d'indexer la colonne plus tard (InnoDB, cf MYSQL_INDEXED_TEXT_LENGTH).
      // Longueur FIXE (≠ la plus longue valeur) : la contrainte est portée par
      // le CHECK, et une largeur dérivée des valeurs ferait de tout ajout un
      // changement de type de colonne.
      base = mysqlVarchar(name, { length: MYSQL_ENUM_LENGTH });
      break;
    case "json":
      // Compat MySQL (type binaire) + MariaDB (LONGTEXT) — cf mysqlJsonCompat.
      base = mysqlJsonCompat(name);
      break;
    case "bool":
      base = mysqlBoolean(name); // alias tinyint(1).
      break;
    case "epochMs":
    case "int64":
      // `int` MySQL = 32-bit → déborde sur un epoch ms, comme PG.
      base = mysqlBigint(name, { mode: "number" });
      break;
    case "int":
      base = mysqlInt(name);
      break;
    case "dateMs":
      // `datetime(3)` (précision ms, aligné SQLite/PG) et PAS `timestamp` :
      // timestamp MySQL est borné à 2038 et sensible à la timezone de session.
      // La connexion mysql2 est ouverte en `timezone: "Z"` (cf #connectMysql)
      // → écriture/lecture UTC symétriques, mêmes instants que timestamptz PG.
      base = mysqlDatetime(name, { mode: "date", fsp: 3 });
      break;
  }
  return applyMods(
    base as ChainableColumnBuilder,
    spec,
  ) as unknown as MySqlColumnBuilderBase;
}

/** Construit la variante MySQL d'une spec. */
function buildMysqlTable(spec: IFrameworkTableSpec): MySqlTable {
  // Colonnes référencées par au moins un index → candidates varchar (cf
  // mysqlColumn) ; les index eux-mêmes ne sortent que via drizzle-kit.
  const indexedCols = new Set<string>();
  for (const ix of spec.indexes ?? []) {
    for (const name of ix.on) {
      indexedCols.add(name);
    }
  }
  const columns: Record<string, MySqlColumnBuilderBase> = {};
  for (const [name, col] of Object.entries(spec.columns)) {
    columns[name] = mysqlColumn(name, col, indexedCols.has(name));
  }
  const indexes = spec.indexes;
  const checks = enumChecks(spec, "`");
  if (!indexes?.length && !checks.length) {
    return mysqlTable(spec.name, columns);
  }
  return mysqlTable(spec.name, columns, (t) => {
    const out: Record<string, unknown> = {};
    for (const ix of indexes ?? []) {
      const cols = indexColumns(
        spec,
        ix,
        t as unknown as Record<string, MySqlColumn>,
      );
      out[ix.name] = (
        ix.unique ? mysqlUniqueIndex(ix.name) : mysqlIndex(ix.name)
      ).on(...cols);
    }
    for (const ck of checks) {
      out[ck.name] = mysqlCheck(ck.name, ck.value);
    }
    return out as never;
  });
}

/**
 * Construit la table Drizzle d'une spec logique pour un dialecte donné —
 * **LE point unique** où « dialecte » se traduit en schéma (garde-fou G1 :
 * ajouter un dialecte = une branche ICI + les types du switch de colonnes).
 *
 * @param dialect - dialecte SQL cible.
 * @param spec - spec logique de la table.
 * @returns la table Drizzle du dialecte.
 */
export function buildFrameworkTable(
  dialect: "sqlite",
  spec: IFrameworkTableSpec,
): SQLiteTable;
export function buildFrameworkTable(
  dialect: "postgres",
  spec: IFrameworkTableSpec,
): PgTable;
export function buildFrameworkTable(
  dialect: "mysql",
  spec: IFrameworkTableSpec,
): MySqlTable;
export function buildFrameworkTable(
  dialect: SqlDialect,
  spec: IFrameworkTableSpec,
): SQLiteTable | PgTable | MySqlTable;
export function buildFrameworkTable(
  dialect: SqlDialect,
  spec: IFrameworkTableSpec,
): SQLiteTable | PgTable | MySqlTable {
  // Validation EAGER des index : le callback extraConfig de drizzle est lazy
  // (appelé au premier `getTableConfig`) → sans ce check, une faute de spec ne
  // sortirait qu'au DDL. Fail-loud à la construction (= au chargement du module).
  for (const ix of spec.indexes ?? []) {
    if (ix.on.length === 0) {
      throw new Error(
        `[@nodefony/drizzle] colKit "${spec.name}": index "${ix.name}" has no column.`,
      );
    }
    for (const name of ix.on) {
      if (!(name in spec.columns)) {
        throw new Error(
          `[@nodefony/drizzle] colKit "${spec.name}": index "${ix.name}" references ` +
            `unknown column "${name}" (declared: ${Object.keys(spec.columns).join(", ")}).`,
        );
      }
    }
  }
  switch (dialect) {
    case "sqlite":
      return buildSqliteTable(spec);
    case "postgres":
      return buildPgTable(spec);
    case "mysql":
      return buildMysqlTable(spec);
  }
}

/** Factory mémoïsée d'une entité framework — overloads par dialecte littéral. */
export interface FrameworkTableFactory {
  (dialect: "sqlite"): SQLiteTable;
  (dialect: "postgres"): PgTable;
  (dialect: "mysql"): MySqlTable;
  (dialect?: SqlDialect): SQLiteTable | PgTable | MySqlTable;
}

/**
 * Fabrique la factory `createXTable(dialect)` d'une entité framework : une
 * table par dialecte, construite au premier usage puis **mémoïsée** (une seule
 * instance par dialecte — le DDL, le registre d'entités et les stores voient
 * le même objet table).
 *
 * @param spec - spec logique de la table.
 * @returns factory mémoïsée (défaut `sqlite`).
 */
export function createFrameworkTableFactory(
  spec: IFrameworkTableSpec,
): FrameworkTableFactory {
  const cache = new Map<SqlDialect, SQLiteTable | PgTable | MySqlTable>();
  const factory = (
    dialect: SqlDialect = "sqlite",
  ): SQLiteTable | PgTable | MySqlTable => {
    let table = cache.get(dialect);
    if (!table) {
      table = buildFrameworkTable(dialect, spec);
      cache.set(dialect, table);
    }
    return table;
  };
  return factory as FrameworkTableFactory;
}
