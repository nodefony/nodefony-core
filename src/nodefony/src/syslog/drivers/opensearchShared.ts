/** Index OpenSearch par défaut des logs Nodefony (write transport ↔ read driver). */
export const DEFAULT_OPENSEARCH_INDEX = "nodefony-logs";

/**
 * Construit l'en-tête `Authorization: Basic …` si un utilisateur est fourni — sinon
 * objet vide (dev = plugin sécurité désactivé, HTTP sans auth). Node-only (`Buffer`).
 *
 * @param username - utilisateur (absent → pas d'auth).
 * @param password - mot de passe.
 * @returns en-tête prêt à étaler, ou `{}`.
 */
export function basicAuthHeader(
  username?: string,
  password?: string,
): Record<string, string> {
  if (!username) return {};
  const token = Buffer.from(`${username}:${password ?? ""}`).toString("base64");
  return { authorization: `Basic ${token}` };
}
