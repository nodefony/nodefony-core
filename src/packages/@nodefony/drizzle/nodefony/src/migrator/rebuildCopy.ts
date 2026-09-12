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
    const groups = args[args.length - 1] as Record<string, string> | undefined;
    if (groups === undefined) {
      return match;
    }
    const { head, into, middle, select, tail, source } = groups;
    if (
      head === undefined ||
      into === undefined ||
      middle === undefined ||
      select === undefined ||
      tail === undefined ||
      source === undefined
    ) {
      return match;
    }
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
    for (let i = 0; i < intoColumns.length; i++) {
      const target = bareName(intoColumns[i] as string);
      const read = bareName(selectColumns[i] as string);
      if (target === null || read === null) {
        return match;
      }
      if (carried.has(read)) {
        keptInto.push(intoColumns[i] as string);
        keptSelect.push(selectColumns[i] as string);
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
