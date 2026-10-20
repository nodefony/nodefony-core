import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import type { EventEmitter } from "node:events";
import type { Server as HttpServer, ServerResponse } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type {
  Http2SecureServer,
  Http2Server,
  Http2ServerResponse,
  ServerHttp2Session,
} from "node:http2";
import type { Socket } from "node:net";

/** Serveur que `createDrainTerminator` sait drainer. */
export type DrainableServer =
  HttpServer | HttpsServer | Http2Server | Http2SecureServer;

/** Arrêt gracieux d'un serveur, rendu par `createDrainTerminator`. */
export interface IDrainTerminator {
  /**
   * Draine puis ferme le serveur ; idempotent (le deuxième appel rend la même promesse).
   *
   * @returns une promesse résolue quand toutes les connexions sont fermées
   */
  terminate(): Promise<void>;
}

/**
 * Socket HTTP/1.1 vue avec la réponse qu'elle porte : `_httpMessage` est le champ
 * interne de Node que lisait `http-terminator`. Aucune API publique ne dit
 * qu'une connexion HTTP/1.1 est en train de répondre.
 */
type Http1Socket = Socket & { _httpMessage?: ServerResponse | null };

/**
 * Fabrique l'arrêt gracieux d'un serveur HTTP/1.1, HTTPS, HTTP/2 sur TLS ou h2c.
 *
 * Au `terminate()` (SIGTERM, `docker stop`), le serveur cesse d'accepter, puis :
 * - **HTTP/2** : chaque session reçoit un GOAWAY (`session.close()`) — les flux
 *   en vol se terminent, les nouveaux sont refusés, et le client sait qu'il doit
 *   rouvrir ailleurs au lieu de constater une coupure ;
 * - **HTTP/1.1** : la réponse en vol part avec `Connection: close`, la socket
 *   inactive est fermée tout de suite, une requête qui arrive encore sur une
 *   socket gardée ouverte reçoit aussi `Connection: close`.
 *
 * Ce qui reste après `shutdownTimeout` ms est détruit. `server.close()` est
 * appelé ici : ne pas le rappeler derrière.
 *
 * ⚠️ Les sockets WebSocket upgradées (sans réponse HTTP en cours) sont détruites
 * SANS frame Close → les serveurs WS doivent fermer leurs clients (close 1001)
 * AVANT ce drain. Garanti par l'ordre des listeners `onTerminate` : WS/WSS
 * s'attachent en `prependOnceListener`, les serveurs HTTP en `once`.
 *
 * @param server - serveur Node à drainer, créé AVANT son `listen` (le suivi des
 *   connexions commence ici)
 * @param shutdownTimeout - délai de drain en ms avant destruction forcée
 * @returns l'arrêt à invoquer au shutdown
 */
export function createDrainTerminator(
  server: DrainableServer,
  shutdownTimeout?: number,
): IDrainTerminator {
  // Fallback hors config validée (tests unit) — le défaut nominal vit dans
  // le schema Zod (`shutdownTimeout`), aligné sur cette valeur.
  const timeout = shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT;
  // Élargissement sûr (tous héritent d'EventEmitter) : les signatures `on`
  // surchargées de l'union ne se laissent pas appeler telles quelles.
  const emitter: EventEmitter = server;
  const speaksHttp2 = !(
    server instanceof http.Server || server instanceof https.Server
  );
  const overTls = server instanceof tls.Server;

  // Toutes les connexions, au niveau TCP — y compris un handshake TLS jamais
  // conclu, que `server.close()` attendrait sinon jusqu'à son propre délai.
  const sockets = new Set<Socket>();
  emitter.on("connection", (socket: Socket) => track(sockets, socket));

  // Les connexions qui parlent HTTP/1.1, au niveau où vit la réponse : la
  // socket TCP pour `http`, la socket TLS sinon (h2 exclu, drainé par session).
  let http1Sockets: Set<Socket> | null = null;
  if (!speaksHttp2) {
    http1Sockets = overTls ? new Set<Socket>() : sockets;
  } else if (overTls) {
    http1Sockets = new Set<Socket>(); // `allowHTTP1` du 5152
  }
  if (overTls && http1Sockets !== null) {
    const set = http1Sockets;
    emitter.on("secureConnection", (socket: tls.TLSSocket) => {
      if (socket.alpnProtocol !== "h2") track(set, socket);
    });
  }

  let draining = false;
  const sessions = speaksHttp2 ? new Set<ServerHttp2Session>() : null;
  if (sessions !== null) {
    emitter.on("session", (session: ServerHttp2Session) => {
      // Handshake conclu après le début de l'arrêt : GOAWAY d'emblée.
      if (draining) {
        session.close();
        return;
      }
      sessions.add(session);
      session.once("close", () => sessions.delete(session));
    });
  }

  let terminating: Promise<void> | null = null;
  const drain = (): Promise<void> =>
    new Promise<void>((resolve) => {
      draining = true;
      const deadline = setTimeout(() => {
        if (sessions !== null) for (const s of sessions) s.destroy();
        for (const socket of sockets) socket.destroy();
      }, timeout);
      // Le rappel ne vient qu'une fois TOUTES les connexions fermées ; en
      // erreur (serveur jamais à l'écoute), il n'y a rien à drainer.
      server.close(() => {
        clearTimeout(deadline);
        resolve();
      });
      // Constaté sur Node 24.21 et 26 : `server.close()` envoie déjà le GOAWAY
      // et ferme les sockets HTTP/1.1 inactives. Les gestes explicites restent :
      // la doc de `node:http2` nomme `session.close()` comme LA voie gracieuse,
      // et rien ne garantit ce comportement au plancher `engines`. Le défaut
      // corrigé ici était l'ORDRE : détruire les sockets h2 avant `close()`.
      if (sessions !== null) for (const s of sessions) s.close();
      if (http1Sockets !== null) {
        emitter.on("request", closeAfterResponse);
        for (const socket of http1Sockets) {
          const response = (socket as Http1Socket)._httpMessage;
          if (!response) socket.destroy();
          else if (!response.headersSent)
            response.setHeader("connection", "close");
        }
      }
    });

  return {
    terminate(): Promise<void> {
      terminating ??= drain();
      return terminating;
    },
  };
}

function track(set: Set<Socket>, socket: Socket): void {
  set.add(socket);
  socket.once("close", () => set.delete(socket));
}

/** Requête HTTP/1.1 reçue pendant le drain : la connexion ne survivra pas à sa réponse. */
function closeAfterResponse(
  request: { httpVersionMajor: number },
  response: ServerResponse | Http2ServerResponse,
): void {
  if (request.httpVersionMajor === 1 && !response.headersSent) {
    response.setHeader("connection", "close");
  }
}

/** Drain par défaut (ms) — même valeur que le défaut Zod `servers.*.shutdownTimeout`. */
export const DEFAULT_SHUTDOWN_TIMEOUT = 5000;
