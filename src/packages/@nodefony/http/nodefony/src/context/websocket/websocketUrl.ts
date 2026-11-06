import { splitAbsoluteForm } from "../http/urlFastPath";

/**
 * URL d'une requête d'upgrade WebSocket, telle que le pipeline la lit.
 *
 * Seule construction : le contexte WebSocket en tire son chemin et sa requête,
 * et le contrôle d'avant `101` en tire le chemin qu'il confronte aux routes.
 * Deux constructions divergeraient — `//a/b` lu comme un chemin d'un côté, comme
 * un hôte de l'autre — et une route acceptée par l'une serait refusée par
 * l'autre.
 *
 * Une cible en forme absolue (`http://hôte/chemin`, RFC 6455 §4.2.1) donne son
 * hôte, et l'en-tête `Host` est ignoré (RFC 9112 §3.2.2) — la même règle que
 * `HttpRequest.getHost`.
 *
 * @param scheme - `ws` ou `wss`
 * @param host - en-tête `Host` de la requête (`localhost` s'il manque)
 * @param rawUrl - cible brute de la requête (`/` si elle manque)
 * @returns l'URL analysée
 * @throws TypeError si l'hôte ou la cible ne forment pas une URL
 */
export function parseWebsocketUrl(
  scheme: string,
  host: string | undefined,
  rawUrl: string | undefined,
): URL {
  const absolute = splitAbsoluteForm(rawUrl);
  if (absolute !== null) {
    return new URL(`${scheme}://${absolute.authority}${absolute.target}`);
  }
  return new URL(`${scheme}://${host ?? "localhost"}${rawUrl ?? "/"}`);
}
