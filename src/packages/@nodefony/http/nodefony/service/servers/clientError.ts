import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import { isPeerGoneError } from "../../src/context/websocket/Response";

/**
 * Le statut que Node lui-même aurait répondu (`_http_server.js#socketOnError`),
 * hors débordement d'en-têtes ({@link overflowStatusLine}) ; 400 sinon.
 * Brancher un écouteur `clientError` retire cette réponse par défaut : sans
 * cette table, un délai de réception dépassé partait en `400 Bad Request` —
 * le client lisait sa requête malformée alors qu'elle était seulement lente.
 */
const CLIENT_ERROR_STATUS: ReadonlyMap<unknown, number> = new Map([
  ["ERR_HTTP_REQUEST_TIMEOUT", 408],
  ["HPE_CHUNK_EXTENSIONS_OVERFLOW", 413],
]);

function statusLineOf(status: number): string {
  return `${status} ${STATUS_CODES[status] ?? ""}`;
}

/**
 * La réponse en vol sur cette socket a-t-elle déjà écrit ses en-têtes ? La
 * garde même de Node (`socketOnError` : `_httpMessage._headerSent`), lue par
 * réflexion — deux champs internes, sans équivalent public sur la socket.
 */
function inFlightHeaderSent(socket: Duplex): boolean {
  const message: unknown = Reflect.get(socket, "_httpMessage");
  return (
    message !== null &&
    typeof message === "object" &&
    Reflect.get(message, "_headerSent") === true
  );
}

/**
 * Gère l'event `clientError` d'un `http.Server` / `https.Server`, et des connexions
 * HTTP/1.1 d'un serveur HTTP/2 à `allowHTTP1`.
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
export function handleClientError(error: Error, socket: Duplex): void {
  const code: unknown = "code" in error ? error.code : undefined;
  // Socket déjà mort ou réinitialisé par le pair : rien à envoyer.
  if (code === "ECONNRESET" || !socket.writable) {
    return;
  }
  // Une réponse EN VOL a déjà envoyé ses en-têtes (un flux qui répond pendant
  // qu'un corps n'en finit pas d'arriver) : une ligne de statut écrite après
  // elle corromprait ce que lit le client. Node se tait et détruit — idem.
  if (inFlightHeaderSent(socket)) {
    socket.destroy();
    return;
  }
  const statusLine =
    code === "HPE_HEADER_OVERFLOW"
      ? overflowStatusLine(error)
      : statusLineOf(CLIENT_ERROR_STATUS.get(code) ?? 400);
  // `Content-Length: 0` délimite le refus (RFC 9112 §6.3) : sans lui, seule
  // la fermeture dit au client que le message est fini.
  socket.end(
    `HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/**
 * Le statut d'un `HPE_HEADER_OVERFLOW` : Node lève la même erreur pour une
 * cible trop longue et pour des en-têtes trop longs, alors que la norme les
 * distingue — 414 pour la cible (RFC 9112 §3), 431 pour les en-têtes
 * (RFC 6585 §5).
 *
 * Le parseur ne constate le débordement qu'à la FIN d'un élément (la cible,
 * une valeur d'en-tête), au point `bytesParsed` du paquet reçu (`rawPacket`).
 * Si la ligne de requête était finie, son `CRLF` — ou celui d'un en-tête —
 * précède ce point : ce sont les en-têtes qui débordent. Sinon, c'est la cible.
 * Constaté sur Node 26, en un paquet comme en plusieurs. Faute de ces deux
 * champs, 431 : le statut d'avant.
 */
function overflowStatusLine(error: Error): string {
  const raw: unknown = "rawPacket" in error ? error.rawPacket : undefined;
  const parsed: unknown =
    "bytesParsed" in error ? error.bytesParsed : undefined;
  if (Buffer.isBuffer(raw) && typeof parsed === "number") {
    const eol = raw.indexOf("\r\n");
    if (eol === -1 || eol >= parsed) return "414 URI Too Long";
  }
  return "431 Request Header Fields Too Large";
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
