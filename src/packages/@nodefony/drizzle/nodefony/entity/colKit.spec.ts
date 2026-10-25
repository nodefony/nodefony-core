/**
 * colKit — la DESCRIPTION logique d'une entité, indépendante de tout ORM.
 *
 * Une entité décrit ses colonnes UNE fois, en types logiques (`string(n)`,
 * `decimal(p,s)`, `uuid`, `enum`, `ref`…) ; un ADAPTATEUR fabrique à partir de
 * cette spec les tables de son ORM — pour Drizzle, `defineTable` (`colKit.ts`).
 * Ce fichier porte ce qui ne dépend d'aucun ORM : la grammaire, la dérivation
 * des types de ligne (`RowOf`, `InsertOf`), la validation des specs et la
 * résolution des clés visées par une référence.
 *
 * 🔴 **Aucun import d'ORM ici** — `tests/unit/colkit-neutral.test.ts` le refuse.
 * La description est un bien du framework : changer ou ajouter un ORM réécrit
 * l'adaptateur, jamais les entités ni ce fichier.
 */

/** Aplatit une intersection en un seul objet (même forme que celle de Drizzle). */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Ce qu'une référence (`ref`) vise : une description de table, quel que soit
 * l'adaptateur qui la fabriquera. Le type précis de la cible est retrouvé par
 * `infer` sur `spec`.
 */
export interface ITableDescription {
  readonly spec: ITableSpec;
}

/** Action d'une clé étrangère à la suppression de la ligne visée. */
export type OnDeleteAction = "restrict" | "cascade" | "set null" | "no action";

/**
 * Nom STOCKÉ d'une colonne, quand il diffère de la propriété.
 *
 * La propriété (la clé de `columns`) est ce que le code lit et écrit — la ligne
 * rendue, les critères, le tri ; le nom stocké est ce que la base porte. Les
 * deux divergent dès qu'une base suit sa propre convention (`created_at` face à
 * `createdAt`) ou qu'on adopte une table existante.
 */
export interface IStoredName {
  /** Nom en base (identifiant SQL simple) ; défaut : la propriété. */
  readonly column?: string;
}

/** Modificateurs communs ; `TData` borne un défaut au type de la colonne. */
export interface IColumnMods<TData> extends IStoredName {
  /** La colonne refuse `NULL`. */
  readonly notNull?: true;
  /** Contrainte d'unicité de colonne. */
  readonly unique?: true;
  /** Défaut calculé en JavaScript à l'insertion (jamais de `DEFAULT` SQL). */
  readonly defaultFn?: () => TData;
  /** Valeur recalculée à chaque `UPDATE` (pendant SQL d'`updatedAt`). */
  readonly onUpdateFn?: () => TData;
}

/**
 * Modificateurs d'une colonne de VALEUR — jamais clé primaire : une clé est une
 * chaîne, un uuid ou un `serial` (une clé entière non auto-incrémentée diverge
 * entre moteurs — SQLite en fait un alias de `rowid` qu'il remplit seul).
 */
export interface IValueColumnMods<TData> extends IColumnMods<TData> {
  readonly primaryKey?: never;
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
export interface IIntColumn extends IValueColumnMods<number> {
  readonly kind: "int";
}

/** Entier 64 bits, exact jusqu'à 2⁵³−1 — compteurs, horodatages epoch ms. */
export interface IInt64Column extends IValueColumnMods<number> {
  readonly kind: "int64";
}

/** Clé primaire entière auto-incrémentée — `serial` PostgreSQL. */
export interface ISerialColumn extends IStoredName {
  readonly kind: "serial";
  readonly primaryKey: true;
}

/** Flottant IEEE 754 double précision. */
export interface IFloatColumn extends IValueColumnMods<number> {
  readonly kind: "float";
}

/** Décimal exact, rendu en chaîne (`"12.50"`) — `numeric(p,s)` / `decimal(p,s)`. */
export interface IDecimalColumn extends IValueColumnMods<string> {
  readonly kind: "decimal";
  /** Nombre total de chiffres (1 à 65). */
  readonly precision: number;
  /** Chiffres après la virgule (0 à 30, au plus `precision`). */
  readonly scale: number;
}

/** Booléen. */
export interface IBoolColumn extends IValueColumnMods<boolean> {
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
export interface IJsonColumn<T = unknown> extends IValueColumnMods<T> {
  readonly kind: "json";
  readonly type?: IJsonType<T>;
}

/** Jour calendaire SANS heure ni fuseau — rendu `"YYYY-MM-DD"` partout. */
export interface IDateColumn extends IValueColumnMods<string> {
  readonly kind: "date";
}

/** Instant (UTC, précision milliseconde) — rendu `Date` partout. */
export interface IDatetimeColumn extends IValueColumnMods<Date> {
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
> extends IValueColumnMods<V[number]> {
  readonly kind: "enum";
  /** Valeurs admises (64 caractères au plus chacune). */
  readonly values: V;
}

/** Vecteur pgvector — PostgreSQL seulement, refusé ailleurs en le nommant. */
export interface IVectorColumn extends IValueColumnMods<number[]> {
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
export interface IRefColumn extends IStoredName {
  readonly kind: "ref";
  readonly primaryKey?: never;
  readonly target: "self" | (() => ITableDescription);
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

// ─────────────────────────────────── Validation ───────────────────────────────────

/** Bornes de MySQL, plus étroites que celles de PostgreSQL (le kit tient la plus petite). */
const DECIMAL_MAX_PRECISION = 65;
const DECIMAL_MAX_SCALE = 30;
/** Dimensions maximales d'une colonne pgvector `vector`. */
const VECTOR_MAX_DIMENSIONS = 16000;

/** Genres qu'une clé primaire peut porter. */
const KEY_KINDS: ReadonlySet<ColumnKind> = new Set([
  "string",
  "char",
  "text",
  "uuid",
  "serial",
]);

function isPositiveInteger(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

/** Identifiant SQL simple — le seul qu'un nom stocké accepte, sans guillemet à échapper. */
const STORED_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;

/**
 * Nom en base d'une colonne : son nom stocké s'il est déclaré, sinon sa propriété.
 *
 * La seule règle qui décide du nom SQL — les trois adaptateurs l'appellent pour
 * la colonne ET pour les contraintes qui la nomment (`CHECK`), sans quoi un
 * `CHECK` viserait une colonne qui n'existe pas.
 *
 * @param key - propriété de la spec (clé de `columns`).
 * @param column - spec de la colonne.
 * @returns le nom de la colonne en base.
 */
export function columnName(key: string, column: ColumnSpec): string {
  return column.column ?? key;
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
  /** Nom stocké → propriété qui le porte : deux propriétés, une seule colonne. */
  const stored = new Map<string, string>();
  for (const [name, column] of Object.entries(spec.columns)) {
    if (column.column !== undefined && !STORED_NAME_RE.test(column.column)) {
      fail(
        `column "${name}" has an invalid stored name "${column.column}" (a plain SQL identifier: letters, digits, _).`,
      );
    }
    const storedName = columnName(name, column);
    const owner = stored.get(storedName);
    if (owner !== undefined) {
      fail(
        `columns "${owner}" and "${name}" are both stored as "${storedName}".`,
      );
    }
    stored.set(storedName, name);
    if ("primaryKey" in column) {
      primaryKeys += 1;
      if (!KEY_KINDS.has(column.kind)) {
        fail(
          `column "${name}" is a ${column.kind} primary key — a key is a string, char, text, uuid or serial.`,
        );
      }
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

// ───────────────────────────── Clés et références ─────────────────────────────

/** Largeur fixe de la colonne d'un `enum` en MySQL, donc plus longue valeur admise. */
export const ENUM_MAX_LENGTH = 64;

/** Genres qu'une clé primaire peut porter, donc qu'une référence peut viser. */
export type KeyColumnSpec = Extract<
  ColumnSpec,
  { kind: "string" | "char" | "text" | "uuid" | "serial" }
>;

/** Nom de la colonne clé primaire d'une spec. */
export function primaryKeyName(spec: ITableSpec): string {
  for (const [name, column] of Object.entries(spec.columns)) {
    if ("primaryKey" in column) {
      return name;
    }
  }
  throw new Error(
    `[@nodefony/drizzle] colKit "${spec.name}": no primary key column.`,
  );
}

/** Spec de la table visée par une référence (la table elle-même pour `"self"`). */
export function refTargetSpec(ref: IRefColumn, owner: ITableSpec): ITableSpec {
  return ref.target === "self" ? owner : ref.target().spec;
}

/**
 * Spec de la clé primaire visée par une référence — la colonne de référence en
 * prend le TYPE, sinon PostgreSQL et MySQL refusent la contrainte.
 *
 * @throws Quand la table visée n'a pas de clé primaire de genre référençable.
 */
export function refTargetKey(
  ref: IRefColumn,
  owner: ITableSpec,
  column: string,
): KeyColumnSpec {
  const target = refTargetSpec(ref, owner);
  const key = target.columns[primaryKeyName(target)];
  if (
    key?.kind === "string" ||
    key?.kind === "char" ||
    key?.kind === "text" ||
    key?.kind === "uuid" ||
    key?.kind === "serial"
  ) {
    return key;
  }
  throw new Error(
    `[@nodefony/drizzle] colKit "${owner.name}": column "${column}" references ` +
      `"${target.name}", whose primary key is not a string, char, text, uuid or serial.`,
  );
}
