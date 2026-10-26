import { getTableColumns, sql } from "drizzle-orm";
import type {
  HasDefault,
  IsPrimaryKey,
  NotNull,
  SQL,
  SQLWrapper,
} from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
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
import {
  canonicalDay,
  canonicalDecimal,
  canonicalUuid,
  ColumnValueError,
} from "./colKit.codecs";
import {
  boundedForeignKeyName,
  boundedUniqueName,
  checkName,
  decimalShapeOf,
  enumPredicate,
  firstAndRest,
  indexedColumn,
  refTargetTable,
  literalDefaultFn,
} from "./colKit.shared";
import {
  columnName,
  primaryKeyName,
  refTargetKey,
  refTargetSpec,
} from "./colKit.spec";
import type { IDecimalShape } from "./colKit.shared";
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
  unique(name?: string): Chain;
  default(value: unknown): Chain;
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
 *
 * Le prix : comparé tel quel, le texte s'ordonne en ALPHABET (`"9.5"` >
 * `"100"`). Toute comparaison d'ordre passe donc par {@link numericOperand},
 * sur les colonnes que {@link isTextDecimal} reconnaît.
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
    columnName(k, c),
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
  // Nom par défaut trop long : la contrainte est posée au niveau de la TABLE,
  // nommée (`buildSqliteTable`) — une colonne ne sait pas nommer la sienne.
  if (boundedForeignKeyName(owner, k, c) !== null) return base;
  return base.references(target, c.onDelete ? { onDelete: c.onDelete } : {});
}

/** Colonne de base (sans modificateur) d'une spec. */
function baseColumn(
  k: string,
  c: ColumnSpec,
  owner: ITableSpec,
  self: () => SQLiteTable,
): Chain {
  const n = columnName(k, c);
  const label = `${owner.name}.${k}`;
  switch (c.kind) {
    case "string":
      return colString(n, c.length ?? DEFAULT_STRING_LENGTH);
    case "char":
    case "text":
      return colText(n);
    case "decimal":
      return colDecimal(n, c, label);
    case "uuid":
      return colUuid(n, label);
    case "date":
      return colDate(n, label);
    case "enum":
      return colEnum(n, c);
    case "json":
      return colJson(n);
    case "int":
    case "int64":
      return colInteger(n);
    case "serial":
      return colSerial(n);
    case "float":
      return colReal(n);
    case "bool":
      return colBool(n);
    case "datetime":
      return colDatetime(n);
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
function applyMods(
  b: Chain,
  c: ColumnSpec,
  uniqueName: string | undefined,
): Chain {
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
 * Dit si une colonne est un décimal que SQLite range en TEXT, donc qu'une
 * comparaison d'ordre doit lire par {@link numericOperand}.
 *
 * La marque est posée à la construction par `markDecimalColumns`
 * (`colKit.shared.ts`), jamais déduite du type SQL (`text` porte aussi les
 * jours et les uuid) ni d'un interne de Drizzle.
 *
 * @param column - colonne d'une table SQLite.
 * @returns `true` pour un décimal du kit.
 */
export function isTextDecimal(column: object): boolean {
  return decimalShapeOf(column) !== null;
}

/**
 * Lit un décimal rangé en TEXT comme un NOMBRE, pour `<`, `>` et `ORDER BY`.
 *
 * SEUL point qui porte cette règle (colonne et valeur comparée). Le `REAL` est
 * exact jusqu'à 15 chiffres significatifs : au-delà, deux montants voisins
 * peuvent se confondre. SQL pur, donc valable sur tout moteur SQLite (pilote
 * natif, `node:sqlite`, base distante) ; l'égalité et `IN` restent en texte,
 * exacts sur la forme canonique.
 *
 * @param operand - la colonne, ou la valeur liée qu'on lui compare.
 * @returns l'expression numérique.
 */
export function numericOperand(operand: SQLWrapper): SQL {
  return sql`CAST(${operand} AS REAL)`;
}

/**
 * Garde, d'un décimal rangé en TEXT et d'une valeur proposée, le plus grand
 * (`$max`) ou le plus petit (`$min`), comparés en NOMBRES par
 * {@link numericOperand}.
 *
 * Le texte gardé est celui de la colonne ou de la valeur, jamais un `REAL`
 * réécrit : la forme canonique survit. Une colonne `NULL` cède à la valeur,
 * comme `GREATEST` en PostgreSQL.
 *
 * @param column - la colonne.
 * @param proposed - la valeur proposée, liée par la colonne (forme canonique).
 * @param keep - l'extrême à garder.
 * @returns l'expression du `SET`.
 */
export function textDecimalExtreme(
  column: SQLWrapper,
  proposed: SQLWrapper,
  keep: "max" | "min",
): SQL {
  const current = numericOperand(column);
  const offered = numericOperand(proposed);
  const kept =
    keep === "max"
      ? sql`${current} >= ${offered}`
      : sql`${current} <= ${offered}`;
  return sql`CASE WHEN ${kept} THEN ${column} ELSE ${proposed} END`;
}

/** Chiffres qu'un entier SQLite (64 bits) porte exactement, de chaque côté de la virgule. */
const EXACT_DIGITS = 18;

/**
 * Expression qui fait échouer l'instruction (« integer overflow ») : `abs()`
 * du plus petit entier 64 bits. SQLite n'a pas de `RAISE` hors des
 * déclencheurs ; une branche de `CASE` n'est évaluée que si elle est prise.
 */
const OVERFLOW = sql.raw("abs(-9223372036854775807 - 1)");

/**
 * Ajoute un delta à un décimal rangé en TEXT, EXACTEMENT, et rend sa forme
 * canonique (`"12.60"`, jamais `"12.6"` ni un flottant).
 *
 * Le calcul se fait sur deux entiers 64 bits — partie entière et chiffres après
 * la virgule —, avec retenue et signe recomposés. Atomique comme tout
 * `UPDATE … SET col = <expr>` : aucune relecture côté JavaScript. Un résultat
 * qui dépasse la précision fait échouer l'instruction, comme PostgreSQL et
 * MySQL (mode strict) le refusent ; la ligne reste intacte. Une colonne `NULL`
 * reste `NULL`. Une valeur écrite hors du kit sans sa forme canonique (`"12.6"`,
 * `"100"`) est lue juste : les décimales manquantes valent zéro.
 *
 * Coût : `increment` n'est pas préparé, donc chaque appel COMPILE l'expression
 * (~0,1 ms mesurée, contre ~0,85 ms sous cinq sous-requêtes imbriquées — d'où
 * deux niveaux seulement, et le découpage écrit à plat). L'exécution, elle,
 * ajoute ~10 µs.
 *
 * @param column - la colonne.
 * @param shape - sa précision, son échelle, son nom.
 * @param delta - le delta CANONIQUE à l'échelle (`decimalDelta`).
 * @returns l'expression du `SET`.
 * @throws {ColumnValueError} Quand la colonne a plus de 18 chiffres d'un côté
 *   de la virgule : SQLite ne sait plus l'additionner exactement.
 */
export function textDecimalIncrement(
  column: SQLWrapper,
  shape: IDecimalShape,
  delta: string,
): SQL {
  const { precision, scale, label } = shape;
  const integerDigits = precision - scale;
  if (integerDigits > EXACT_DIGITS || scale > EXACT_DIGITS) {
    throw new ColumnValueError(
      "decimal",
      delta,
      label,
      `cannot be incremented exactly by SQLite: more than ${EXACT_DIGITS} digits on one side of the point.`,
    );
  }
  const negative = delta.startsWith("-");
  const [whole = "0", fraction = "0"] = (
    negative ? delta.slice(1) : delta
  ).split(".");
  const sign = negative ? "-" : "";
  // Liés en TEXTE puis convertis par SQLite : exacts au-delà de 2^53.
  const high = `${sign}${whole}`;
  const low = `${sign}${fraction}`;
  // Constantes INTERNES (tirées de la spec), jamais une entrée appelante.
  const limit = sql.raw(`1${"0".repeat(integerDigits)}`);
  if (scale === 0) {
    const sum = sql`(CAST(${column} AS INTEGER) + CAST(${high} AS INTEGER))`;
    return sql`CASE WHEN ABS(${sum}) >= ${limit} THEN ${OVERFLOW} ELSE ${sum} END`;
  }
  const unit = sql.raw(`1${"0".repeat(scale)}`);
  const zeros = sql.raw(`'${"0".repeat(scale)}'`);
  const format = sql.raw(`'%s%d.%0${scale}d'`);
  const digits = sql.raw(String(scale));
  // Valeur absolue de la colonne, et position de son point (ou de sa fin).
  const magnitude = sql`ltrim(${column}, '-')`;
  const point = sql`instr(${magnitude} || '.', '.')`;
  const signOf = sql`(1 - 2 * (substr(${column}, 1, 1) = '-'))`;
  const hi = sql`${signOf} * CAST(substr(${magnitude}, 1, ${point} - 1) AS INTEGER) + CAST(${high} AS INTEGER)`;
  const lo = sql`${signOf} * CAST(substr(substr(${magnitude}, ${point} + 1) || ${zeros}, 1, ${digits}) AS INTEGER) + CAST(${low} AS INTEGER)`;
  // h1/l1 : retenue des décimales ; h/l : signes accordés (booléens = 0/1).
  return sql`(SELECT CASE WHEN ABS(h) >= ${limit} THEN ${OVERFLOW}
      WHEN h IS NOT NULL THEN printf(${format}, CASE WHEN h < 0 OR l < 0 THEN '-' ELSE '' END, ABS(h), ABS(l)) END
    FROM (SELECT h1 - (h1 > 0 AND l1 < 0) + (h1 < 0 AND l1 > 0) AS h,
        l1 + ${unit} * ((h1 > 0 AND l1 < 0) - (h1 < 0 AND l1 > 0)) AS l
      FROM (SELECT hi + lo / ${unit} AS h1, lo % ${unit} AS l1
        FROM (SELECT ${hi} AS hi, ${lo} AS lo))))`;
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
  return buildTable(spec, self);
}

function buildTable(spec: ITableSpec, self: () => SQLiteTable): SQLiteTable {
  const columns: Record<string, SQLiteColumnBuilderBase> = {};
  for (const [k, c] of Object.entries(spec.columns)) {
    columns[k] = applyMods(
      baseColumn(k, c, spec, self),
      c,
      boundedUniqueName(spec.name, columnName(k, c)),
    );
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
      if (c.kind !== "ref") continue;
      const name = boundedForeignKeyName(spec, k, c);
      if (name === null) continue;
      const target =
        c.target === "self"
          ? indexedColumn(t, primaryKeyName(spec))
          : primaryKeyColumn(
              refTargetTable(c, spec, k).table("sqlite"),
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
            sql.raw(enumPredicate(columnName(k, c), c, '"')),
          ),
        );
      } else if (c.kind === "string") {
        // SQLite n'applique pas la longueur déclarée : le CHECK la fait
        // refuser par le SERVEUR, comme PostgreSQL et MySQL d'eux-mêmes.
        extras.push(
          check(
            checkName(spec.name, columnName(k, c), "len"),
            sql.raw(
              `length("${columnName(k, c)}") <= ${c.length ?? DEFAULT_STRING_LENGTH}`,
            ),
          ),
        );
      } else if (c.kind === "char") {
        // Longueur EXACTE, espaces finaux ignorés — ce que PostgreSQL et MySQL
        // mesurent sur un `char(n)` (qu'ils complètent ou tronquent).
        extras.push(
          check(
            checkName(spec.name, columnName(k, c), "len"),
            sql.raw(`length(rtrim("${columnName(k, c)}", ' ')) = ${c.length}`),
          ),
        );
      }
    }
    return extras;
  });
}
