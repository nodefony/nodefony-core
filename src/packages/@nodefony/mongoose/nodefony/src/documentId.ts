/**
 * Identité réelle d'un document lu en base : `_id` fait foi, le virtuel `id` en
 * repli.
 *
 * Les stores rangent leur clé métier (jti, identifiant de credential…) DANS
 * `_id`, chaîne ; le virtuel `id` n'en est qu'une projection, absente d'une
 * lecture `lean()`. Le type de ligne ne déclare pas `_id` — c'est la plomberie
 * du moteur —, d'où une lecture VÉRIFIÉE plutôt qu'une conversion : un `_id`
 * d'une autre forme (ObjectId d'une collection héritée) retombe sur `id`.
 *
 * @param row - ligne lue en base, porteuse au moins du virtuel `id`
 * @returns la clé du document
 */
export function documentId(row: { readonly id: string }): string {
  return "_id" in row && typeof row._id === "string" ? row._id : row.id;
}
