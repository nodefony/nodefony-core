import { getTableColumns } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { IPortableTableBase } from "./colKit";
import { canonicalIntegerKey } from "./colKit.codecs";
import {
  columnName,
  primaryKeyName,
  refTargetKey,
  refTargetSpec,
} from "./colKit.spec";
import type {
  IEnumColumn,
  IRefColumn,
  ITableDescription,
  ITableSpec,
} from "./colKit.spec";

/** Aides des trois fabriques du colKit — aucune ne dépend d'un dialecte. */

/** La colonne est-elle visée par un index de la spec ? */
export function isIndexed(spec: ITableSpec, name: string): boolean {
  return (spec.indexes ?? []).some((ix) => ix.on.includes(name));
}

/**
 * Prédicat `CHECK` d'une énumération — `sql.raw` intégral, sans paramètre lié :
 * un placeholder n'a pas de sens dans une définition de table. Les valeurs
 * viennent de la spec, jamais d'une entrée ; l'apostrophe est doublée.
 */
export function enumPredicate(
  name: string,
  column: IEnumColumn,
  quote: string,
): string {
  const list = column.values
    .map((value) => `'${value.replace(/'/g, "''")}'`)
    .join(", ");
  return `${quote}${name}${quote} IN (${list})`;
}

/**
 * Plus long identifiant que PostgreSQL garde INTACT (63 octets — au-delà il le
 * tronque en silence) ; MySQL et MariaDB refusent au-delà de 64.
 */
export const MAX_IDENTIFIER_LENGTH = 63;

/** Empreinte FNV-1a 32 bits, en 8 caractères hexadécimaux — pure, sans dépendance. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Borne un identifiant GÉNÉRÉ par le kit (contrainte, clé étrangère) à 63
 * caractères, de façon déterministe.
 *
 * Inchangé jusqu'à 63 : un nom déjà gravé dans une migration ne bouge pas.
 * Au-delà, tronqué puis suffixé d'une empreinte du nom ENTIER — deux noms qui
 * partagent leurs 54 premiers caractères restent distincts, et le même nom rend
 * le même identifiant sur les trois dialectes.
 *
 * @param name - identifiant que le kit aurait écrit.
 * @returns l'identifiant, 63 caractères au plus.
 */
export function boundedIdentifier(name: string): string {
  if (name.length <= MAX_IDENTIFIER_LENGTH) return name;
  return `${name.slice(0, MAX_IDENTIFIER_LENGTH - 9)}_${fnv1a(name)}`;
}

/** Nom d'une contrainte `CHECK` du kit — gravé dans les migrations, ne pas changer. */
export function checkName(
  table: string,
  column: string,
  suffix: "check" | "len",
): string {
  return boundedIdentifier(`${table}_${column}_${suffix}`);
}

/**
 * Nom que Drizzle donnerait à la clé étrangère d'une colonne de référence
 * (`<table>_<colonne>_<cible>_<clé>_fk`), avant toute borne.
 */
export function defaultForeignKeyName(
  owner: ITableSpec,
  key: string,
  ref: IRefColumn,
): string {
  const target = refTargetSpec(ref, owner);
  const pk = primaryKeyName(target);
  const pkColumn = target.columns[pk];
  const pkStored = pkColumn ? columnName(pk, pkColumn) : pk;
  return `${owner.name}_${columnName(key, ref)}_${target.name}_${pkStored}_fk`;
}

/**
 * Nom BORNÉ de la clé étrangère d'une colonne, ou `null` quand le nom par
 * défaut de Drizzle tient déjà : la contrainte reste alors déclarée sur la
 * colonne, et les migrations écrites avant la borne ne changent pas.
 */
export function boundedForeignKeyName(
  owner: ITableSpec,
  key: string,
  ref: IRefColumn,
): string | null {
  const name = defaultForeignKeyName(owner, key, ref);
  return name.length <= MAX_IDENTIFIER_LENGTH ? null : boundedIdentifier(name);
}

/** `[premier, ...reste]` — la forme qu'exige `index().on()`. */
export function firstAndRest<T>(items: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) {
    throw new Error("[@nodefony/drizzle] colKit: an index without column.");
  }
  return [first, ...rest];
}

/** Colonne d'index lue dans l'objet de colonnes de la table, avec garde. */
export function indexedColumn<C>(
  columns: Readonly<Record<string, C>>,
  name: string,
): C {
  const column = Object.hasOwn(columns, name) ? columns[name] : undefined;
  if (column === undefined) {
    throw new Error(
      `[@nodefony/drizzle] colKit: index on unknown column "${name}".`,
    );
  }
  return column;
}

/**
 * La description visée par une référence sait-elle fabriquer sa table Drizzle ?
 * Une `ref` vise une description NEUTRE ({@link ITableDescription}) ;
 * l'adaptateur exige une table déclarée par {@link defineTable}.
 */
export function isPortableTable(
  target: ITableDescription,
): target is IPortableTableBase {
  return "table" in target && typeof target.table === "function";
}

/**
 * Table portable visée par une référence (la table elle-même pour `"self"` est
 * résolue par l'appelant).
 *
 * @throws Quand la cible est une description qu'aucune table Drizzle ne porte.
 */
export function refTargetTable(
  ref: IRefColumn,
  owner: ITableSpec,
  column: string,
): IPortableTableBase {
  const target = ref.target === "self" ? null : ref.target();
  if (target === null || !isPortableTable(target)) {
    throw new Error(
      `[@nodefony/drizzle] colKit "${owner.name}": column "${column}" references ` +
        `"${refTargetSpec(ref, owner).name}", which is not a table declared by defineTable().`,
    );
  }
  return target;
}

/**
 * Pendant JavaScript d'un défaut LITTÉRAL (`default`) : la même valeur à chaque
 * insertion, recopiée quand c'est un objet — un tableau partagé entre deux
 * lignes serait modifié pour les deux par qui en modifie une.
 *
 * @param value - défaut littéral de la spec.
 * @returns la fonction posée en `$defaultFn`.
 */
export function literalDefaultFn<T>(value: T): () => T {
  return typeof value === "object" && value !== null
    ? () => structuredClone(value)
    : () => value;
}

/**
 * Une valeur quelconque est-elle une table PORTABLE (rendue par `defineTable`) ?
 *
 * Le pendant de `is(value, Table)` pour la description neutre : c'est ainsi
 * qu'un `entity.schema`, un export de fichier d'entité ou une cible se
 * reconnaissent, sans rien deviner d'un nom.
 *
 * @param value - valeur à examiner.
 * @returns `true` si elle porte une spec nommée et sa fabrique par dialecte.
 */
export function isPortableSchema(value: unknown): value is IPortableTableBase {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("spec" in value) || !("table" in value)) {
    return false;
  }
  const { spec, table } = value;
  return (
    typeof table === "function" &&
    typeof spec === "object" &&
    spec !== null &&
    "name" in spec &&
    typeof spec.name === "string" &&
    "columns" in spec
  );
}

/**
 * Pose le codec {@link canonicalIntegerKey} sur chaque colonne qui porte une
 * clé ENTIÈRE — la clé `serial` et toute référence vers une clé `serial`.
 *
 * Posé sur la colonne CONSTRUITE plutôt qu'en `customType` : la colonne garde
 * son type natif, donc son DDL (`serial`, `integer … autoincrement`), et seule
 * la valeur liée change de chemin. Drizzle encode par la colonne toute valeur
 * qu'elle reçoit — `eq(col, v)`, `inArray`, insertion, paramètre préparé —, si
 * bien qu'une lecture par le chemin (`/books/1abc`) et un filtre (`?sequel=x`)
 * passent par la même règle sur les trois moteurs.
 *
 * @param table - table Drizzle que la fabrique du dialecte vient de construire.
 * @param spec - sa spec.
 */
export function guardIntegerKeys(table: Table, spec: ITableSpec): void {
  const columns = getTableColumns(table);
  for (const [key, column] of Object.entries(spec.columns)) {
    const integerKey =
      column.kind === "serial" ||
      (column.kind === "ref" &&
        refTargetKey(column, spec, key).kind === "serial");
    if (!integerKey || !Object.hasOwn(columns, key)) continue;
    const built = columns[key];
    if (built === undefined) continue;
    const label = `${spec.name}.${key}`;
    const encode = built.mapToDriverValue.bind(built);
    built.mapToDriverValue = (value: unknown): unknown =>
      encode(canonicalIntegerKey(value, label));
  }
}
