import type { ColumnSpec, IEnumColumn, IRefColumn, ITableSpec } from "./colKit";

/** Aides des trois fabriques du colKit — aucune ne dépend d'un dialecte. */

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

/** Nom d'une contrainte `CHECK` du kit — gravé dans les migrations, ne pas changer. */
export function checkName(
  table: string,
  column: string,
  suffix: "check" | "len",
): string {
  return `${table}_${column}_${suffix}`;
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
