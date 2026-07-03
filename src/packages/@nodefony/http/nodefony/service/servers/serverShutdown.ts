import { createHttpTerminator, HttpTerminator } from "http-terminator";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Http2SecureServer } from "node:http2";

/**
 * Fabrique le terminator de drain graceful d'un serveur HTTP/HTTPS/HTTP2.
 *
 * Au `terminate()` (shutdown SIGTERM/docker stop) : les requêtes in-flight se
 * terminent (header `connection: close` injecté sur les réponses en cours), les
 * sockets idle sont fermées immédiatement, et tout ce qui reste après
 * `shutdownTimeout` ms est détruit de force. Le terminator appelle lui-même
 * `server.close()` — ne pas le rappeler derrière.
 *
 * ⚠️ Les sockets WebSocket upgradées (sans réponse HTTP en cours) sont détruites
 * SANS frame Close par le terminator → les serveurs WS doivent fermer leurs
 * clients (close 1001) AVANT ce drain. Garanti par l'ordre des listeners
 * `onTerminate` : WS/WSS s'attachent en `prependOnceListener`, les serveurs
 * HTTP en `once`.
 *
 * @param server - serveur Node à drainer (créé, pas forcément listening)
 * @param shutdownTimeout - délai de drain en ms avant destruction forcée
 * @returns le terminator à invoquer au shutdown
 */
export function createDrainTerminator(
  server: HttpServer | HttpsServer | Http2SecureServer,
  shutdownTimeout?: number,
): HttpTerminator {
  return createHttpTerminator({
    server,
    // Fallback hors config validée (tests unit) — le défaut nominal vit dans
    // le schema Zod (`shutdownTimeout`), aligné sur cette valeur.
    gracefulTerminationTimeout: shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT,
  });
}

/** Drain par défaut (ms) — même valeur que le défaut Zod `servers.*.shutdownTimeout`. */
export const DEFAULT_SHUTDOWN_TIMEOUT = 5000;

export type { HttpTerminator };
