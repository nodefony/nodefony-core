/**
 * Répare la recopie d'une recréation de table SQLite.
 *
 * 🔴 Le défaut que ce module ferme, mesuré sur deux applications fraîches :
 * quand une migration doit à la fois MODIFIER une colonne et en AJOUTER une,
 * SQLite ne sait pas altérer sur place — l'outil de génération produit alors la
 * ronde connue (créer `__new_x`, y recopier les lignes de `x`, supprimer `x`,
 * renommer). Sa recopie liste les colonnes de la table d'ARRIVÉE, la colonne
 * neuve comprise, et va donc la LIRE dans la table de départ, où elle n'existe
 * pas encore. La migration échoue sur `no such column` et laisse un marqueur
 * qui bloque tous les passages suivants — l'utilisateur se retrouve devant
 * trois commandes qui refusent, et la seule issue apparente est de détruire la
 * base.
 *
 * La réparation est déterministe et sans jugement : une colonne que la table de
 * départ ne porte pas ne peut pas être recopiée, donc elle sort des DEUX
 * listes. Elle recevra ce que son `CREATE TABLE` lui donne — un défaut, ou
 * `NULL`. C'est exactement ce qu'aurait fait un `ADD COLUMN`.
 *
 * ⚠️ On ne touche à RIEN dès qu'un élément de la recopie n'est pas une simple
 * colonne citée — une expression, un appel de fonction, un alias — ni quand les
 * colonnes de la table de départ sont inconnues. Réécrire ce qu'on n'a pas
 * compris coûterait plus cher que le défaut qu'on répare.
 */

/**
 * La ronde de recréation, telle que l'outil de génération l'écrit.
 *
 * Tout est nommé : lire ces morceaux par POSITION obligerait à recompter à
 * chaque retouche de l'expression, et une erreur y serait silencieuse — on
 * réécrirait la mauvaise moitié de la recopie.
 */
const REBUILD_COPY =
  /(?<head>INSERT\s+INTO\s+[`"']?__new_[A-Za-z0-9_]+[`"']?\s*\(\s*)(?<into>[^)]*?)(?<middle>\s*\)\s*SELECT\s+)(?<select>.*?)(?<tail>\s+FROM\s+[`"']?(?<source>[A-Za-z0-9_]+)[`"']?)/gis;

/** Une colonne citée, telle qu'elle apparaît dans les deux listes. */
const QUOTED_COLUMN = /^[`"']?(?<name>[A-Za-z0-9_]+)[`"']?$/u;

/** Ce que la réparation a changé, pour pouvoir le DIRE plutôt que le taire. */
export interface IRebuildCopyRepair {
  /** Le SQL, réparé si besoin ; identique à l'entrée sinon. */
  readonly sql: string;
  /** Les colonnes retirées de la recopie, en `table.colonne`. */
  readonly dropped: readonly string[];
}

/** Découpe une liste de colonnes, en gardant l'écriture exacte de chacune. */
function splitColumns(list: string): string[] {
  return list
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Le nom nu d'une colonne citée, ou `null` si ce n'en est pas une. */
function bareName(token: string): string | null {
  return QUOTED_COLUMN.exec(token)?.groups?.name ?? null;
}

/**
 * Retire de la recopie les colonnes que la table de départ ne porte pas.
 *
 * @param sql - le SQL de la migration, tel que l'outil vient de l'écrire.
 * @param columnsOf - les colonnes d'une table AVANT cette migration ; `null`
 *   quand on ne les connaît pas — auquel cas rien n'est touché, car on ne
 *   réécrit jamais sur une supposition.
 * @returns le SQL réparé et la liste de ce qui a été retiré.
 */
export function repairRebuildCopy(
  sql: string,
  columnsOf: (table: string) => readonly string[] | null,
): IRebuildCopyRepair {
  const dropped: string[] = [];
  const repaired = sql.replace(REBUILD_COPY, (...args: unknown[]): string => {
    const match = args[0] as string;
    // Aucun groupe n'est facultatif dans `REBUILD_COPY` : tous sont capturés.
    const groups = args[args.length - 1] as
      | Record<
          "head" | "into" | "middle" | "select" | "tail" | "source",
          string
        >
      | undefined;
    if (groups === undefined) {
      return match;
    }
    const { head, into, middle, select, tail, source } = groups;
    const known = columnsOf(source);
    if (known === null) {
      return match;
    }
    const intoColumns = splitColumns(into);
    const selectColumns = splitColumns(select);
    // Deux listes de longueurs différentes ne se réparent pas par position :
    // c'est déjà une forme qu'on ne reconnaît pas.
    if (intoColumns.length !== selectColumns.length) {
      return match;
    }
    const carried = new Set(known);
    const keptInto: string[] = [];
    const keptSelect: string[] = [];
    const removed: string[] = [];
    for (const [i, intoColumn] of intoColumns.entries()) {
      // Longueurs égales vérifiées plus haut : la colonne lue existe.
      const selectColumn = selectColumns[i] ?? "";
      const target = bareName(intoColumn);
      const read = bareName(selectColumn);
      if (target === null || read === null) {
        return match;
      }
      if (carried.has(read)) {
        keptInto.push(intoColumn);
        keptSelect.push(selectColumn);
      } else {
        removed.push(`${source}.${read}`);
      }
    }
    if (removed.length === 0) {
      return match;
    }
    // Une recopie vidée de tout n'a plus de sens : on la laisse telle quelle et
    // on laisse le refus d'application parler, plutôt que d'écrire un SQL qu'on
    // n'a jamais vu produire.
    if (keptInto.length === 0) {
      return match;
    }
    dropped.push(...removed);
    return `${head}${keptInto.join(", ")}${middle}${keptSelect.join(", ")}${tail}`;
  });
  return { sql: repaired, dropped };
}

/**
 * Une recopie `INSERT INTO <étape>(…) SELECT … FROM <source>` — sans présumer du
 * nom de l'étape : c'est la RONDE entière (`destructive.ts#rebuiltTables`) qui
 * dit qu'il s'agit d'une recréation, et l'appelant la fournit.
 */
const ANY_COPY =
  /\bINSERT\s+INTO\s+[`"']?[A-Za-z0-9_]+[`"']?\s*\([^)]*\)\s*SELECT\s+(?<select>[\s\S]*?)\s+FROM\s+[`"']?(?<source>[A-Za-z0-9_]+)[`"']?/giu;

const IDENT_RE = "[`\"']?([A-Za-z0-9_]+)[`\"']?";

/** `ALTER TABLE t RENAME COLUMN a TO b` — le renommage déclaré d'une colonne. */
const RENAME_COLUMN = new RegExp(
  `\\bALTER\\s+TABLE\\s+${IDENT_RE}\\s+RENAME\\s+COLUMN\\s+${IDENT_RE}\\s+TO\\s+${IDENT_RE}`,
  "iu",
);

/** `ALTER TABLE a RENAME TO b` — le renommage d'une table. */
const RENAME_TABLE = new RegExp(
  `\\bALTER\\s+TABLE\\s+${IDENT_RE}\\s+RENAME\\s+TO\\s+${IDENT_RE}`,
  "iu",
);

/** Une colonne de départ figure-t-elle, nom entier, dans la liste lue ? */
function isRead(select: string, column: string): boolean {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  // Les noms de colonne ne distinguent pas la casse en SQLite.
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "iu").test(select);
}

/**
 * Les colonnes de départ qu'une recréation de table ne RECOPIE pas — perdues,
 * avec leurs valeurs, sans qu'aucun `DROP COLUMN` ne l'écrive.
 *
 * Les instructions se lisent DANS L'ORDRE : un renommage de colonne ou de
 * table écrit avant la recopie change ce que la table porte au moment où elle
 * est lue (vu sur le corpus `erp-lite` : `RENAME COLUMN lastname TO
 * last_name` puis une recopie qui lit `last_name`).
 *
 * Une colonne est tenue pour lue dès que son nom, entier, figure dans la liste
 * du `SELECT` : une expression (`coalesce("vu", 0)`) la lit aussi. Ce qui n'y
 * figure pas du tout ne peut pas avoir été recopié.
 *
 * @param statements - les instructions de la migration, dans l'ordre.
 * @param rebuilt - les tables que la migration RECONSTRUIT, en minuscules : une
 *   recopie hors de cette ronde est une migration de données, pas une perte.
 * @param columnsOf - les colonnes d'une table AVANT la migration ; `null` quand
 *   on ne les connaît pas — rien n'est alors affirmé.
 * @returns, par instruction de recopie fautive (son rang), les colonnes perdues
 *   en `table.colonne`.
 */
export function rebuildLosses(
  statements: readonly string[],
  rebuilt: ReadonlySet<string>,
  columnsOf: (table: string) => readonly string[] | null,
): Map<number, string[]> {
  /** L'état COURANT des tables touchées par un renommage du fichier. */
  const current = new Map<string, readonly string[] | null>();
  const columnsNow = (table: string): readonly string[] | null =>
    current.has(table) ? (current.get(table) ?? null) : columnsOf(table);
  const out = new Map<number, string[]>();
  for (const [index, statement] of statements.entries()) {
    const column = RENAME_COLUMN.exec(statement);
    if (column) {
      const [, table = "", from = "", to = ""] = column;
      const known = columnsNow(table);
      current.set(
        table,
        known === null
          ? null
          : known.map((c) => (c.toLowerCase() === from.toLowerCase() ? to : c)),
      );
      continue;
    }
    const renamed = RENAME_TABLE.exec(statement);
    if (renamed) {
      const [, from = "", to = ""] = renamed;
      current.set(to, columnsNow(from));
      continue;
    }
    for (const match of statement.matchAll(ANY_COPY)) {
      const source = match.groups?.source;
      const select = match.groups?.select;
      if (source === undefined || select === undefined) continue;
      if (!rebuilt.has(source.toLowerCase())) continue;
      const known = columnsNow(source);
      if (known === null) continue;
      const lost = known
        .filter((c) => !isRead(select, c))
        .map((c) => `${source}.${c}`);
      if (lost.length > 0) out.set(index, [...(out.get(index) ?? []), ...lost]);
    }
  }
  return out;
}
