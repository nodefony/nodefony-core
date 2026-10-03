import http from "node:http";
import https from "node:https";
import type http2 from "node:http2";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { IProxyMount } from "../../interfaces/IReverseProxy";

/** Requête entrante relayable : HTTP/1.1 ou HTTP/2 (API de compatibilité). */
export type ProxiedRequest = http.IncomingMessage | http2.Http2ServerRequest;
/** Réponse vers le client : HTTP/1.1 ou HTTP/2 (API de compatibilité). */
export type ProxiedResponse = http.ServerResponse | http2.Http2ServerResponse;

/**
 * Ce que le proxy sait du client, et qu'il annonce à l'amont
 * (`X-Forwarded-*`, `Via`).
 */
export interface IForwardedFrom {
  /** Adresse du pair TCP immédiat — ajoutée à la chaîne `X-Forwarded-For`. */
  remoteAddress: string | undefined;
  /** Scheme par lequel le pair est arrivé (`http` | `https`). */
  scheme: string;
  /** Autorité demandée (`Host` ou `:authority`). */
  host: string | undefined;
  /**
   * Le pair est-il un relais de confiance (`trustProxy`) ? Seul un tel pair
   * peut faire passer des `Forwarded`/`X-Forwarded-*`/`X-Real-IP` : venus
   * d'ailleurs, ils sont forgeables (RFC 7239 §8.1) et sont écartés.
   */
  trustedPeer: boolean;
  /** Version du message reçu, pour `Via` (`"1.1"`, `"2.0"`). */
  httpVersion: string;
}

/** Réglages du relais, fixés par le service (identiques pour tous les montages). */
export interface IRelaySettings {
  /** Pseudonyme de CE processus dans `Via` (RFC 9110 §7.6.3) — base de la garde de boucle. */
  pseudonym: string;
  /** Délai d'établissement de la connexion amont (ms). Dépassé : 504. */
  connectTimeoutMs: number;
  /** Pool de connexions du montage (keep-alive borné), ou `undefined`. */
  agent: http.Agent | undefined;
}

/**
 * En-têtes de CONNEXION (RFC 9110 §7.6.1) : ils décrivent un saut, jamais le
 * message — un intermédiaire ne les transmet pas. Les cinq premiers sont en
 * outre INTERDITS en HTTP/2 (RFC 9113 §8.2.2) : Node lève
 * `ERR_HTTP2_INVALID_CONNECTION_HEADERS` si une réponse les porte.
 */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
]);

/**
 * En-têtes qui décrivent la chaîne de relais. Crus d'un relais de confiance,
 * écartés sinon : un client direct qui les pose ment sur son origine.
 */
const FORWARDING: ReadonlySet<string> = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-prefix",
  "x-forwarded-scheme",
  "x-real-ip",
]);

/** Corps d'erreur du proxy — courts, sans détail interne. */
const BAD_GATEWAY = "Bad Gateway";
const GATEWAY_TIMEOUT = "Gateway Timeout";
const LOOP_DETECTED = "Loop Detected";

/**
 * Noms listés par l'en-tête `Connection` d'un message : eux aussi ne valent
 * que pour ce saut (RFC 9110 §7.6.1).
 *
 * @param value - valeur brute de `Connection`
 * @returns noms en minuscules, ou `null` s'il n'y en a aucun
 */
function connectionTokens(
  value: string | string[] | undefined,
): Set<string> | null {
  if (value === undefined) return null;
  const raw = Array.isArray(value) ? value.join(",") : value;
  let tokens: Set<string> | null = null;
  for (const t of raw.split(",")) {
    const name = t.trim().toLowerCase();
    if (name === "") continue;
    (tokens ??= new Set()).add(name);
  }
  return tokens;
}

/** Valeur d'en-tête aplatie (`a, b` pour un tableau). */
function flat(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * Le message est-il déjà passé par CE processus ? Un `Via` qui porte notre
 * pseudonyme signe une boucle (RFC 9110 §7.6 : un proxy ne se renvoie pas un
 * message sans s'en protéger).
 *
 * @param via - en-tête `Via` reçu
 * @param pseudonym - pseudonyme de ce processus
 */
export function viaLoops(
  via: string | string[] | undefined,
  pseudonym: string,
): boolean {
  const value = flat(via);
  if (value === undefined) return false;
  for (const hop of value.split(",")) {
    // `1.1 nodefony-ab12cd34 (commentaire)` → 2e jeton = reçu-par.
    if (hop.trim().split(/\s+/)[1] === pseudonym) return true;
  }
  return false;
}

/** Entrée `Via` de ce saut : `<version> <pseudonyme>` (RFC 9110 §7.6.3). */
function viaEntry(httpVersion: string, pseudonym: string): string {
  const version = httpVersion.startsWith("2") ? "2" : httpVersion || "1.1";
  return `${version} ${pseudonym}`;
}

/** Cadrage du corps transmis à l'amont (RFC 9112 §6). */
export type BodyFraming = "none" | "length" | "chunked";

/**
 * Cadrage du corps reçu — décidé UNE fois, pour que l'amont lise exactement
 * les octets que le proxy lui envoie (RFC 9112 §6.3). Un `Transfer-Encoding`
 * l'emporte sur un `Content-Length` (que l'on retire alors) ; en HTTP/2, un
 * flux sans fin à la tête porte un corps même sans longueur annoncée.
 *
 * @param req - requête reçue
 * @returns le cadrage à appliquer vers l'amont
 */
export function bodyFramingOf(req: ProxiedRequest): BodyFraming {
  if (req.headers["transfer-encoding"] !== undefined) return "chunked";
  if (req.headers["content-length"] !== undefined) return "length";
  const stream = (req as http2.Http2ServerRequest).stream as
    http2.ServerHttp2Stream | undefined;
  if (stream !== undefined && !stream.endAfterHeaders) return "chunked";
  return "none";
}

/**
 * En-têtes de la requête à transmettre à l'amont.
 *
 * - écartés : pseudo-en-têtes HTTP/2, en-têtes de connexion et ceux que nomme
 *   `Connection`, `Expect` (le serveur a déjà répondu `100`), en-têtes retirés
 *   par le montage, chaîne de relais venue d'un pair NON fiable ;
 * - `Host` réécrit sur la cible (sauf `preserveHost`) ;
 * - `X-Forwarded-For` prolongé (pair fiable) ou recommencé ;
 *   `X-Forwarded-Proto`/`-Host` hérités d'un pair fiable, posés sinon ;
 *   `X-Forwarded-Prefix` quand le préfixe est retiré ;
 * - `Via` prolongé de ce saut ;
 * - cadrage du corps rendu cohérent ({@link bodyFramingOf}).
 *
 * @returns un objet neuf, prêt pour `http.request`
 */
export function requestHeadersFor(
  headers: http.IncomingHttpHeaders,
  mount: IProxyMount,
  target: URL,
  from: IForwardedFrom,
  pseudonym: string,
  framing: BodyFraming,
): http.OutgoingHttpHeaders {
  const listed = connectionTokens(headers.connection);
  const stripped = mount.stripHeaders;
  const out: http.OutgoingHttpHeaders = {};
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (lower.charCodeAt(0) === 58 /* ":" */) continue;
    if (HOP_BY_HOP.has(lower) || listed?.has(lower)) continue;
    if (lower === "host" || lower === "expect" || lower === "via") continue;
    if (lower === "content-length" && framing !== "length") continue;
    if (FORWARDING.has(lower) && !from.trustedPeer) continue;
    // Noms déjà en minuscules : normalisés une fois, au montage.
    if (stripped?.includes(lower)) continue;
    const value = headers[name];
    if (value !== undefined) out[lower] = value;
  }
  out.host = mount.preserveHost === true && from.host ? from.host : target.host;
  const prior = from.trustedPeer ? flat(headers["x-forwarded-for"]) : undefined;
  if (from.remoteAddress) {
    out["x-forwarded-for"] = prior
      ? `${prior}, ${from.remoteAddress}`
      : from.remoteAddress;
  }
  out["x-forwarded-proto"] ??= from.scheme;
  if (from.host) out["x-forwarded-host"] ??= from.host;
  if (mount.stripPrefix === true) {
    out["x-forwarded-prefix"] = mount.prefix.slice(0, -1);
  }
  const via = flat(headers.via);
  const hop = viaEntry(from.httpVersion, pseudonym);
  out.via = via ? `${via}, ${hop}` : hop;
  if (framing === "chunked") out["transfer-encoding"] = "chunked";
  return out;
}

/**
 * Ramène sous le préfixe un `Location` émis par un amont qui ignore son
 * montage (`stripPrefix`) — l'équivalent de `proxy_redirect default` de
 * nginx. Un chemin absolu (`/login`) et une URL sur l'origine de l'amont sont
 * réécrits ; toute autre URL (un tiers) part intacte.
 *
 * @returns la valeur réécrite, ou celle reçue
 */
export function rewriteLocation(
  location: string,
  mount: IProxyMount,
  target: URL,
): string {
  if (mount.stripPrefix !== true) return location;
  if (location.startsWith("/") && !location.startsWith("//")) {
    return mount.prefix + location.slice(1);
  }
  if (location.startsWith(target.origin + "/") || location === target.origin) {
    return mount.prefix + location.slice(target.origin.length + 1);
  }
  return location;
}

/**
 * En-têtes de la réponse de l'amont à renvoyer au client : en-têtes de
 * connexion écartés — y compris ceux que nomme `Connection` —, `Via`
 * prolongé, `Location` ramené sous le préfixe (`stripPrefix`) ; le reste
 * intact (un `set-cookie` multiple reste un tableau).
 *
 * @returns un objet neuf, valable en HTTP/1.1 comme en HTTP/2
 */
export function responseHeadersFor(
  headers: http.IncomingHttpHeaders,
  mount: IProxyMount,
  target: URL,
  hop: string,
): http.OutgoingHttpHeaders {
  const listed = connectionTokens(headers.connection);
  const out: http.OutgoingHttpHeaders = {};
  for (const name of Object.keys(headers)) {
    if (HOP_BY_HOP.has(name) || listed?.has(name)) continue;
    const value = headers[name];
    if (value !== undefined) out[name] = value;
  }
  const via = flat(headers.via);
  out.via = via ? `${via}, ${hop}` : hop;
  if (typeof out.location === "string") {
    out.location = rewriteLocation(out.location, mount, target);
  }
  return out;
}

/**
 * Chemin transmis à l'amont : tel quel, ou sans le préfixe (`stripPrefix`).
 *
 * @param url - cible de la requête (chemin + requête), qui commence par le préfixe
 * @param mount - montage qui relaie
 * @returns le chemin, toujours avec un `/` en tête
 */
export function upstreamPath(url: string, mount: IProxyMount): string {
  if (mount.stripPrefix !== true) return url;
  return `/${url.slice(mount.prefix.length)}`;
}

/**
 * Options de `http.request` communes aux deux relais : cible, pool, TLS.
 * La vérification du certificat suit `secure` (refusé hors boucle locale
 * au montage).
 */
function requestOptions(
  target: URL,
  mount: IProxyMount,
  relay: IRelaySettings,
): http.RequestOptions & https.RequestOptions {
  const options: http.RequestOptions & https.RequestOptions = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
  };
  if (relay.agent !== undefined) options.agent = relay.agent;
  if (target.protocol === "https:") {
    options.rejectUnauthorized = mount.secure !== false;
  }
  return options;
}

/** Module client selon le scheme de la cible. */
function requestFn(target: URL): typeof http.request {
  return target.protocol === "https:" ? https.request : http.request;
}

/**
 * Arme le délai d'ÉTABLISSEMENT de la connexion amont — distinct du délai
 * d'inactivité : un amont qui n'accepte pas la connexion ne doit pas tenir le
 * client pendant tout `timeoutMs`. Un socket réutilisé (pool) est déjà
 * connecté : rien à armer.
 *
 * @param upstream - requête vers l'amont
 * @param ms - délai
 * @param onTimeout - appelé si la connexion n'est pas établie à temps
 */
function armConnectTimeout(
  upstream: http.ClientRequest,
  ms: number,
  onTimeout: () => void,
): void {
  upstream.once("socket", (socket: Socket) => {
    if (!socket.connecting) return;
    const timer = setTimeout(onTimeout, ms);
    const clear = (): void => clearTimeout(timer);
    socket.once("connect", clear);
    socket.once("close", clear);
  });
}

/**
 * Relaie une requête HTTP vers l'amont et renvoie sa réponse au client.
 *
 * Le corps est transmis avec un cadrage cohérent ({@link bodyFramingOf}). Un
 * message qui porte déjà notre `Via` rend 508 sans contacter l'amont. Un
 * client parti coupe l'échange amont ; un amont injoignable rend 502 ; une
 * connexion non établie à temps ou un amont muet rendent 504 — à condition
 * que rien n'ait encore été envoyé, sinon la réponse est interrompue (un
 * statut ne se rattrape pas). Un amont coupé en plein corps interrompt la
 * réponse au client au lieu de la laisser pendre.
 *
 * @returns une promesse résolue à la fermeture de la réponse — jamais rejetée
 */
export function forwardRequest(
  req: ProxiedRequest,
  res: ProxiedResponse,
  mount: IProxyMount,
  target: URL,
  from: IForwardedFrom,
  relay: IRelaySettings,
): Promise<void> {
  return new Promise((resolve) => {
    // L'API de compatibilité HTTP/2 a la même forme : un seul chemin de code.
    // Mais pas de `destroyed` en HTTP/2 : l'état de la sortie se tient ici.
    const out = res as http.ServerResponse;
    let closed = false;
    let failed = false;
    const fail = (status: number, body: string): void => {
      // Un amont détruit après un 504 lève encore `error` : une réponse, une.
      if (failed || closed) return;
      failed = true;
      if (out.headersSent) {
        out.destroy();
        return;
      }
      out.writeHead(status, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
      });
      out.end(body);
    };
    // `close` part toujours, fin normale comme abandon : seul point de sortie.
    let upstream: http.ClientRequest | null = null;
    out.once("close", () => {
      closed = true;
      if (!out.writableFinished) upstream?.destroy();
      resolve();
    });
    if (viaLoops(req.headers.via, relay.pseudonym)) {
      // Le corps éventuel n'est pas lu : il est jeté avec la connexion.
      fail(508, LOOP_DETECTED);
      return;
    }
    const framing = bodyFramingOf(req);
    const options = requestOptions(target, mount, relay);
    options.method = req.method ?? "GET";
    options.path = upstreamPath(req.url ?? "/", mount);
    options.headers = requestHeadersFor(
      req.headers,
      mount,
      target,
      from,
      relay.pseudonym,
      framing,
    );
    if (mount.timeoutMs !== undefined) options.timeout = mount.timeoutMs;
    const request = requestFn(target)(options);
    upstream = request;
    let timedOut = false;
    const giveUp = (): void => {
      timedOut = true;
      fail(504, GATEWAY_TIMEOUT);
      request.destroy();
    };
    armConnectTimeout(request, relay.connectTimeoutMs, giveUp);
    request.on("timeout", giveUp);
    request.on("error", () => {
      if (!timedOut) fail(502, BAD_GATEWAY);
    });
    const hop = viaEntry(from.httpVersion, relay.pseudonym);
    request.on("response", (answer) => {
      if (closed || failed) {
        answer.resume();
        return;
      }
      // Une réponse que la sortie refuse (en-tête interdit en HTTP/2, valeur
      // invalide) lèverait dans un écouteur — donc hors de toute promesse :
      // le processus entier tomberait. Elle devient un 502.
      try {
        out.writeHead(
          answer.statusCode ?? 502,
          responseHeadersFor(answer.headers, mount, target, hop),
        );
      } catch {
        answer.resume();
        fail(502, BAD_GATEWAY);
        return;
      }
      // Amont coupé avant la fin : `pipe` ne termine pas la sortie, et la
      // réponse au client pendrait. (Pas d'écouteur `error` : sans écouteur,
      // Node n'émet pas l'« aborted » d'un `IncomingMessage` — vérifié à
      // l'exécution, contrairement à ce que laisse lire la doc de
      // `http.request`.)
      answer.once("close", () => {
        if (!answer.complete) out.destroy();
      });
      answer.pipe(out);
    });
    if (framing === "none") {
      request.end();
      return;
    }
    // Corps transmis tel qu'il arrive. Pas `stream.pipeline` : sur échec amont
    // il détruirait la requête du CLIENT, et le 502 ne lui parviendrait plus.
    const body = req as http.IncomingMessage;
    const onClientError = (): void => {
      request.destroy();
    };
    body.once("error", onClientError);
    request.once("close", () => {
      body.removeListener("error", onClientError);
      body.unpipe(request);
      // Corps non lu (amont tombé) : le vider, pour que la réponse puisse partir.
      if (!body.readableEnded) body.resume();
    });
    body.pipe(request);
  });
}

/**
 * Sérialise une tête de réponse HTTP/1.1 depuis des en-têtes BRUTS (paires
 * nom/valeur), sans réordonner ni fusionner, en écartant les noms donnés —
 * une réponse `101` doit rendre au client exactement ce que l'amont a négocié.
 *
 * @param status - ligne de statut, sans CRLF
 * @param rawHeaders - `IncomingMessage.rawHeaders`
 * @param skip - noms à écarter (minuscules)
 * @param extra - lignes ajoutées à la fin (`Nom: valeur`)
 * @returns la tête complète, CRLF final compris
 */
export function rawHead(
  status: string,
  rawHeaders: readonly string[],
  skip: ReadonlySet<string> | null = null,
  extra: readonly string[] = [],
): string {
  let head = `${status}\r\n`;
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = rawHeaders[i] ?? "";
    if (skip?.has(name.toLowerCase())) continue;
    head += `${name}: ${rawHeaders[i + 1]}\r\n`;
  }
  for (const line of extra) head += `${line}\r\n`;
  return `${head}\r\n`;
}

/** Réponse brute minimale sur un socket d'upgrade, puis fermeture. */
export function refuseUpgrade(
  socket: Duplex,
  status: number,
  reason: string,
): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/** En-têtes d'une réponse d'amont REFUSANT l'upgrade, à ne pas recopier tels quels. */
const REFUSAL_SKIP: ReadonlySet<string> = new Set([
  "transfer-encoding",
  "content-length",
  "connection",
  "keep-alive",
]);

/**
 * Relaie un upgrade WebSocket DÉJÀ validé (méthode, `Upgrade`, clé, version,
 * `Origin` — cf `ReverseProxy.handleUpgrade`) : rejoue le handshake vers
 * l'amont, renvoie sa réponse `101` au client puis raccorde les deux sockets
 * octet pour octet. Un refus de l'amont (`400`, `403`…) est rendu avec un
 * cadrage refait (fin de corps = fermeture) ; un amont injoignable rend `502`,
 * une connexion non établie à temps `504`, une boucle `508`. Une erreur d'un
 * côté détruit l'autre.
 */
export function forwardUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  mount: IProxyMount,
  target: URL,
  from: IForwardedFrom,
  relay: IRelaySettings,
): void {
  if (viaLoops(req.headers.via, relay.pseudonym)) {
    refuseUpgrade(socket, 508, LOOP_DETECTED);
    return;
  }
  const options = requestOptions(target, mount, relay);
  // Un upgrade ne réutilise pas une connexion du pool : elle devient un tunnel.
  options.agent = false;
  options.method = "GET";
  options.path = upstreamPath(req.url ?? "/", mount);
  const headers = requestHeadersFor(
    req.headers,
    mount,
    target,
    from,
    relay.pseudonym,
    "none",
  );
  headers.connection = "Upgrade";
  headers.upgrade = "websocket";
  options.headers = headers;
  if (head.length > 0) socket.unshift(head);
  const upstream = requestFn(target)(options);
  // `pending` → `open` (101) ou `refused` (réponse rendue au client).
  let state: "pending" | "open" | "refused" = "pending";
  const onClientError = (): void => {
    upstream.destroy();
  };
  socket.once("error", onClientError);
  armConnectTimeout(upstream, relay.connectTimeoutMs, () => {
    state = "refused";
    refuseUpgrade(socket, 504, GATEWAY_TIMEOUT);
    upstream.destroy();
  });
  upstream.on("upgrade", (answer, upSocket, upHead) => {
    state = "open";
    socket.removeListener("error", onClientError);
    const destroyBoth = (): void => {
      socket.destroy();
      upSocket.destroy();
    };
    socket.on("error", destroyBoth);
    upSocket.on("error", destroyBoth);
    // Tunnel de longue durée : un pair mort se détecte au niveau TCP.
    upSocket.setKeepAlive(true);
    // `'upgrade'` remet toujours un `net.Socket` (doc `http.Server`).
    (socket as Socket).setKeepAlive(true);
    if (upHead.length > 0) upSocket.unshift(upHead);
    socket.write(
      rawHead(
        `HTTP/1.1 101 ${answer.statusMessage ?? "Switching Protocols"}`,
        answer.rawHeaders,
      ),
    );
    upSocket.pipe(socket).pipe(upSocket);
  });
  upstream.on("response", (answer) => {
    state = "refused";
    // L'amont refuse : sa réponse part avec un cadrage refait — le corps reçu
    // est déjà décodé, un `Transfer-Encoding` recopié mentirait.
    socket.write(
      rawHead(
        `HTTP/1.1 ${answer.statusCode ?? 502} ${answer.statusMessage ?? ""}`,
        answer.rawHeaders,
        REFUSAL_SKIP,
        ["Connection: close"],
      ),
    );
    answer.pipe(socket);
  });
  upstream.on("error", () => {
    // Déjà répondu (504, refus de l'amont) : laisser la réponse partir.
    if (state === "refused") return;
    if (state === "open") {
      socket.destroy();
      return;
    }
    state = "refused";
    refuseUpgrade(socket, 502, BAD_GATEWAY);
  });
  upstream.end();
}
