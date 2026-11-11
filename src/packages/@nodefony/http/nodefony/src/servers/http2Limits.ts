import type {
  Http2SecureServer,
  Http2Server,
  ServerHttp2Session,
  ServerOptions,
} from "node:http2";
import type { IHttpConfig } from "../../config/config";
import { closeIdleSession } from "./http2Goaway";

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
 * Une session HTTP/2, et non une socket HTTP/1.1 : sur 5152 (`allowHTTP1`),
 * l'événement `timeout` du serveur reçoit les deux. `node:http2` n'exporte pas
 * la classe de session — elle se reconnaît à sa capacité (`goaway`).
 */
function isHttp2Session(target: unknown): target is ServerHttp2Session {
  return typeof target === "object" && target !== null && "goaway" in target;
}

/**
 * Ferme les sessions d'un serveur HTTP/2 — TLS (5152) comme h2c — restées
 * inactives au-delà de `timeoutMs`, et contourne un défaut de Node qui garde
 * chaque session fermée en vie jusqu'à l'échéance de ce délai.
 *
 * **La fermeture est À NOUS.** Node arme chaque session par
 * `session.setTimeout(server.timeout, sessionOnTimeout)` — un écouteur `once` —
 * et `sessionOnTimeout` ne détruit la session que si le serveur n'a AUCUN
 * écouteur `timeout` ; s'il en a un, il lui passe la main, UNE fois par session
 * (`internal/http2/core`, Node 26.13). Le serveur 5152 en a toujours un
 * (`routeSocketTimeout`, pour ses sockets HTTP/1.1), et ce délai doit prévenir
 * l'application (`onTimeout`) : sans fermeture ici, une session inactive vivait
 * jusqu'à ce que le CLIENT la ferme (#763). À l'échéance, la session est fermée
 * en douceur — GOAWAY annoncé puis définitif, les flux en cours vont à leur
 * terme ({@link closeIdleSession}, RFC 9113 §9.1 et §6.8).
 *
 * **Le contournement** (Node 24, 26) : `closeSession` marque la session détruite
 * PUIS appelle `session.setTimeout(0)`, qui sort aussitôt sur un objet détruit ;
 * le minuteur retient alors la session (~2,4 Ko) pendant `timeoutMs`. Il est
 * désarmé à la réception du GOAWAY, AVANT la destruction — c'est ainsi que
 * ferment un proxy et un client Node, même par `destroy()` ; et
 * `closeIdleSession` le désarme avant de fermer. Signalé à Node :
 * https://github.com/nodejs/node/issues/66885 (corrigé par nodejs/node#66886,
 * absent de la 26.13). Une coupure TCP sans GOAWAY garde la rétention, bornée
 * au délai.
 *
 * Coût par requête : nul — un écouteur par serveur, et la fermeture n'agit qu'à
 * l'échéance.
 *
 * @param server - le serveur HTTP/2.
 * @param timeoutMs - délai d'inactivité ; 0 ou absent le laisse désactivé.
 * @param onTimeout - appelé à l'échéance d'une session (événement `timeout` du
 *   serveur), après le début de sa fermeture.
 */
export function setHttp2SessionTimeout(
  server: Http2Server | Http2SecureServer,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): void {
  if (!timeoutMs) return;
  server.setTimeout(timeoutMs, (target?: unknown) => {
    // Une socket HTTP/1.1 (5152) relève de `routeSocketTimeout`.
    if (!isHttp2Session(target)) return;
    closeIdleSession(target);
    onTimeout();
  });
  server.on("session", (session: ServerHttp2Session) => {
    session.once("goaway", () => {
      session.setTimeout(0);
    });
  });
}
