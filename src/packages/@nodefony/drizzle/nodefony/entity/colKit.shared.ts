import type { IPortableTableBase } from "./colKit";
import { refTargetSpec } from "./colKit.spec";
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
