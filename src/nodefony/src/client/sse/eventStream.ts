/**
 * Reconnaître un flux d'événements serveur à sa réponse — la seule lecture,
 * partagée par le client {@link NodefonySse} et la barre de débogage, qui voit
 * passer le même `fetch`. Module à part, sans classe : l'importer ne tire pas
 * le client SSE dans un autre paquet.
 */

/** Le type MIME d'un flux d'événements serveur (WHATWG HTML §9.2). */
export const EVENT_STREAM = "text/event-stream";

/**
 * Cette réponse ouvre-t-elle un flux d'événements ? Un `200` dont le type, aux
 * paramètres près (`; charset=utf-8`), est `text/event-stream` — §9.2.3 : tout
 * autre statut, `204` compris, ou tout autre type fait échouer la connexion.
 *
 * @param response - la réponse, dont seuls le statut et les en-têtes sont lus
 * @returns `true` quand le corps est un flux d'événements
 */
export function isEventStreamResponse(
  response: Pick<Response, "status" | "headers">,
): boolean {
  if (response.status !== 200) return false;
  const type = response.headers.get("Content-Type") ?? "";
  return type.split(";")[0]?.trim().toLowerCase() === EVENT_STREAM;
}
