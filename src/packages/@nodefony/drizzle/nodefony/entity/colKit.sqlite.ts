import { getTableColumns, sql } from "drizzle-orm";
import type { HasDefault, IsPrimaryKey, NotNull } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  ConvertCustomConfig,
  SQLiteBooleanBuilderInitial,
  SQLiteColumn,
  SQLiteColumnBuilderBase,
  SQLiteCustomColumnBuilder,
  SQLiteIntegerBuilderInitial,
  SQLiteRealBuilderInitial,
  SQLiteTable,
  SQLiteTableExtraConfigValue,
  SQLiteTextBuilderInitial,
  SQLiteTextJsonBuilderInitial,
  SQLiteTimestampBuilderInitial,
} from "drizzle-orm/sqlite-core";
import type {
  ColumnSpec,
  IDecimalColumn,
  IEnumColumn,
  IRefColumn,
  ITableSpec,
  OnDeleteAction,
} from "./colKit.spec";
import { canonicalDay, canonicalDecimal, canonicalUuid } from "./colKit.codecs";
import {
  checkName,
  enumPredicate,
  firstAndRest,
  indexedColumn,
  refTargetTable,
} from "./colKit.shared";
import { primaryKeyName, refTargetKey, refTargetSpec } from "./colKit.spec";
import type { KeyColumnSpec } from "./colKit.spec";
import type { StringCodecValues } from "./colKit.types";

/**
 * Fabrique SQLite du colKit.
 *
 * Chaque genre a SA fonction, dont le type de retour annoté est l'alias que
 * `colKit.types.ts` déclare : le compilateur vérifie, genre par genre, que la
 * fonction Drizzle appelée rend bien le builder annoncé. Les modificateurs
 * passent par une vue STRUCTURELLE du builder (`Chain`) — les classes
 * abstraites de Drizzle ne sont pas des sur-types de leurs builders concrets —,
 * à laquelle un builder concret est assignable sans conversion.
 *
 * Le point dur de SQLite est l'affinité : un type déclaré qui n'est ni INT, ni
 * TEXT, ni REAL, ni BLOB prend l'affinité NUMERIC, qui CONVERTIT un texte
 * d'allure numérique (`"12.50"` relu `12.5`). Tout ce qui doit rester exact ou
 * textuel va donc en TEXT (décimal, uuid, jour, enum, json), tout instant en
 * INTEGER milliseconde (64 bits, pas de borne 2038), le booléen en INTEGER 0/1.
 */

type AnyEnum = [string, ...string[]];
type AnyLength = number | undefined;

/** Vue structurelle commune des builders SQLite (ce que le kit appelle). */
interface Chain extends SQLiteColumnBuilderBase {
  primaryKey(): Chain;
  notNull(): Chain;
  unique(): Chain;
  $defaultFn(fn: () => unknown): Chain;
  $onUpdateFn(fn: () => unknown): Chain;
  references(
    ref: () => SQLiteColumn,
    actions?: { onDelete?: OnDeleteAction },
  ): Chain;
}

/** Longueur par défaut d'un `string`, ÉLARGIE en `number` (un littéral figerait `TLength`). */
const DEFAULT_STRING_LENGTH: number = 255;

// ─── un genre = une fonction, type de retour = alias de colKit.types.ts ───

function colString<K extends string>(
  k: K,
  length: number,
): SQLiteTextBuilderInitial<K, AnyEnum, number> {
  return text(k, { length });
}

function colText<K extends string>(
  k: K,
): SQLiteTextBuilderInitial<K, AnyEnum, AnyLength> {
  return text(k);
}

function colEnum<K extends string, V extends readonly [string, ...string[]]>(
  k: K,
  c: IEnumColumn<V>,
): SQLiteTextBuilderInitial<K, { -readonly [I in keyof V]: V[I] }, AnyLength> {
  return text(k, { enum: c.values });
}

function colJson<K extends string>(k: K): SQLiteTextJsonBuilderInitial<K> {
  return text(k, { mode: "json" });
}

function colInteger<K extends string>(k: K): SQLiteIntegerBuilderInitial<K> {
  return integer(k);
}

function colSerial<K extends string>(
  k: K,
): IsPrimaryKey<HasDefault<NotNull<SQLiteIntegerBuilderInitial<K>>>> {
  return integer(k).primaryKey({ autoIncrement: true });
}

function colReal<K extends string>(k: K): SQLiteRealBuilderInitial<K> {
  return real(k);
}

function colBool<K extends string>(k: K): SQLiteBooleanBuilderInitial<K> {
  return integer(k, { mode: "boolean" });
}

function colDatetime<K extends string>(k: K): SQLiteTimestampBuilderInitial<K> {
  return integer(k, { mode: "timestamp_ms" });
}

/** Colonne TEXT dont chaque écriture passe par un codec canonique. */
function colCodec<K extends string>(
  k: K,
  encode: (value: string) => string,
): SQLiteCustomColumnBuilder<ConvertCustomConfig<K, StringCodecValues>> {
  return customType<StringCodecValues>({
    dataType() {
      return "text";
    },
    toDriver: encode,
  })(k, undefined);
}

/**
 * Décimal en TEXT — PAS `numeric` : son affinité NUMERIC relit `"12.50"` en
 * `12.5` et 28 chiffres en un flottant arrondi (mesuré). Le codec écrit la
 * forme que PostgreSQL rendrait (`"12.50"`) et refuse ce qui déborde.
 */
function colDecimal<K extends string>(
  k: K,
  c: IDecimalColumn,
  label: string,
): SQLiteCustomColumnBuilder<ConvertCustomConfig<K, StringCodecValues>> {
  return colCodec(k, (value) =>
    canonicalDecimal(value, c.precision, c.scale, label),
  );
}

function colUuid<K extends string>(
  k: K,
  label: string,
): SQLiteCustomColumnBuilder<ConvertCustomConfig<K, StringCodecValues>> {
  return colCodec(k, (value) => canonicalUuid(value, label));
}

function colDate<K extends string>(
  k: K,
  label: string,
): SQLiteCustomColumnBuilder<ConvertCustomConfig<K, StringCodecValues>> {
  return colCodec(k, (value) => canonicalDay(value, label));
}

/** Clé primaire d'une table SQLite, lue par nom. */
function primaryKeyColumn(table: SQLiteTable, spec: ITableSpec): SQLiteColumn {
  const name = primaryKeyName(spec);
  const columns = getTableColumns(table);
  const column = Object.hasOwn(columns, name) ? columns[name] : undefined;
  if (column === undefined) {
    throw new Error(
      `[@nodefony/drizzle] colKit "${spec.name}": primary key "${name}" not found.`,
    );
  }
  return column;
}

/** Colonne qui porte la valeur d'une clé visée — même type que la clé, sans ses modificateurs. */
function keyValueColumn(k: string, key: KeyColumnSpec, label: string): Chain {
  switch (key.kind) {
    case "string":
      return colString(k, key.length ?? DEFAULT_STRING_LENGTH);
    case "char":
    case "text":
      return colText(k);
    case "uuid":
      return colUuid(k, label);
    case "serial":
      return colInteger(k);
  }
}

function colRef(
  k: string,
  c: IRefColumn,
  owner: ITableSpec,
  self: () => SQLiteTable,
): Chain {
  const base = keyValueColumn(
    k,
    refTargetKey(c, owner, k),
    `${owner.name}.${k}`,
  );
  const target = (): SQLiteColumn =>
    c.target === "self"
      ? primaryKeyColumn(self(), owner)
      : primaryKeyColumn(
          refTargetTable(c, owner, k).table("sqlite"),
          refTargetSpec(c, owner),
        );
  return base.references(target, c.onDelete ? { onDelete: c.onDelete } : {});
}

/** Colonne de base (sans modificateur) d'une spec. */
function baseColumn(
  k: string,
  c: ColumnSpec,
  owner: ITableSpec,
  self: () => SQLiteTable,
): Chain {
  const label = `${owner.name}.${k}`;
  switch (c.kind) {
    case "string":
      return colString(k, c.length ?? DEFAULT_STRING_LENGTH);
    case "char":
    case "text":
      return colText(k);
    case "decimal":
      return colDecimal(k, c, label);
    case "uuid":
      return colUuid(k, label);
    case "date":
      return colDate(k, label);
    case "enum":
      return colEnum(k, c);
    case "json":
      return colJson(k);
    case "int":
    case "int64":
      return colInteger(k);
    case "serial":
      return colSerial(k);
    case "float":
      return colReal(k);
    case "bool":
      return colBool(k);
    case "datetime":
      return colDatetime(k);
    case "ref":
      return colRef(k, c, owner, self);
    case "vector":
      throw new Error(
        `[@nodefony/drizzle] colKit "${owner.name}": column "${k}" is a vector(${c.dimensions}), ` +
          "which SQLite cannot store — PostgreSQL (pgvector) only, or a dedicated vector adapter.",
      );
  }
}

/** Modificateurs communs — même ordre que `ApplyMods` (colKit.types.ts). */
function applyMods(b: Chain, c: ColumnSpec): Chain {
  if (c.kind === "serial") {
    return b; // clé primaire déjà posée par `colSerial`.
  }
  let out = b;
  if ("primaryKey" in c) {
    out = out.primaryKey();
  }
  if (c.notNull) {
    out = out.notNull();
  }
  if (c.unique) {
    out = out.unique();
  }
  if ("defaultFn" in c) {
    out = out.$defaultFn(c.defaultFn);
  }
  if ("onUpdateFn" in c) {
    out = out.$onUpdateFn(c.onUpdateFn);
  }
  return out;
}

/**
 * Construit la table SQLite d'une spec.
 *
 * @param spec - spec logique (déjà validée par `assertTableSpec`).
 * @param self - la table en cours de construction, pour une relation vers soi.
 * @returns la table Drizzle SQLite.
 */
export function buildSqliteTable(
  spec: ITableSpec,
  self: () => SQLiteTable,
): SQLiteTable {
  const columns: Record<string, SQLiteColumnBuilderBase> = {};
  for (const [k, c] of Object.entries(spec.columns)) {
    columns[k] = applyMods(baseColumn(k, c, spec, self), c);
  }
  return sqliteTable(spec.name, columns, (t) => {
    const extras: SQLiteTableExtraConfigValue[] = [];
    for (const ix of spec.indexes ?? []) {
      const cols = firstAndRest(ix.on.map((name) => indexedColumn(t, name)));
      extras.push(
        (ix.unique ? uniqueIndex(ix.name) : index(ix.name)).on(...cols),
      );
    }
    for (const [k, c] of Object.entries(spec.columns)) {
      if (c.kind === "enum") {
        extras.push(
          check(
            checkName(spec.name, k, "check"),
            sql.raw(enumPredicate(k, c, '"')),
          ),
        );
      } else if (c.kind === "string") {
        // SQLite n'applique pas la longueur déclarée : le CHECK la fait
        // refuser par le SERVEUR, comme PostgreSQL et MySQL d'eux-mêmes.
        extras.push(
          check(
            checkName(spec.name, k, "len"),
            sql.raw(`length("${k}") <= ${c.length ?? DEFAULT_STRING_LENGTH}`),
          ),
        );
      } else if (c.kind === "char") {
        // Longueur EXACTE, espaces finaux ignorés — ce que PostgreSQL et MySQL
        // mesurent sur un `char(n)` (qu'ils complètent ou tronquent).
        extras.push(
          check(
            checkName(spec.name, k, "len"),
            sql.raw(`length(rtrim("${k}", ' ')) = ${c.length}`),
          ),
        );
      }
    }
    return extras;
  });
}
