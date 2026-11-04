import { parseBareOrigin } from "nodefony";

/**
 * Schémas qu'accepte `realtime.publicOrigin` : celui de la socket (`ws:`,
 * `wss:`) ou celui de l'hôte qui la sert (`http:`, `https:`), ramené au
 * premier.
 */
export const REALTIME_ORIGIN_PROTOCOLS: readonly string[] = [
  "ws:",
  "wss:",
  "http:",
  "https:",
];

/** Le schéma de socket qui correspond à chaque schéma accepté. */
const SOCKET_SCHEME: Readonly<Record<string, string>> = {
  "ws:": "ws:",
  "wss:": "wss:",
  "http:": "ws:",
  "https:": "wss:",
};

/**
 * Rend la source `connect-src` qui autorise la socket servie à `publicOrigin`,
 * toujours sous son schéma de socket.
 *
 * Une source `wss://hôte` couvre `wss:` ET `https:` du même hôte (CSP Level 3,
 * « scheme-part match ») ; une source `https://hôte` ne couvrirait PAS la
 * socket. D'où la conversion `https:` → `wss:`, `http:` → `ws:`.
 *
 * @param publicOrigin - origine nue où la socket est servie
 * @returns la source à déclarer (`wss://rt.example.com:8443`), ou `null` si la
 *   valeur n'est pas une origine nue d'un schéma accepté
 */
export function realtimeConnectSource(publicOrigin: string): string | null {
  const url = parseBareOrigin(publicOrigin, REALTIME_ORIGIN_PROTOCOLS);
  if (url === null) return null;
  const scheme = SOCKET_SCHEME[url.protocol];
  if (scheme === undefined) return null;
  // `host` omet le port par défaut du schéma d'origine ; celui de `https:` et
  // de `wss:` est le même (443), celui de `http:` et de `ws:` aussi (80).
  return `${scheme}//${url.host}`;
}
