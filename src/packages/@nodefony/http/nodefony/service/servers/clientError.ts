import { METHODS, STATUS_CODES } from "node:http";
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
 * Une réponse est-elle à MI-CHEMIN sur cette socket — en-têtes partis, corps
 * pas fini ? La garde de Node (`socketOnError` : `_httpMessage._headerSent`),
 * lue par réflexion, plus une condition : la réponse n'est pas TERMINÉE
 * (`writableEnded`, public sur `OutgoingMessage`).
 *
 * Une réponse terminée reste désignée par `_httpMessage` jusqu'à son `finish`,
 * qui attend l'acquittement de l'écriture — sous Windows (écritures
 * asynchrones), la requête suivante d'une socket keep-alive arrive souvent
 * avant. Ses octets sont déjà tous dans la file : un statut écrit derrière ne
 * corrompt rien, il répond à la requête suivante.
 */
function inFlightHeaderSent(socket: Duplex): boolean {
  const message: unknown = Reflect.get(socket, "_httpMessage");
  return (
    message !== null &&
    typeof message === "object" &&
    Reflect.get(message, "_headerSent") === true &&
    Reflect.get(message, "writableEnded") !== true
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

/** Méthodes reconnues en tête d'un paquet : il COMMENCE alors une requête. */
const REQUEST_METHODS: ReadonlySet<string> = new Set(METHODS);

/** Plus longue méthode connue, espace comprise : borne la recherche du jeton. */
const METHOD_PREFIX_MAX =
  METHODS.reduce((n, m) => Math.max(n, m.length), 0) + 1;

/** `HTTP/`, début de la version qui suit la cible sur la ligne de requête. */
const VERSION_PREFIX = Buffer.from("HTTP/", "latin1");

/**
 * Le statut d'un `HPE_HEADER_OVERFLOW` : Node lève la même erreur pour une
 * cible trop longue et pour des en-têtes trop longs, alors que la norme les
 * distingue — 414 pour la cible (RFC 9112 §3, MUST), 431 pour les en-têtes
 * (RFC 6585 §5, MAY).
 *
 * Seul le paquet COURANT est connu (`rawPacket`, débordement constaté au point
 * `bytesParsed`) ; le parseur n'expose ni la cible ni les en-têtes déjà lus.
 * Dans l'ordre :
 * - un `CRLF` précède ce point → la ligne de requête est finie : 431 ;
 * - sinon, des octets qu'une cible ne peut pas porter (espace hors de celle
 *   qui précède `HTTP/`, tabulation) → c'est une valeur d'en-tête : 431 ;
 * - sinon le paquet ne permet pas de trancher — une valeur d'en-tête sans
 *   espace, arrivée en plusieurs paquets, ressemble octet pour octet à la
 *   suite d'une cible. On répond 414 : c'est le côté où la norme OBLIGE.
 *
 * Sur un vrai réseau (paquets ~1,4 Ko) le dernier cas est la règle pour une
 * cible, et le deuxième pour les gros en-têtes réels (`Cookie: a=1; b=2`,
 * `User-Agent`). Faute de ces deux champs, 431 : le statut de Node.
 */
function overflowStatusLine(error: Error): string {
  const raw: unknown = "rawPacket" in error ? error.rawPacket : undefined;
  const parsed: unknown =
    "bytesParsed" in error ? error.bytesParsed : undefined;
  if (Buffer.isBuffer(raw) && typeof parsed === "number") {
    const eol = raw.indexOf("\r\n");
    if (eol !== -1 && eol < parsed) {
      return "431 Request Header Fields Too Large";
    }
    return carriesHeaderValue(raw, parsed)
      ? "431 Request Header Fields Too Large"
      : "414 URI Too Long";
  }
  return "431 Request Header Fields Too Large";
}

/**
 * Les octets lus de ce paquet (jusqu'à `end`) excluent-ils une cible ?
 *
 * Une cible ne porte ni espace ni tabulation (RFC 9112 §3.2) : l'espace qui la
 * TERMINE est suivie de la version (`HTTP/`), et celle qui suit la méthode est
 * sautée quand le paquet commence une requête.
 *
 * @param raw - paquet reçu
 * @param end - octets lus par le parseur dans ce paquet
 * @returns `true` si ces octets ne peuvent appartenir qu'à un en-tête
 */
function carriesHeaderValue(raw: Buffer, end: number): boolean {
  let from = 0;
  const methodEnd = raw.subarray(0, METHOD_PREFIX_MAX).indexOf(0x20);
  if (
    methodEnd > 0 &&
    REQUEST_METHODS.has(raw.toString("latin1", 0, methodEnd))
  ) {
    from = methodEnd + 1;
  }
  const stop = Math.min(end, raw.length);
  for (let i = from; i < stop; i++) {
    const byte = raw[i];
    if (byte === 0x09) return true;
    if (byte === 0x20) return !startsVersion(raw, i + 1);
  }
  return false;
}

/** Ce qui suit `at` est-il le début de `HTTP/` (paquet tronqué compris) ? */
function startsVersion(raw: Buffer, at: number): boolean {
  const n = Math.min(VERSION_PREFIX.length, raw.length - at);
  for (let k = 0; k < n; k++) {
    if (raw[at + k] !== VERSION_PREFIX[k]) return false;
  }
  return true;
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
