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
