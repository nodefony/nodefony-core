/**
 * Ce qu'un instantané de l'outil dit des colonnes de chaque table.
 *
 * Deux lecteurs du MÊME état de départ — celui contre lequel une migration a
 * été calculée : la réparation des recopies SQLite veut les NOMS, l'audit des
 * changements de type veut le TYPE d'avant. Après `--rename`, cet état est
 * l'instantané RÉÉCRIT, jamais l'original : lire l'un pour l'autre fait perdre
 * la colonne renommée à la recopie.
 */

/** Ce que l'instantané dit d'une colonne. */
export interface ISnapshotColumnFacts {
  /** Type SQL tel que l'outil l'écrit (`varchar(16)`, `integer`). */
  type: string;
  notNull: boolean;
}

/**
 * Les colonnes de chaque table d'un instantané, par nom de table.
 *
 * Le nom peut être qualifié par son schéma (`public.User` en PostgreSQL) : on
 * indexe sur le nom de la table, seul nom que le SQL emploie.
 *
 * @param doc - un instantané (lu, ou réécrit par {@link applyRenames}).
 * @returns un lecteur qui rend `null` pour toute table inconnue.
 */
export function columnsByTable(
  doc: unknown,
): (table: string) => readonly string[] | null {
  const tables = isRecord(doc) && isRecord(doc.tables) ? doc.tables : null;
  if (tables === null) {
    return () => null;
  }
  const byName = new Map<string, readonly string[]>();
  for (const [key, table] of Object.entries(tables)) {
    if (!isRecord(table) || !isRecord(table.columns)) continue;
    const name =
      typeof table.name === "string"
        ? table.name
        : (key.split(".").pop() ?? key);
    byName.set(name, Object.keys(table.columns));
  }
  return (name: string) => byName.get(name) ?? null;
}

/**
 * Le type et la nullabilité de chaque colonne d'un instantané.
 *
 * @param doc - un instantané (lu, ou réécrit par `applyRenames`).
 * @returns un lecteur qui rend `null` pour toute colonne inconnue.
 */
export function columnFactsByTable(
  doc: unknown,
): (table: string, column: string) => ISnapshotColumnFacts | null {
  const tables = isRecord(doc) && isRecord(doc.tables) ? doc.tables : null;
  if (tables === null) {
    return () => null;
  }
  const byName = new Map<string, Record<string, unknown>>();
  for (const [key, table] of Object.entries(tables)) {
    if (!isRecord(table) || !isRecord(table.columns)) continue;
    byName.set(
      typeof table.name === "string"
        ? table.name
        : (key.split(".").pop() ?? key),
      table.columns,
    );
  }
  return (table: string, column: string) => {
    const columns = byName.get(table);
    const facts =
      columns !== undefined && Object.hasOwn(columns, column)
        ? columns[column]
        : undefined;
    if (!isRecord(facts) || typeof facts.type !== "string") return null;
    return { type: facts.type, notNull: facts.notNull === true };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
