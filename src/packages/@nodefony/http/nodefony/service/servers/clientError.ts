import type { Duplex } from "node:stream";
import { isPeerGoneError } from "../../src/context/websocket/Response";

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
  if (error.code === "ECONNRESET" || !socket.writable) {
    return;
  }
  // En-têtes trop volumineux → 431 (RFC 6585 §5) ; sinon 400 Bad Request.
  const statusLine =
    error.code === "HPE_HEADER_OVERFLOW"
      ? "431 Request Header Fields Too Large"
      : "400 Bad Request";
  socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
}

/**
 * Gère l'event `sessionError` d'un serveur HTTP/2 (h2c ou TLS) : un pair PARTI
 * se tait, toute autre erreur est rapportée.
 *
 * Une session réinitialisée par le pair n'a rien à diagnostiquer. C'est la
 * signature d'une sonde de port — `nodefony status`, `doctor`, le superviseur
 * de développement, la sonde `tcpSocket` d'un orchestrateur — qui se connecte
 * puis ferme sans lire le `SETTINGS` que le serveur envoie dès l'ouverture : le
 * système ferme alors par un RST plutôt qu'un FIN, et Node lève `ECONNRESET`.
 * La rapporter imprimait une pile entière par sonde. La règle « client parti »
 * est celle des frames WebSocket ({@link isPeerGoneError}), pas une copie.
 *
 * @param error - erreur de session émise par `node:http2`
 * @param report - rapporte une erreur réelle, à la sévérité choisie par le serveur
 */
export function handleSessionError(
  error: Error,
  report: (error: Error) => void,
): void {
  if (isPeerGoneError(error)) return;
  report(error);
}
