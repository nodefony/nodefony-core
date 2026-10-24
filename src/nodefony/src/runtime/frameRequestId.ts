/**
 * L'identifiant d'une frame du pont WebSocket — `<requestId de la connexion>.<n>`.
 *
 * Une connexion vit longtemps : elle n'a pas de fin de requête où se mesurer.
 * Chaque appel passé dans la socket (`api.request`) devient donc une requête à
 * lui seul, avec son profil et ses lignes de journal, sous cet identifiant.
 * `@nodefony/http` le PRODUIT ; le profileur, les Journaux de la console et la
 * barre de débogage le LISENT — par ces deux fonctions, jamais par un motif
 * recopié. Pures et isomorphes.
 */

/** Le point, code 46 : séparateur entre la connexion et le rang de la frame. */
const DOT = 46;

/**
 * L'identifiant de la `n`-ième frame d'une connexion.
 *
 * @param connection - le requestId de la connexion WebSocket
 * @param n - le rang de la frame, à partir de 1
 * @returns `<connection>.<n>`
 */
export function frameRequestId(connection: string, n: number): string {
  return `${connection}.${n}`;
}

/**
 * Le rang de la frame si `id` en est une de `connection`, sinon `null` — un
 * identifiant qui ne fait que COMMENCER comme la connexion n'en est pas une.
 *
 * @param id - un requestId (profil, ligne de journal)
 * @param connection - le requestId de la connexion
 * @returns le rang (≥ 1), ou `null`
 */
export function frameIndexOf(id: string, connection: string): number | null {
  const at = connection.length;
  if (id.length <= at + 1 || id.charCodeAt(at) !== DOT) return null;
  if (!id.startsWith(connection)) return null;
  const n = Number(id.slice(at + 1));
  return Number.isInteger(n) && n > 0 ? n : null;
}
