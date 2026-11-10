/**
 * numberedChange — règle PURE qui décide du sort d'un changement numéroté face à une vue.
 *
 * Une seule règle, deux bords (ADR-0025 P2, « Une règle pure, deux bords ») : le
 * navigateur qui applique une trame `realtime:presence` à sa vue, et le pod qui applique
 * le lot d'un pair à sa vue distante. Ses trois issues sont celles de RFC 5263 §4.5 :
 *
 * - `applied` — le numéro attendu : le changement s'applique ;
 * - `gap` — plus loin que l'attendu : RIEN n'est appliqué, la vue se resynchronise par une
 *   liste complète (le navigateur réémet `subscribe`, le pod fait une demande d'état) ;
 * - `stale` — déjà vu : jeté (anti-rejeu).
 *
 * Une vue « non synchronisée » (référence `null` : socket fermée, `subscribe` émis, pod
 * jamais lu) rend `gap` à tout changement, jusqu'à la prochaine liste complète — sinon un
 * changement d'un AUTRE pod pourrait tomber par hasard sur le numéro attendu et
 * s'appliquer à tort (Phoenix Presence : `inPendingSyncState`).
 *
 * Générique : elle ne connaît ni la présence, ni le bus, ni la socket. Pure et isomorphe
 * (aucun import, aucune allocation) — chargée dans le bundle navigateur comme dans le pod.
 */

/** Sort d'un changement numéroté (RFC 5263 §4.5) — cf {@link classifyNumberedChange}. */
export type NumberedChangeOutcome = "applied" | "gap" | "stale";

/**
 * Décide si un changement numéroté s'applique à une vue, révèle un trou, ou a déjà été vu.
 *
 * Deux numérotations s'y lisent :
 * - **continue** (version d'une trame vers le navigateur, +1 par changement) : `previous`
 *   s'omet, il vaut `sequence - 1` ;
 * - **chaînée** (lot entre pods : `seq` croît à CHAQUE message, preuve de vie comprise,
 *   donc deux lots ne se suivent pas forcément d'un) : `previous` est le `prev` porté par
 *   le lot, le `seq` du lot précédent.
 *
 * Précondition : des entiers sûrs, validés par le lecteur qui a reçu le message (lecteur à
 * liste fermée côté bus). La règle ne revalide pas — elle est sur le chemin de chaque trame.
 *
 * @param reference - numéro du dernier changement appliqué à la vue ; `null` = vue non
 *   synchronisée.
 * @param sequence - numéro du changement reçu.
 * @param previous - numéro du changement qui le précède chez l'émetteur ; défaut
 *   `sequence - 1` (numérotation continue).
 * @returns `applied`, `gap` ou `stale` — seul `applied` autorise à toucher la vue.
 */
export function classifyNumberedChange(
  reference: number | null,
  sequence: number,
  previous: number = sequence - 1,
): NumberedChangeOutcome {
  if (reference === null) return "gap";
  if (sequence <= reference) return "stale";
  return previous === reference ? "applied" : "gap";
}
