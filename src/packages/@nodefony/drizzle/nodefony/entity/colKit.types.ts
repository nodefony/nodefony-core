import type {
  $Type,
  BuildColumns,
  ColumnBuilderBase,
  HasDefault,
  HasRuntimeDefault,
  IsAutoincrement,
  IsPrimaryKey,
  NotNull,
  Writable,
} from "drizzle-orm";
import type {
  ConvertCustomConfig as MySqlConvertCustomConfig,
  MySqlBigInt53BuilderInitial,
  MySqlBooleanBuilderInitial,
  MySqlCharBuilderInitial,
  MySqlCustomColumnBuilder,
  MySqlDateStringBuilderInitial,
  MySqlDateTimeBuilderInitial,
  MySqlDecimalBuilderInitial,
  MySqlDoubleBuilderInitial,
  MySqlIntBuilderInitial,
  MySqlTable,
  MySqlTableWithColumns,
  MySqlTextBuilderInitial,
  MySqlVarCharBuilderInitial,
} from "drizzle-orm/mysql-core";
import type {
  PgBigInt53BuilderInitial,
  PgBooleanBuilderInitial,
  PgCharBuilderInitial,
  PgDateStringBuilderInitial,
  PgDoublePrecisionBuilderInitial,
  PgIntegerBuilderInitial,
  PgJsonbBuilderInitial,
  PgNumericBuilderInitial,
  PgSerialBuilderInitial,
  PgTable,
  PgTableWithColumns,
  PgTextBuilderInitial,
  PgTimestampBuilderInitial,
  PgUUIDBuilderInitial,
  PgVarcharBuilderInitial,
  PgVectorBuilderInitial,
} from "drizzle-orm/pg-core";
import type {
  ConvertCustomConfig as SqliteConvertCustomConfig,
  SQLiteBooleanBuilderInitial,
  SQLiteCustomColumnBuilder,
  SQLiteIntegerBuilderInitial,
  SQLiteRealBuilderInitial,
  SQLiteTable,
  SQLiteTableWithColumns,
  SQLiteTextBuilderInitial,
  SQLiteTextJsonBuilderInitial,
  SQLiteTimestampBuilderInitial,
} from "drizzle-orm/sqlite-core";
import type {
  ColumnSpec,
  HasVector,
  IEnumColumn,
  IJsonColumn,
  IJsonType,
  IRefColumn,
  IsWideSpec,
  ITableSpec,
  RefTargetKey,
} from "./colKit";

/**
 * Types de TABLE du colKit par dialecte, dérivés de la spec logique.
 *
 * Chaque genre est associé à l'alias `*BuilderInitial` que rend la fonction
 * Drizzle que la fabrique appelle — et la fabrique ANNOTE cette fonction avec
 * le même alias : le compilateur vérifie donc la correspondance genre par
 * genre. Les modificateurs passent par les MÊMES utilitaires que Drizzle
 * (`NotNull`, `IsPrimaryKey`, `HasDefault`, `HasRuntimeDefault`, `$Type`), de
 * sorte que `$inferSelect` / `$inferInsert` valent ce que donnerait une table
 * écrite à la main — et `RowOf` / `InsertOf` (test de types du module).
 *
 * Ce fichier ne porte aucun code. La surcharge de `defineTable` est la seule
 * frontière où ces types sont AFFIRMÉS plutôt que déduits ; ils sont tenus par
 * les annotations des fabriques, par l'égalité stricte avec `RowOf`, et par
 * l'aller-retour des valeurs sur les vrais moteurs.
 */

/** Valeurs d'une colonne texte à codec (décimal, uuid, jour). */
export type StringCodecValues = { data: string; driverData: string };

/** Valeurs de la colonne JSON tolérante MySQL / MariaDB. */
export type JsonCompatValues = { data: unknown; driverData: unknown };

type AnyEnum = [string, ...string[]];
type AnyLength = number | undefined;

// ─────────────── Modificateurs (identiques aux retours de Drizzle) ───────────────

type WithType<C, B extends ColumnBuilderBase> = C extends {
  kind: "json";
  type: IJsonType<infer T>;
}
  ? $Type<B, T>
  : B;

type WithDefault<C, B extends ColumnBuilderBase> = C extends {
  defaultFn: () => unknown;
}
  ? HasRuntimeDefault<HasDefault<B>>
  : C extends { onUpdateFn: () => unknown }
    ? HasDefault<B>
    : B;

type WithNotNull<C, B extends ColumnBuilderBase> = C extends { notNull: true }
  ? NotNull<B>
  : B;

/** `primaryKey()` rend `IsPrimaryKey<NotNull<this>>` (SQLite : sauf `serial`, déjà posé). */
type WithPrimaryKey<C, B extends ColumnBuilderBase> = C extends {
  primaryKey: true;
}
  ? IsPrimaryKey<NotNull<B>>
  : B;

/** Ordre d'application = ordre des appels dans les fabriques. */
type ApplyMods<C, B extends ColumnBuilderBase> = WithType<
  C,
  WithDefault<C, WithNotNull<C, WithPrimaryKey<C, B>>>
>;

/** SQLite : la clé `serial` sort de `colSerial` déjà posée — pas de second `primaryKey()`. */
type ApplySqliteMods<C, B extends ColumnBuilderBase> = C extends {
  kind: "serial";
}
  ? B
  : ApplyMods<C, B>;

/** Colonnes visées par un index de la spec. */
type IndexedKeys<S extends ITableSpec> = S extends {
  indexes: readonly (infer I)[];
}
  ? I extends { on: readonly (infer O)[] }
    ? O
    : never
  : never;

// ──────────────────────────────── SQLite ────────────────────────────────

type SqliteCodec<K extends string> = SQLiteCustomColumnBuilder<
  SqliteConvertCustomConfig<K, StringCodecValues>
>;

type SqliteKeyValue<K extends string, P> = P extends { kind: "string" }
  ? SQLiteTextBuilderInitial<K, AnyEnum, number>
  : P extends { kind: "char" | "text" }
    ? SQLiteTextBuilderInitial<K, AnyEnum, AnyLength>
    : P extends { kind: "uuid" }
      ? SqliteCodec<K>
      : P extends { kind: "serial" }
        ? SQLiteIntegerBuilderInitial<K>
        : never;

/** Builder SQLite d'une colonne, avant modificateurs. */
export type SqliteBase<
  S extends ITableSpec,
  K extends string,
  C extends ColumnSpec,
> =
  C extends IEnumColumn<infer V>
    ? SQLiteTextBuilderInitial<K, Writable<V>, AnyLength>
    : C extends IJsonColumn
      ? SQLiteTextJsonBuilderInitial<K>
      : C extends IRefColumn
        ? SqliteKeyValue<K, RefTargetKey<S, C>>
        : C extends { kind: "string" }
          ? SQLiteTextBuilderInitial<K, AnyEnum, number>
          : C extends { kind: "char" | "text" }
            ? SQLiteTextBuilderInitial<K, AnyEnum, AnyLength>
            : C extends { kind: "decimal" | "uuid" | "date" }
              ? SqliteCodec<K>
              : C extends { kind: "int" | "int64" }
                ? SQLiteIntegerBuilderInitial<K>
                : C extends { kind: "serial" }
                  ? IsPrimaryKey<
                      HasDefault<NotNull<SQLiteIntegerBuilderInitial<K>>>
                    >
                  : C extends { kind: "float" }
                    ? SQLiteRealBuilderInitial<K>
                    : C extends { kind: "bool" }
                      ? SQLiteBooleanBuilderInitial<K>
                      : C extends { kind: "datetime" }
                        ? SQLiteTimestampBuilderInitial<K>
                        : never;

type SqliteBuilders<S extends ITableSpec> = {
  [K in keyof S["columns"] & string]: ApplySqliteMods<
    S["columns"][K],
    SqliteBase<S, K, S["columns"][K]>
  >;
};

/** Table SQLite d'une spec — `never` si elle porte un `vector`. */
export type SqliteTableOf<S extends ITableSpec> =
  IsWideSpec<S> extends true
    ? SQLiteTable
    : HasVector<S> extends true
      ? never
      : SQLiteTableWithColumns<{
          name: S["name"];
          schema: undefined;
          columns: BuildColumns<S["name"], SqliteBuilders<S>, "sqlite">;
          dialect: "sqlite";
        }>;

// ─────────────────────────────── PostgreSQL ───────────────────────────────

type PgKeyValue<K extends string, P> = P extends { kind: "string" }
  ? PgVarcharBuilderInitial<K, AnyEnum, number>
  : P extends { kind: "char" }
    ? PgCharBuilderInitial<K, AnyEnum, number>
    : P extends { kind: "text" }
      ? PgTextBuilderInitial<K, AnyEnum>
      : P extends { kind: "uuid" }
        ? PgUUIDBuilderInitial<K>
        : P extends { kind: "serial" }
          ? PgIntegerBuilderInitial<K>
          : never;

/** Builder PostgreSQL d'une colonne, avant modificateurs. */
export type PgBase<
  S extends ITableSpec,
  K extends string,
  C extends ColumnSpec,
> =
  C extends IEnumColumn<infer V>
    ? PgTextBuilderInitial<K, Writable<V>>
    : C extends IJsonColumn
      ? PgJsonbBuilderInitial<K>
      : C extends IRefColumn
        ? PgKeyValue<K, RefTargetKey<S, C>>
        : C extends { kind: "string" }
          ? PgVarcharBuilderInitial<K, AnyEnum, number>
          : C extends { kind: "char" }
            ? PgCharBuilderInitial<K, AnyEnum, number>
            : C extends { kind: "text" }
              ? PgTextBuilderInitial<K, AnyEnum>
              : C extends { kind: "int" }
                ? PgIntegerBuilderInitial<K>
                : C extends { kind: "int64" }
                  ? PgBigInt53BuilderInitial<K>
                  : C extends { kind: "serial" }
                    ? PgSerialBuilderInitial<K>
                    : C extends { kind: "float" }
                      ? PgDoublePrecisionBuilderInitial<K>
                      : C extends { kind: "decimal" }
                        ? PgNumericBuilderInitial<K>
                        : C extends { kind: "bool" }
                          ? PgBooleanBuilderInitial<K>
                          : C extends { kind: "date" }
                            ? PgDateStringBuilderInitial<K>
                            : C extends { kind: "datetime" }
                              ? PgTimestampBuilderInitial<K>
                              : C extends { kind: "uuid" }
                                ? PgUUIDBuilderInitial<K>
                                : C extends { kind: "vector" }
                                  ? PgVectorBuilderInitial<K, number>
                                  : never;

type PgBuilders<S extends ITableSpec> = {
  [K in keyof S["columns"] & string]: ApplyMods<
    S["columns"][K],
    PgBase<S, K, S["columns"][K]>
  >;
};

/** Table PostgreSQL d'une spec. */
export type PgTableOf<S extends ITableSpec> =
  IsWideSpec<S> extends true
    ? PgTable
    : PgTableWithColumns<{
        name: S["name"];
        schema: undefined;
        columns: BuildColumns<S["name"], PgBuilders<S>, "pg">;
        dialect: "pg";
      }>;

// ──────────────────────────── MySQL / MariaDB ────────────────────────────

type MySqlCodec<K extends string> = MySqlCustomColumnBuilder<
  MySqlConvertCustomConfig<K, StringCodecValues>
>;

type MySqlKeyValue<K extends string, P> = P extends {
  kind: "string" | "text";
}
  ? MySqlVarCharBuilderInitial<K, AnyEnum, number>
  : P extends { kind: "char" }
    ? MySqlCharBuilderInitial<K, AnyEnum, number>
    : P extends { kind: "uuid" }
      ? MySqlCodec<K>
      : P extends { kind: "serial" }
        ? MySqlIntBuilderInitial<K>
        : never;

/** `text` MySQL : `varchar(512)` dès qu'il est clé, unique ou indexé (InnoDB). */
type MySqlText<S extends ITableSpec, K extends string, C> = C extends
  { primaryKey: true } | { unique: true }
  ? MySqlVarCharBuilderInitial<K, AnyEnum, number>
  : K extends IndexedKeys<S>
    ? MySqlVarCharBuilderInitial<K, AnyEnum, number>
    : MySqlTextBuilderInitial<K, AnyEnum>;

/** Builder MySQL d'une colonne, avant modificateurs. */
export type MySqlBase<
  S extends ITableSpec,
  K extends string,
  C extends ColumnSpec,
> =
  C extends IEnumColumn<infer V>
    ? MySqlVarCharBuilderInitial<K, Writable<V>, number>
    : C extends IJsonColumn
      ? MySqlCustomColumnBuilder<MySqlConvertCustomConfig<K, JsonCompatValues>>
      : C extends IRefColumn
        ? MySqlKeyValue<K, RefTargetKey<S, C>>
        : C extends { kind: "string" }
          ? MySqlVarCharBuilderInitial<K, AnyEnum, number>
          : C extends { kind: "char" }
            ? MySqlCharBuilderInitial<K, AnyEnum, number>
            : C extends { kind: "text" }
              ? MySqlText<S, K, C>
              : C extends { kind: "int" }
                ? MySqlIntBuilderInitial<K>
                : C extends { kind: "int64" }
                  ? MySqlBigInt53BuilderInitial<K>
                  : C extends { kind: "serial" }
                    ? IsAutoincrement<HasDefault<MySqlIntBuilderInitial<K>>>
                    : C extends { kind: "float" }
                      ? MySqlDoubleBuilderInitial<K>
                      : C extends { kind: "decimal" }
                        ? MySqlDecimalBuilderInitial<K>
                        : C extends { kind: "bool" }
                          ? MySqlBooleanBuilderInitial<K>
                          : C extends { kind: "date" }
                            ? MySqlDateStringBuilderInitial<K>
                            : C extends { kind: "datetime" }
                              ? MySqlDateTimeBuilderInitial<K>
                              : C extends { kind: "uuid" }
                                ? MySqlCodec<K>
                                : never;

type MySqlBuilders<S extends ITableSpec> = {
  [K in keyof S["columns"] & string]: ApplyMods<
    S["columns"][K],
    MySqlBase<S, K, S["columns"][K]>
  >;
};

/** Table MySQL / MariaDB d'une spec — `never` si elle porte un `vector`. */
export type MySqlTableOf<S extends ITableSpec> =
  IsWideSpec<S> extends true
    ? MySqlTable
    : HasVector<S> extends true
      ? never
      : MySqlTableWithColumns<{
          name: S["name"];
          schema: undefined;
          columns: BuildColumns<S["name"], MySqlBuilders<S>, "mysql">;
          dialect: "mysql";
        }>;
