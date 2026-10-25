import { getTableColumns, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import type {
  PgBigInt53BuilderInitial,
  PgBooleanBuilderInitial,
  PgCharBuilderInitial,
  PgColumn,
  PgColumnBuilderBase,
  PgDateStringBuilderInitial,
  PgDoublePrecisionBuilderInitial,
  PgIntegerBuilderInitial,
  PgJsonbBuilderInitial,
  PgNumericBuilderInitial,
  PgSerialBuilderInitial,
  PgTable,
  PgTableExtraConfigValue,
  PgTextBuilderInitial,
  PgTimestampBuilderInitial,
  PgUUIDBuilderInitial,
  PgVarcharBuilderInitial,
  PgVectorBuilderInitial,
} from "drizzle-orm/pg-core";
import type {
  ColumnSpec,
  IDecimalColumn,
  IEnumColumn,
  IRefColumn,
  ITableSpec,
  OnDeleteAction,
} from "./colKit.spec";
import {
  checkName,
  enumPredicate,
  firstAndRest,
  indexedColumn,
  refTargetTable,
} from "./colKit.shared";
import {
  columnName,
  primaryKeyName,
  refTargetKey,
  refTargetSpec,
} from "./colKit.spec";
import type { KeyColumnSpec } from "./colKit.spec";

/**
 * Fabrique PostgreSQL du colKit — même structure que `colKit.sqlite.ts`.
 *
 * PostgreSQL est la référence des valeurs relues : les codecs des deux autres
 * fabriques reproduisent ce qu'il rend (décimal à l'échelle, uuid minuscule).
 */

type AnyEnum = [string, ...string[]];

/** Vue structurelle commune des builders PostgreSQL (cf colKit.sqlite.ts). */
interface Chain extends PgColumnBuilderBase {
  primaryKey(): Chain;
  notNull(): Chain;
  unique(): Chain;
  $defaultFn(fn: () => unknown): Chain;
  $onUpdateFn(fn: () => unknown): Chain;
  references(
    ref: () => PgColumn,
    actions?: { onDelete?: OnDeleteAction },
  ): Chain;
}

/** Longueur par défaut d'un `string`, ÉLARGIE en `number` (un littéral figerait `TLength`). */
const DEFAULT_STRING_LENGTH: number = 255;

function colString<K extends string>(
  k: K,
  length: number,
): PgVarcharBuilderInitial<K, AnyEnum, number> {
  return varchar(k, { length });
}

function colChar<K extends string>(
  k: K,
  length: number,
): PgCharBuilderInitial<K, AnyEnum, number> {
  return char(k, { length });
}

function colText<K extends string>(k: K): PgTextBuilderInitial<K, AnyEnum> {
  return text(k);
}

/**
 * Énumération en `text` + `CHECK`, pas en `pgEnum` : un type nommé est un objet
 * SÉPARÉ de la table (`CREATE TYPE`), absent des deux autres dialectes et du
 * DDL dérivé — le `CHECK` donne la même garantie partout, avec une règle.
 */
function colEnum<K extends string, V extends readonly [string, ...string[]]>(
  k: K,
  c: IEnumColumn<V>,
): PgTextBuilderInitial<K, { -readonly [I in keyof V]: V[I] }> {
  return text(k, { enum: c.values });
}

function colJson<K extends string>(k: K): PgJsonbBuilderInitial<K> {
  return jsonb(k);
}

function colInt<K extends string>(k: K): PgIntegerBuilderInitial<K> {
  return integer(k);
}

/** `bigint` en mode `number` : exact sous 2⁵³ (`integer` PG est 32 bits). */
function colInt64<K extends string>(k: K): PgBigInt53BuilderInitial<K> {
  return bigint(k, { mode: "number" });
}

function colSerial<K extends string>(k: K): PgSerialBuilderInitial<K> {
  return serial(k);
}

function colFloat<K extends string>(k: K): PgDoublePrecisionBuilderInitial<K> {
  return doublePrecision(k);
}

function colDecimal<K extends string>(
  k: K,
  c: IDecimalColumn,
): PgNumericBuilderInitial<K> {
  return numeric(k, { precision: c.precision, scale: c.scale });
}

function colBool<K extends string>(k: K): PgBooleanBuilderInitial<K> {
  return boolean(k);
}

function colDate<K extends string>(k: K): PgDateStringBuilderInitial<K> {
  return date(k, { mode: "string" });
}

/** `timestamptz(3)` : un instant, à la milliseconde comme les deux autres moteurs. */
function colDatetime<K extends string>(k: K): PgTimestampBuilderInitial<K> {
  return timestamp(k, { withTimezone: true, precision: 3, mode: "date" });
}

function colUuid<K extends string>(k: K): PgUUIDBuilderInitial<K> {
  return uuid(k);
}

function colVector<K extends string>(
  k: K,
  dimensions: number,
): PgVectorBuilderInitial<K, number> {
  return vector(k, { dimensions });
}

/** Clé primaire d'une table PostgreSQL, lue par nom. */
function primaryKeyColumn(table: PgTable, spec: ITableSpec): PgColumn {
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

/** Colonne qui porte la valeur d'une clé visée — même type SQL, sinon PostgreSQL refuse (`42804`). */
function keyValueColumn(k: string, key: KeyColumnSpec): Chain {
  switch (key.kind) {
    case "string":
      return colString(k, key.length ?? DEFAULT_STRING_LENGTH);
    case "char":
      return colChar(k, key.length);
    case "text":
      return colText(k);
    case "uuid":
      return colUuid(k);
    case "serial":
      return colInt(k);
  }
}

function colRef(
  k: string,
  c: IRefColumn,
  owner: ITableSpec,
  self: () => PgTable,
): Chain {
  const base = keyValueColumn(columnName(k, c), refTargetKey(c, owner, k));
  const target = (): PgColumn =>
    c.target === "self"
      ? primaryKeyColumn(self(), owner)
      : primaryKeyColumn(
          refTargetTable(c, owner, k).table("postgres"),
          refTargetSpec(c, owner),
        );
  return base.references(target, c.onDelete ? { onDelete: c.onDelete } : {});
}

function baseColumn(
  k: string,
  c: ColumnSpec,
  owner: ITableSpec,
  self: () => PgTable,
): Chain {
  const n = columnName(k, c);
  switch (c.kind) {
    case "string":
      return colString(n, c.length ?? DEFAULT_STRING_LENGTH);
    case "char":
      return colChar(n, c.length);
    case "text":
      return colText(n);
    case "enum":
      return colEnum(n, c);
    case "json":
      return colJson(n);
    case "int":
      return colInt(n);
    case "int64":
      return colInt64(n);
    case "serial":
      return colSerial(n);
    case "float":
      return colFloat(n);
    case "decimal":
      return colDecimal(n, c);
    case "bool":
      return colBool(n);
    case "date":
      return colDate(n);
    case "datetime":
      return colDatetime(n);
    case "uuid":
      return colUuid(n);
    case "vector":
      return colVector(n, c.dimensions);
    case "ref":
      return colRef(k, c, owner, self);
  }
}

/** Modificateurs communs — même ordre que `ApplyMods` (colKit.types.ts). */
function applyMods(b: Chain, c: ColumnSpec): Chain {
  let out = b;
  if ("primaryKey" in c) {
    out = out.primaryKey();
  }
  if (c.kind === "serial") {
    return out;
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
 * Construit la table PostgreSQL d'une spec.
 *
 * @param spec - spec logique (déjà validée par `assertTableSpec`).
 * @param self - la table en cours de construction, pour une relation vers soi.
 * @returns la table Drizzle PostgreSQL.
 */
export function buildPgTable(spec: ITableSpec, self: () => PgTable): PgTable {
  const columns: Record<string, PgColumnBuilderBase> = {};
  for (const [k, c] of Object.entries(spec.columns)) {
    columns[k] = applyMods(baseColumn(k, c, spec, self), c);
  }
  return pgTable(spec.name, columns, (t) => {
    const extras: PgTableExtraConfigValue[] = [];
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
            checkName(spec.name, columnName(k, c), "check"),
            sql.raw(enumPredicate(columnName(k, c), c, '"')),
          ),
        );
      } else if (c.kind === "char") {
        // `char(n)` complète par des espaces que `char_length` ignore : une
        // valeur plus courte est refusée au lieu d'être relue rembourrée.
        extras.push(
          check(
            checkName(spec.name, columnName(k, c), "len"),
            sql.raw(`char_length("${columnName(k, c)}") = ${c.length}`),
          ),
        );
      }
    }
    return extras;
  });
}
