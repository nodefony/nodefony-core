import http2 from "node:http2";
import type http from "node:http";

/**
 * La réponse a-t-elle été TERMINÉE par le serveur ? Règle UNIQUE, pour HTTP/1.1
 * comme pour HTTP/2 — l'écouteur `close` du noyau (client parti → 499) et le
 * timeout par flux de `HttpContext` l'appellent tous deux.
 *
 * Sous HTTP/2, la réponse Nodefony écrit et termine le FLUX
 * (`stream.respond`/`stream.end`), jamais la réponse de compatibilité : son
 * `writableEnded` reste à `false` alors que le client a tout reçu. Mais le
 * flux seul ne suffit pas non plus : un flux ANNULÉ par le pair (RST_STREAM
 * avant la fin) a LUI AUSSI `writableEnded === true`, Node terminant le côté
 * écriture en le détruisant. `aborted` sépare la fin posée par le serveur de la
 * coupure du client — même sémantique que `writableEnded` en HTTP/1.1.
 *
 * @param response - la réponse Node de la requête
 * @returns `true` si le serveur a terminé la réponse (ou son flux HTTP/2) ;
 *   `false` s'il ne l'a pas terminée, client parti compris
 */
export function responseEnded(
  response: http.ServerResponse | http2.Http2ServerResponse,
): boolean {
  if (response.writableEnded) return true;
  if (!(response instanceof http2.Http2ServerResponse)) return false;
  const stream = response.stream;
  return stream.writableEnded && !stream.aborted;
}
