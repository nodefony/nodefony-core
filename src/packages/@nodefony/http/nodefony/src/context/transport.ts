import type {
  AlpnProtocol,
  ProtocolName,
  ServerType,
} from "../../interfaces/IContext";

/**
 * Famille du protocole traité par un contexte, déduite du serveur qui l'a
 * reçu. Règle UNIQUE : `Context` la pose à la construction.
 *
 * @param serverType - identité du serveur (`http`, `https`, `ws`, `wss`)
 * @returns `"websocket"` pour `ws`/`wss`, `"http"` sinon
 */
export function protocolNameOf(serverType: ServerType): ProtocolName {
  return serverType === "ws" || serverType === "wss" ? "websocket" : "http";
}

/**
 * Ce que la détection lit d'une requête Node, et rien d'autre : `http.IncomingMessage`
 * (HTTP/1.1) et `http2.Http2ServerRequest` (h2, h2c) le satisfont par leur forme, sans
 * transtypage — et une doublure de test s'écrit en littéral.
 */
export interface IAlpnSource {
  readonly httpVersionMajor: number;
  readonly stream?:
    | {
        readonly session?:
          { readonly alpnProtocol?: string | undefined } | undefined;
      }
    | undefined;
}

/**
 * Protocole du saut qui a porté cette requête jusqu'au processus, au sens du
 * registre IANA des identifiants ALPN. Règle UNIQUE : `HttpContext` la lit pour
 * choisir ses classes de requête et de réponse.
 *
 * La valeur se CONSTATE sur la requête, elle ne se déduit pas du serveur : un
 * même serveur TLS reçoit HTTP/1.1 et h2 (`allowHTTP1`). Pour h2, c'est la
 * session de Node qui tranche — `Http2Session.alpnProtocol` vaut `"h2c"` sur
 * une session en clair, l'ALPN négocié (`"h2"`) sur une session TLS.
 *
 * @param request - la requête Node reçue par le serveur
 * @returns `"http/1.1"`, `"h2"` ou `"h2c"`
 */
export function alpnProtocolOf(request: IAlpnSource): AlpnProtocol {
  if (request.httpVersionMajor !== 2) return "http/1.1";
  // Session absente (flux détruit avant le contexte) : h2 sans chiffrement
  // connu — repli sur `"h2"`, la requête ne sera de toute façon pas servie.
  const session = request.stream?.session;
  return session?.alpnProtocol === "h2c" ? "h2c" : "h2";
}

/**
 * Autorité (hôte et port) d'une requête, HTTP/1.1 comme HTTP/2. Règle UNIQUE
 * des lecteurs du serveur.
 *
 * `:authority` d'abord, puis `Host` (RFC 9113 §8.3.1). Le repli n'est pas un
 * confort : un intermédiaire qui convertit une requête HTTP/1.1 de forme origine
 * (`GET /chemin`) en HTTP/2 ne DOIT PAS fabriquer `:authority` — il garde
 * `Host`. C'est ce que fait HAProxy `proto h2` vers un port h2c : sans ce repli,
 * l'hôte est introuvable et la requête part en 421.
 *
 * @param headers - en-têtes de la requête Node (`IncomingMessage` ou `Http2ServerRequest`).
 * @returns l'autorité, ou `undefined` si la requête n'en porte aucune.
 */
export function requestAuthority(headers: {
  host?: string | undefined;
  ":authority"?: string | undefined;
}): string | undefined {
  return headers[":authority"] ?? headers.host;
}
