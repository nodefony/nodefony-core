import type {
  Http2SecureServer,
  Http2Server,
  ServerHttp2Session,
  ServerOptions,
} from "node:http2";
import type { IHttpConfig } from "../../config/config";

/**
 * Limites anti-DoS d'un serveur HTTP/2, lues dans la section `http2` du module :
 * `maxSessionMemory` (amplification mémoire) et `maxConcurrentStreams` dans les
 * SETTINGS (CVE-2023-44487, Rapid Reset). Règle UNIQUE des serveurs HTTP/2 — TLS
 * (5152) comme h2c — : une limite oubliée sur l'un d'eux en ferait la porte de
 * l'attaque.
 *
 * Une limite absente garde le défaut de Node (aucune régression).
 *
 * @param limits - `module.options.http2`.
 * @returns les options à fusionner dans celles de `createServer`/`createSecureServer`.
 */
export function http2ServerLimits(
  limits: Partial<IHttpConfig["http2"]> | undefined,
): Pick<ServerOptions, "maxSessionMemory" | "settings"> {
  const options: Pick<ServerOptions, "maxSessionMemory" | "settings"> = {};
  if (limits?.maxSessionMemory) {
    options.maxSessionMemory = limits.maxSessionMemory;
  }
  if (limits?.maxConcurrentStreams) {
    options.settings = { maxConcurrentStreams: limits.maxConcurrentStreams };
  }
  return options;
}

/**
 * Borne l'inactivité des sessions d'un serveur HTTP/2 — TLS (5152) comme h2c —
 * et contourne un défaut de Node qui garde chaque session fermée en vie jusqu'à
 * l'échéance de ce délai.
 *
 * Le défaut (Node 24, 26) : `closeSession` (`internal/http2/core`) marque la
 * session détruite PUIS appelle `session.setTimeout(0)` ; or `setStreamTimeout`
 * sort aussitôt sur un objet détruit. Le minuteur n'est jamais désarmé et retient
 * la session (~2,4 Ko) pendant `timeoutMs` : sous un flux de connexions neuves,
 * connexions/s × délai × 2,4 Ko. Signalé à Node : https://github.com/nodejs/node/issues/66885
 *
 * Le contournement : désarmer à la réception du GOAWAY, AVANT la destruction —
 * c'est ainsi que ferment un proxy et un client Node, même par `destroy()`. Rien
 * n'est retiré à la protection : Node n'agit déjà plus à l'échéance sur une
 * session fermée (`sessionOnTimeout` sort sur `closed`). Une coupure TCP sans
 * GOAWAY garde la rétention, bornée au délai.
 *
 * @param server - le serveur HTTP/2.
 * @param timeoutMs - délai d'inactivité ; 0 ou absent le laisse désactivé.
 * @param onTimeout - appelé à l'échéance (événement `timeout` du serveur).
 */
export function setHttp2SessionTimeout(
  server: Http2Server | Http2SecureServer,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): void {
  if (!timeoutMs) return;
  server.setTimeout(timeoutMs, onTimeout);
  server.on("session", (session: ServerHttp2Session) => {
    session.once("goaway", () => {
      session.setTimeout(0);
    });
  });
}
