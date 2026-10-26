import { getTableColumns, sql } from "drizzle-orm";
import type { HasDefault, IsAutoincrement } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  datetime,
  decimal,
  double,
  foreignKey,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type {
  ConvertCustomConfig,
  MySqlBigInt53BuilderInitial,
  MySqlBooleanBuilderInitial,
  MySqlCharBuilderInitial,
  MySqlColumn,
  MySqlColumnBuilderBase,
  MySqlCustomColumnBuilder,
  MySqlDateStringBuilderInitial,
  MySqlDateTimeBuilderInitial,
  MySqlDecimalBuilderInitial,
  MySqlDoubleBuilderInitial,
  MySqlIntBuilderInitial,
  MySqlTable,
  MySqlTableExtraConfigValue,
  MySqlTextBuilderInitial,
  MySqlVarCharBuilderInitial,
} from "drizzle-orm/mysql-core";
import type {
  ColumnSpec,
  IDecimalColumn,
  IEnumColumn,
  IRefColumn,
  ITableSpec,
} from "./colKit.spec";
import { canonicalUuid } from "./colKit.codecs";
import {
  boundedForeignKeyName,
  boundedUniqueName,
  checkName,
  enumPredicate,
  firstAndRest,
  indexedColumn,
  isIndexed,
  refTargetTable,
  literalDefaultFn,
} from "./colKit.shared";
import {
  ENUM_MAX_LENGTH,
  columnName,
  primaryKeyName,
  refTargetKey,
  refTargetSpec,
} from "./colKit.spec";
import type { KeyColumnSpec } from "./colKit.spec";
import type { JsonCompatValues, StringCodecValues } from "./colKit.types";

/**
 * Fabrique MySQL / MariaDB du colKit — même structure que `colKit.sqlite.ts`.
 *
 * Le dialecte `mysql` couvre MySQL 8.4 ET MariaDB 11.4 au plus petit
 * dénominateur : `datetime(3)` plutôt que `timestamp` (borne 2038, fuseau de
 * session), JSON tolérant (MariaDB le range en LONGTEXT), `varchar` pour tout
 * ce qui s'indexe (InnoDB n'indexe pas un TEXT sans préfixe).
 */

type AnyEnum = [string, ...string[]];

/** Vue structurelle commune des builders MySQL (cf colKit.sqlite.ts). */
interface Chain extends MySqlColumnBuilderBase {
  primaryKey(): Chain;
  notNull(): Chain;
  unique(name?: string): Chain;
  default(value: unknown): Chain;
  $defaultFn(fn: () => unknown): Chain;
  $onUpdateFn(fn: () => unknown): Chain;
}

/** Longueur par défaut d'un `string`, ÉLARGIE en `number` (un littéral figerait `TLength`). */
const DEFAULT_STRING_LENGTH: number = 255;

/**
 * Longueur d'un `text` INDEXABLE (`varchar(512)`) : InnoDB ne porte ni clé
 * primaire, ni unicité, ni index sur un TEXT sans préfixe. 512 × 4 octets
 * (utf8mb4) = 2 048 < 3 072, la limite d'index InnoDB en format DYNAMIC, et
 * couvre la plus longue valeur du framework (clé d'idempotence, ~330).
 */
const INDEXED_TEXT_LENGTH: number = 512;

/**
 * Largeur FIXE d'un `enum` (`varchar(64)`) : la borne est portée par le `CHECK`,
 * pas par le type — une largeur dérivée des valeurs ferait de tout ajout de
 * valeur un changement de type de colonne.
 */
const ENUM_LENGTH: number = ENUM_MAX_LENGTH;

/** Même colonne que le générateur : une entité déjà migrée ne change pas de type SQL. */
const UUID_LENGTH = 36;

/**
 * JSON tolérant au serveur : MySQL possède un type JSON binaire que `mysql2`
 * désérialise, MariaDB le range en alias LONGTEXT et le pilote rend une CHAÎNE.
 * Le `json()` natif de Drizzle ne parse pas à la lecture → on parse si chaîne.
 */
const jsonCompat = customType<JsonCompatValues>({
  dataType() {
    return "json";
  },
  toDriver(value: unknown): unknown {
    return JSON.stringify(value);
  },
  fromDriver(value: unknown): unknown {
    return typeof value === "string" ? JSON.parse(value) : value;
  },
});

function colString<K extends string>(
  k: K,
  length: number,
): MySqlVarCharBuilderInitial<K, AnyEnum, number> {
  return varchar(k, { length });
}

function colChar<K extends string>(
  k: K,
  length: number,
): MySqlCharBuilderInitial<K, AnyEnum, number> {
  return char(k, { length });
}

function colText<K extends string>(k: K): MySqlTextBuilderInitial<K, AnyEnum> {
  return text(k);
}

function colEnum<K extends string, V extends readonly [string, ...string[]]>(
  k: K,
  c: IEnumColumn<V>,
): MySqlVarCharBuilderInitial<K, { -readonly [I in keyof V]: V[I] }, number> {
  return varchar(k, { length: ENUM_LENGTH, enum: c.values });
}

function colJson<K extends string>(
  k: K,
): MySqlCustomColumnBuilder<ConvertCustomConfig<K, JsonCompatValues>> {
  return jsonCompat(k, undefined);
}

function colInt<K extends string>(k: K): MySqlIntBuilderInitial<K> {
  return int(k);
}

/** `bigint` en mode `number` : exact sous 2⁵³ (`int` MySQL est 32 bits). */
function colInt64<K extends string>(k: K): MySqlBigInt53BuilderInitial<K> {
  return bigint(k, { mode: "number" });
}

/** `int` auto-incrémenté — PAS le `serial` de Drizzle, qui vaut `bigint unsigned`. */
function colSerial<K extends string>(
  k: K,
): IsAutoincrement<HasDefault<MySqlIntBuilderInitial<K>>> {
  return int(k).autoincrement();
}

function colFloat<K extends string>(k: K): MySqlDoubleBuilderInitial<K> {
  return double(k);
}

function colDecimal<K extends string>(
  k: K,
  c: IDecimalColumn,
): MySqlDecimalBuilderInitial<K> {
  return decimal(k, { precision: c.precision, scale: c.scale });
}

function colBool<K extends string>(k: K): MySqlBooleanBuilderInitial<K> {
  return boolean(k);
}

function colDate<K extends string>(k: K): MySqlDateStringBuilderInitial<K> {
  return date(k, { mode: "string" });
}

/** `datetime(3)` ; la connexion est ouverte en `timezone: "Z"` (`DrizzleOrm`). */
function colDatetime<K extends string>(k: K): MySqlDateTimeBuilderInitial<K> {
  return datetime(k, { mode: "date", fsp: 3 });
}

/** UUID en `varchar(36)`, écrit sous la forme canonique que PostgreSQL rend. */
function colUuid<K extends string>(
  k: K,
  label: string,
): MySqlCustomColumnBuilder<ConvertCustomConfig<K, StringCodecValues>> {
  return customType<StringCodecValues>({
    dataType() {
      return `varchar(${UUID_LENGTH})`;
    },
    toDriver(value: string): string {
      return canonicalUuid(value, label);
    },
  })(k, undefined);
}

/** Clé primaire d'une table MySQL, lue par nom. */
function primaryKeyColumn(table: MySqlTable, spec: ITableSpec): MySqlColumn {
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

/**
 * Colonne qui porte la valeur d'une clé visée — même type SQL que la clé
 * (InnoDB l'exige), et un `text` y devient `varchar` : une clé étrangère est
 * toujours indexée.
 */
function keyValueColumn(k: string, key: KeyColumnSpec, label: string): Chain {
  switch (key.kind) {
    case "string":
      return colString(k, key.length ?? DEFAULT_STRING_LENGTH);
    case "char":
      return colChar(k, key.length);
    case "text":
      return colString(k, INDEXED_TEXT_LENGTH);
    case "uuid":
      return colUuid(k, label);
    case "serial":
      return colInt(k);
  }
}

function colRef(k: string, c: IRefColumn, owner: ITableSpec): Chain {
  const base = keyValueColumn(
    columnName(k, c),
    refTargetKey(c, owner, k),
    `${owner.name}.${k}`,
  );
  // La clé étrangère est posée au niveau de la TABLE, toujours NOMMÉE par le
  // kit (`buildTable`) : une colonne ne sait pas nommer la sienne.
  return base;
}

function baseColumn(k: string, c: ColumnSpec, owner: ITableSpec): Chain {
  const n = columnName(k, c);
  const label = `${owner.name}.${k}`;
  switch (c.kind) {
    case "string":
      return colString(n, c.length ?? DEFAULT_STRING_LENGTH);
    case "char":
      return colChar(n, c.length);
    case "text":
      return "primaryKey" in c || c.unique || isIndexed(owner, k)
        ? colString(n, INDEXED_TEXT_LENGTH)
        : colText(n);
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
      return colUuid(n, label);
    case "ref":
      return colRef(k, c, owner);
    case "vector":
      throw new Error(
        `[@nodefony/drizzle] colKit "${owner.name}": column "${k}" is a vector(${c.dimensions}), ` +
          "which MySQL 8.4 and MariaDB 11.4 cannot store — PostgreSQL (pgvector) only, or a dedicated vector adapter.",
      );
  }
}

/** Modificateurs communs — même ordre que `ApplyMods` (colKit.types.ts). */
function applyMods(b: Chain, c: ColumnSpec, uniqueName: string): Chain {
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
    out = out.unique(uniqueName);
  }
  if ("default" in c && c.default !== undefined) {
    out = out.default(c.default).$defaultFn(literalDefaultFn(c.default));
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
 * Construit la table MySQL / MariaDB d'une spec.
 *
 * @param spec - spec logique (déjà validée par `assertTableSpec`).
 * @returns la table Drizzle MySQL.
 */
export function buildMySqlTable(spec: ITableSpec): MySqlTable {
  const columns: Record<string, MySqlColumnBuilderBase> = {};
  for (const [k, c] of Object.entries(spec.columns)) {
    columns[k] = applyMods(
      baseColumn(k, c, spec),
      c,
      boundedUniqueName(spec.name, columnName(k, c)),
    );
  }
  return mysqlTable(spec.name, columns, (t) => {
    const extras: MySqlTableExtraConfigValue[] = [];
    for (const ix of spec.indexes ?? []) {
      const cols = firstAndRest(ix.on.map((name) => indexedColumn(t, name)));
      extras.push(
        (ix.unique ? uniqueIndex(ix.name) : index(ix.name)).on(...cols),
      );
    }
    for (const [k, c] of Object.entries(spec.columns)) {
      if (c.kind !== "ref") continue;
      const name = boundedForeignKeyName(spec, k, c);
      const target =
        c.target === "self"
          ? indexedColumn(t, primaryKeyName(spec))
          : primaryKeyColumn(
              refTargetTable(c, spec, k).table("mysql"),
              refTargetSpec(c, spec),
            );
      extras.push(
        foreignKey({
          name,
          columns: [indexedColumn(t, k)],
          foreignColumns: [target],
        }).onDelete(c.onDelete ?? "no action"),
      );
    }
    for (const [k, c] of Object.entries(spec.columns)) {
      if (c.kind === "enum") {
        extras.push(
          check(
            checkName(spec.name, columnName(k, c), "check"),
            sql.raw(enumPredicate(columnName(k, c), c, "`")),
          ),
        );
      } else if (c.kind === "char") {
        // `char_length` (caractères), pas `length` (octets) ; MySQL retire les
        // espaces finaux d'un CHAR, comme PostgreSQL les ignore.
        extras.push(
          check(
            checkName(spec.name, columnName(k, c), "len"),
            sql.raw(`char_length(\`${columnName(k, c)}\`) = ${c.length}`),
          ),
        );
      }
    }
    return extras;
  });
}
