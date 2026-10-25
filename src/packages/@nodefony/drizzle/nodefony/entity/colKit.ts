import type { Simplify } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import type { PgTable } from "drizzle-orm/pg-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import { buildMySqlTable } from "./colKit.mysql";
import { buildPgTable } from "./colKit.pg";
import { buildSqliteTable } from "./colKit.sqlite";
import { ENUM_MAX_LENGTH } from "./colKit.shared";
import type { MySqlTableOf, PgTableOf, SqliteTableOf } from "./colKit.types";

/**
 * colKit — kit de colonnes PORTABLE : une entité décrit ses colonnes UNE fois,
 * en types logiques, et le kit fabrique la table Drizzle du dialecte du
 * connecteur (`sqliteTable`, `pgTable`, `mysqlTable`).
 *
 * **Pourquoi** : une table Drizzle appartient à un seul dialecte. Sans kit, une
 * entité écrite pour SQLite refuse de se charger sur PostgreSQL ou MySQL, et
 * changer de base revient à réécrire le schéma. Le kit ne réécrit pas Drizzle :
 * il CHOISIT la colonne Drizzle de chaque moteur pour chaque type logique ;
 * Drizzle fait le SQL, les requêtes et les migrations.
 *
 * **Règles portées par construction** :
 * - mêmes **NOMS** de colonnes sur tous les dialectes, et même valeur
 *   JavaScript relue (le type de ligne {@link RowOf} est unique) ;
 * - ce qu'un moteur ne vérifie pas, une contrainte le fait refuser par le
 *   SERVEUR comme ailleurs : longueur d'un `string(n)` en SQLite, longueur
 *   exacte d'un `char(n)` partout, valeurs d'un `enum` partout (`CHECK`) ;
 * - ce qu'un moteur range différemment est rendu CANONIQUE à l'écriture
 *   (`decimal` au nombre de décimales de l'échelle, `uuid` en minuscules, jour
 *   `YYYY-MM-DD` validé) — la valeur relue est celle que PostgreSQL rendrait ;
 * - un type sans équivalent fidèle n'est JAMAIS approximé : `vector` est refusé
 *   hors PostgreSQL, au type (`never`) ET à la fabrication, en le nommant ;
 * - défauts en `defaultFn`/`onUpdateFn` (JavaScript) uniquement : le DDL dérivé
 *   n'émet pas de `DEFAULT` SQL.
 *
 * Correspondance type logique → colonne de chaque moteur : `docs/index.md`
 * du module, section « Des entités qui suivent la base ».
 */

/** Action d'une clé étrangère à la suppression de la ligne visée. */
export type OnDeleteAction = "restrict" | "cascade" | "set null" | "no action";

/** Modificateurs communs ; `TData` borne un défaut au type de la colonne. */
export interface IColumnMods<TData> {
  /** La colonne refuse `NULL`. */
  readonly notNull?: true;
  /** Contrainte d'unicité de colonne. */
  readonly unique?: true;
  /** Défaut calculé en JavaScript à l'insertion (jamais de `DEFAULT` SQL). */
  readonly defaultFn?: () => TData;
  /** Valeur recalculée à chaque `UPDATE` (pendant SQL d'`updatedAt`). */
  readonly onUpdateFn?: () => TData;
}

/** Modificateurs d'une colonne qui peut être CLÉ PRIMAIRE (chaîne ou uuid). */
export interface IKeyColumnMods<TData> extends IColumnMods<TData> {
  /** Clé primaire de la table — une seule par spec. */
  readonly primaryKey?: true;
}

/** Chaîne bornée — `varchar(n)` ; en SQLite, la borne est un `CHECK`. */
export interface IStringColumn extends IKeyColumnMods<string> {
  readonly kind: "string";
  /** Longueur maximale en caractères (défaut 255). */
  readonly length?: number;
}

/** Chaîne de longueur EXACTE `n` — `char(n)` + `CHECK` de longueur, partout. */
export interface ICharColumn extends IKeyColumnMods<string> {
  readonly kind: "char";
  readonly length: number;
}

/** Texte non borné — `varchar(512)` en MySQL s'il est indexé (InnoDB). */
export interface ITextColumn extends IKeyColumnMods<string> {
  readonly kind: "text";
}

/** Entier 32 bits signé — réservé aux valeurs bornées par le domaine. */
export interface IIntColumn extends IColumnMods<number> {
  readonly kind: "int";
}

/** Entier 64 bits, exact jusqu'à 2⁵³−1 — compteurs, horodatages epoch ms. */
export interface IInt64Column extends IColumnMods<number> {
  readonly kind: "int64";
}

/** Clé primaire entière auto-incrémentée — `serial` PostgreSQL. */
export interface ISerialColumn {
  readonly kind: "serial";
  readonly primaryKey: true;
}

/** Flottant IEEE 754 double précision. */
export interface IFloatColumn extends IColumnMods<number> {
  readonly kind: "float";
}

/** Décimal exact, rendu en chaîne (`"12.50"`) — `numeric(p,s)` / `decimal(p,s)`. */
export interface IDecimalColumn extends IColumnMods<string> {
  readonly kind: "decimal";
  /** Nombre total de chiffres (1 à 65). */
  readonly precision: number;
  /** Chiffres après la virgule (0 à 30, au plus `precision`). */
  readonly scale: number;
}

/** Booléen. */
export interface IBoolColumn extends IColumnMods<boolean> {
  readonly kind: "bool";
}

/**
 * Marqueur du type d'une colonne JSON : `T` est FANTÔME (l'objet est vide à
 * l'exécution). C'est la seule façon de porter un type dans un littéral de spec
 * sans perdre les modificateurs littéraux (`notNull: true`) qu'un helper
 * `json<T>(mods)` effacerait de son type de retour.
 */
export interface IJsonType<T> {
  readonly __type?: T;
}

/**
 * Déclare la forme d'une colonne JSON dans une spec.
 *
 * @example `roles: { kind: "json", type: jsonType<string[]>(), notNull: true }`
 * @returns un marqueur vide, lu par le seul compilateur.
 */
export function jsonType<T>(): IJsonType<T> {
  return {};
}

/** JSON — `type: jsonType<T>()` pour une forme connue, sinon `unknown`. */
export interface IJsonColumn<T = unknown> extends IColumnMods<T> {
  readonly kind: "json";
  readonly type?: IJsonType<T>;
}

/** Jour calendaire SANS heure ni fuseau — rendu `"YYYY-MM-DD"` partout. */
export interface IDateColumn extends IColumnMods<string> {
  readonly kind: "date";
}

/** Instant (UTC, précision milliseconde) — rendu `Date` partout. */
export interface IDatetimeColumn extends IColumnMods<Date> {
  readonly kind: "datetime";
}

/** UUID, rendu en minuscules canoniques — `uuid` natif PostgreSQL. */
export interface IUuidColumn extends IKeyColumnMods<string> {
  readonly kind: "uuid";
}

/**
 * Valeurs énumérées, bornées en base par un `CHECK` (pas seulement au type).
 *
 * ⚠️ **Un `CHECK` se grave à vie** dans la migration qui le crée : y ajouter une
 * valeur impose une migration correctrice. Réserver l'`enum` à un ensemble
 * FERMÉ par construction (les états d'un automate) ; un catalogue appelé à
 * s'étendre reste un `text`, dont l'union vit au type de la ligne.
 */
export interface IEnumColumn<
  V extends readonly [string, ...string[]] = readonly [string, ...string[]],
> extends IColumnMods<V[number]> {
  readonly kind: "enum";
  /** Valeurs admises (64 caractères au plus chacune). */
  readonly values: V;
}

/** Vecteur pgvector — PostgreSQL seulement, refusé ailleurs en le nommant. */
export interface IVectorColumn extends IColumnMods<number[]> {
  readonly kind: "vector";
  readonly dimensions: number;
}

/**
 * Clé étrangère — la colonne prend le type de la clé primaire VISÉE.
 *
 * `target` désigne l'entité par une fonction (la cible peut être déclarée plus
 * bas dans le fichier) ou par `"self"` pour une relation vers soi : un thunk
 * vers la constante en cours d'initialisation rendrait son type implicite
 * (`TS7022`).
 */
export interface IRefColumn {
  readonly kind: "ref";
  readonly target: "self" | (() => IPortableTableBase);
  readonly notNull?: true;
  readonly unique?: true;
  readonly onDelete?: OnDeleteAction;
}

/** Spec logique d'une colonne. */
export type ColumnSpec =
  | IStringColumn
  | ICharColumn
  | ITextColumn
  | IIntColumn
  | IInt64Column
  | ISerialColumn
  | IFloatColumn
  | IDecimalColumn
  | IBoolColumn
  | IJsonColumn
  | IDateColumn
  | IDatetimeColumn
  | IUuidColumn
  | IEnumColumn
  | IVectorColumn
  | IRefColumn;

/** Genre logique d'une colonne. */
export type ColumnKind = ColumnSpec["kind"];

/** Index déclaratif — émis par le DDL dérivé (dev) et par drizzle-kit (prod). */
export interface IIndexSpec {
  readonly name: string;
  /** Noms de colonnes de la spec (validés à la déclaration). */
  readonly on: readonly [string, ...string[]];
  readonly unique?: true;
}

/** Spec logique d'une table. */
export interface ITableSpec {
  readonly name: string;
  readonly columns: Readonly<Record<string, ColumnSpec>>;
  readonly indexes?: readonly IIndexSpec[];
}

/**
 * Vue LARGE d'une table portable — ce qu'une référence (`ref`) accepte pour
 * cible, et ce qu'un consommateur qui ne connaît pas la spec manipule.
 *
 * Elle ne nomme que les classes de table Drizzle : la vue précise
 * (`SqliteTableOf<ITableSpec>`) figerait `notNull: false` sur toute colonne et
 * aucune table réelle ne lui serait assignable — la spec raterait alors sa
 * contrainte et tout se dégraderait en cascade. Le type précis de la cible est
 * retrouvé par `infer` sur `spec`.
 */
export interface IPortableTableBase {
  readonly spec: ITableSpec;
  readonly table: ITableFactoryBase;
}

/** Fabrique de table par dialecte, vue LARGE. */
export interface ITableFactoryBase {
  (dialect: "sqlite"): SQLiteTable;
  (dialect: "postgres"): PgTable;
  (dialect: "mysql"): MySqlTable;
  (dialect: SqlDialect): SQLiteTable | PgTable | MySqlTable;
}

/** Fabrique de table par dialecte, typée par la spec. */
export interface ITableFactory<S extends ITableSpec> {
  (dialect: "sqlite"): SqliteTableOf<S>;
  (dialect: "postgres"): PgTableOf<S>;
  (dialect: "mysql"): MySqlTableOf<S>;
  (dialect: SqlDialect): SqliteTableOf<S> | PgTableOf<S> | MySqlTableOf<S>;
}

/** Ce que rend {@link defineTable} : la spec et la fabrique par dialecte. */
export interface IPortableTable<
  S extends ITableSpec,
> extends IPortableTableBase {
  readonly spec: S;
  readonly table: ITableFactory<S>;
}

// ───────────────────────── Dérivation des types de ligne ─────────────────────────

/** `true` quand la spec n'est pas un littéral (colonnes calculées) : son type est large. */
export type IsWideSpec<S extends ITableSpec> = string extends keyof S["columns"]
  ? true
  : false;

/** Clé de la colonne `primaryKey` d'une spec. */
export type PrimaryKeyOf<S extends ITableSpec> = {
  [K in keyof S["columns"]]: S["columns"][K] extends { primaryKey: true }
    ? K
    : never;
}[keyof S["columns"]];

/** Spec de la table visée par une référence. */
export type RefTargetSpec<S extends ITableSpec, C> = C extends {
  target: "self";
}
  ? S
  : C extends { target: () => { spec: infer T } }
    ? T extends ITableSpec
      ? T
      : never
    : never;

/** Spec de la clé primaire visée par une référence. */
export type RefTargetKey<S extends ITableSpec, C> = RefTargetSpec<
  S,
  C
>["columns"][PrimaryKeyOf<RefTargetSpec<S, C>>];

/** Type JavaScript rendu à la LECTURE pour une colonne — identique sur les trois dialectes. */
export type DataOf<S extends ITableSpec, C extends ColumnSpec> = C extends {
  kind: "json";
}
  ? C extends { type: IJsonType<infer T> }
    ? T
    : unknown
  : C extends IEnumColumn<infer V>
    ? V[number]
    : C extends IRefColumn
      ? RefTargetKey<S, C> extends infer P extends ColumnSpec
        ? DataOf<RefTargetSpec<S, C>, P>
        : never
      : C extends {
            kind: "string" | "char" | "text" | "decimal" | "date" | "uuid";
          }
        ? string
        : C extends { kind: "int" | "int64" | "serial" | "float" }
          ? number
          : C extends { kind: "bool" }
            ? boolean
            : C extends { kind: "datetime" }
              ? Date
              : C extends { kind: "vector" }
                ? number[]
                : never;

/** La colonne accepte-t-elle `NULL` ? */
export type IsNullable<C> = C extends { notNull: true } | { primaryKey: true }
  ? false
  : true;

type HasInsertDefault<C> = C extends { kind: "serial" }
  ? true
  : C extends { defaultFn: () => unknown }
    ? true
    : C extends { onUpdateFn: () => unknown }
      ? true
      : false;

type OptionalOnInsert<C> =
  IsNullable<C> extends true ? true : HasInsertDefault<C>;

/** Ligne telle que le repository la rend — égale à `$inferSelect` des trois tables. */
export type RowOf<S extends ITableSpec> =
  IsWideSpec<S> extends true
    ? Record<string, unknown>
    : Simplify<{
        -readonly [K in keyof S["columns"]]:
          | DataOf<S, S["columns"][K]>
          | (IsNullable<S["columns"][K]> extends true ? null : never);
      }>;

/** Données d'insertion — égales à `$inferInsert` des trois tables. */
export type InsertOf<S extends ITableSpec> =
  IsWideSpec<S> extends true
    ? Record<string, unknown>
    : Simplify<
        {
          -readonly [
            K in keyof S["columns"] as OptionalOnInsert<
              S["columns"][K]
            > extends true
              ? never
              : K
          ]: DataOf<S, S["columns"][K]>;
        } & {
          -readonly [
            K in keyof S["columns"] as OptionalOnInsert<
              S["columns"][K]
            > extends true
              ? K
              : never
          ]?:
            | DataOf<S, S["columns"][K]>
            | (IsNullable<S["columns"][K]> extends true ? null : never)
            | undefined;
        }
      >;

/** `true` si la spec porte un type que seul PostgreSQL sait ranger. */
export type HasVector<S extends ITableSpec> = {
  [K in keyof S["columns"]]: S["columns"][K] extends { kind: "vector" }
    ? true
    : never;
}[keyof S["columns"]] extends never
  ? false
  : true;

// ───────────────────────────── Validation et fabrique ─────────────────────────────

/** Bornes de MySQL, plus étroites que celles de PostgreSQL (le kit tient la plus petite). */
const DECIMAL_MAX_PRECISION = 65;
const DECIMAL_MAX_SCALE = 30;
/** Dimensions maximales d'une colonne pgvector `vector`. */
const VECTOR_MAX_DIMENSIONS = 16000;

function isPositiveInteger(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

/**
 * Refuse une spec que le kit fabriquerait mal — à la DÉCLARATION, donc au
 * chargement du module, plutôt qu'au premier DDL.
 *
 * @param spec - spec logique de la table.
 * @throws Quand une borne est hors limites, un index vise une colonne inconnue,
 *   ou que la table porte plus d'une clé primaire.
 */
export function assertTableSpec(spec: ITableSpec): void {
  const fail = (message: string): never => {
    throw new Error(`[@nodefony/drizzle] colKit "${spec.name}": ${message}`);
  };
  let primaryKeys = 0;
  for (const [name, column] of Object.entries(spec.columns)) {
    if ("primaryKey" in column) {
      primaryKeys += 1;
    }
    switch (column.kind) {
      case "string":
        if (
          column.length !== undefined &&
          !isPositiveInteger(column.length, 65535)
        ) {
          fail(`column "${name}" has an invalid length ${column.length}.`);
        }
        break;
      case "char":
        if (!isPositiveInteger(column.length, 255)) {
          fail(`column "${name}" has an invalid char length ${column.length}.`);
        }
        break;
      case "decimal":
        if (
          !isPositiveInteger(column.precision, DECIMAL_MAX_PRECISION) ||
          !Number.isInteger(column.scale) ||
          column.scale < 0 ||
          column.scale > DECIMAL_MAX_SCALE ||
          column.scale > column.precision
        ) {
          fail(
            `column "${name}" has an invalid decimal(${column.precision}, ${column.scale}) ` +
              `(precision 1-${DECIMAL_MAX_PRECISION}, scale 0-${DECIMAL_MAX_SCALE} and at most the precision).`,
          );
        }
        break;
      case "enum": {
        if (column.values.length === 0) {
          fail(`enum column "${name}" has no value.`);
        }
        if (new Set(column.values).size !== column.values.length) {
          fail(`enum column "${name}" repeats a value.`);
        }
        const tooLong = column.values.find(
          (value) => value.length > ENUM_MAX_LENGTH,
        );
        if (tooLong !== undefined) {
          fail(
            `enum column "${name}": value "${tooLong}" exceeds ${ENUM_MAX_LENGTH} characters.`,
          );
        }
        break;
      }
      case "vector":
        if (!isPositiveInteger(column.dimensions, VECTOR_MAX_DIMENSIONS)) {
          fail(
            `column "${name}" has invalid vector dimensions ${column.dimensions}.`,
          );
        }
        break;
      case "text":
      case "int":
      case "int64":
      case "serial":
      case "float":
      case "bool":
      case "json":
      case "date":
      case "datetime":
      case "uuid":
      case "ref":
        break;
    }
  }
  if (primaryKeys > 1) {
    fail(`declares ${primaryKeys} primary keys (one at most).`);
  }
  for (const ix of spec.indexes ?? []) {
    if (ix.on.length === 0) {
      fail(`index "${ix.name}" has no column.`);
    }
    for (const name of ix.on) {
      if (!Object.hasOwn(spec.columns, name)) {
        fail(
          `index "${ix.name}" references unknown column "${name}" ` +
            `(declared: ${Object.keys(spec.columns).join(", ")}).`,
        );
      }
    }
  }
}

type AnyTable = SQLiteTable | PgTable | MySqlTable;

/**
 * Déclare une table PORTABLE : une spec logique, une table Drizzle par
 * dialecte, construite au premier usage puis mémoïsée (le DDL, le registre
 * d'entités et les stores voient le même objet).
 *
 * La spec est un littéral d'objet inféré en `const` : les types de la table
 * (`$inferSelect`, `$inferInsert`, colonnes pour `eq()`/`asc()`) sont exacts sur
 * chaque dialecte et égaux à {@link RowOf}/{@link InsertOf}.
 *
 * @example
 * ```ts
 * export const article = defineTable({
 *   name: "article",
 *   columns: {
 *     id: { kind: "uuid", primaryKey: true, defaultFn: () => randomUUID() },
 *     title: { kind: "string", length: 120, notNull: true },
 *     status: { kind: "enum", values: ["draft", "live"], notNull: true },
 *   },
 * });
 * const table = article.table("postgres"); // PgTableWithColumns<…>
 * ```
 *
 * @param spec - spec logique de la table.
 * @returns la spec et sa fabrique par dialecte.
 * @throws Quand la spec est invalide ({@link assertTableSpec}).
 */
export function defineTable<const S extends ITableSpec>(
  spec: S,
): IPortableTable<S> {
  assertTableSpec(spec);
  let sqlite: SQLiteTable | null = null;
  let postgres: PgTable | null = null;
  let mysql: MySqlTable | null = null;

  function table(dialect: "sqlite"): SqliteTableOf<S>;
  function table(dialect: "postgres"): PgTableOf<S>;
  function table(dialect: "mysql"): MySqlTableOf<S>;
  function table(
    dialect: SqlDialect,
  ): SqliteTableOf<S> | PgTableOf<S> | MySqlTableOf<S>;
  function table(dialect: SqlDialect): AnyTable {
    switch (dialect) {
      case "sqlite":
        sqlite ??= buildSqliteTable(spec, () => {
          if (sqlite === null) {
            throw new Error(
              `[@nodefony/drizzle] colKit "${spec.name}": self-reference resolved too early.`,
            );
          }
          return sqlite;
        });
        return sqlite;
      case "postgres":
        postgres ??= buildPgTable(spec, () => {
          if (postgres === null) {
            throw new Error(
              `[@nodefony/drizzle] colKit "${spec.name}": self-reference resolved too early.`,
            );
          }
          return postgres;
        });
        return postgres;
      case "mysql":
        mysql ??= buildMySqlTable(spec, () => {
          if (mysql === null) {
            throw new Error(
              `[@nodefony/drizzle] colKit "${spec.name}": self-reference resolved too early.`,
            );
          }
          return mysql;
        });
        return mysql;
    }
  }

  return { spec, table };
}
