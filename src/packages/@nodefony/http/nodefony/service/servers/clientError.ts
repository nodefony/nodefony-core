import type { Duplex } from "node:stream";

/**
 * Gère l'event `clientError` d'un `http.Server` / `https.Server`.
 *
 * ⚠️ Doc Node (`http.Server` event `'clientError'`) : dès qu'un listener
 * `clientError` est attaché, Node **cesse de fermer le socket automatiquement**
 * (le défaut aurait répondu `400` + détruit le socket). Sans fermeture
 * explicite, un socket malformé reste ouvert → fuite de socket/FD = DoS sur
 * requête mal formée. On répond donc une réponse minimale et on ferme.
 *
 * @param error - erreur émise (codes `llhttp` : `HPE_*`, ou `ECONNRESET`…).
 * @param socket - flux client brut (l'event `clientError` fournit un `Duplex`).
 */
export function handleClientError(
  error: NodeJS.ErrnoException,
  socket: Duplex,
): void {
  // Socket déjà mort ou réinitialisé par le pair : rien à envoyer.
  if (error?.code === "ECONNRESET" || !socket.writable) {
    return;
  }
  // En-têtes trop volumineux → 431 (RFC 6585 §5) ; sinon 400 Bad Request.
  const statusLine =
    error?.code === "HPE_HEADER_OVERFLOW"
      ? "431 Request Header Fields Too Large"
      : "400 Bad Request";
  socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
}
