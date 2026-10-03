/// <reference types="node" />
import { expect } from "vitest";
import net from "node:net";
import tls from "node:tls";

// Une connexion keep-alive INACTIVE doit être fermée par le serveur passé
// `keepAliveTimeout` (défaut 5 s). Avant : le serveur passe un callback à
// `server.setTimeout` → Node suspend sa destruction automatique, et le
// gestionnaire par socket de `HttpContext` ne faisait rien d'un socket
// inactif. La connexion vivait jusqu'à ce que le CLIENT la ferme, en
// retenant son dernier contexte. Client brut (pas d'agent) : seul le
// serveur peut fermer.
// Requiert le serveur dev (5151 / 5152, config par défaut des timeouts).

const REQUEST =
  "GET /nodefony/test HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n";
// keepAliveTimeout (5 s) + marge de la boucle d'évènements du serveur.
const LIMIT_MS = 9000;

/** Envoie une requête keep-alive, puis mesure quand le SERVEUR ferme. */
function idleCloseDelay(socket: net.Socket): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let answeredAt = 0;
    socket.on("data", (chunk: Buffer) => {
      if (answeredAt === 0 && chunk.toString("latin1").startsWith("HTTP/1.1")) {
        answeredAt = Date.now();
      }
    });
    socket.on("close", () =>
      resolve(answeredAt === 0 ? null : Date.now() - answeredAt),
    );
    socket.on("error", reject);
    setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, LIMIT_MS + 1000);
    socket.write(REQUEST);
  });
}

describe("Keep-alive inactif — fermé par le serveur (keepAliveTimeout)", () => {
  it(
    "http/1.1 en clair : fermée sous la limite",
    async () => {
      const socket = net.connect({ host: "127.0.0.1", port: 5151 });
      await new Promise((r) => socket.once("connect", r));
      const delay = await idleCloseDelay(socket);
      expect(delay, "connexion encore ouverte : keepAliveTimeout ignoré").to.not
        .be.null;
      expect(delay).to.be.below(LIMIT_MS);
    },
    LIMIT_MS + 3000,
  );

  it(
    "http/1.1 sur TLS : fermée sous la limite",
    async () => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: 5152,
        servername: "localhost",
        rejectUnauthorized: false,
        ALPNProtocols: ["http/1.1"],
      });
      await new Promise((r) => socket.once("secureConnect", r));
      const delay = await idleCloseDelay(socket);
      expect(delay, "connexion encore ouverte : keepAliveTimeout ignoré").to.not
        .be.null;
      expect(delay).to.be.below(LIMIT_MS);
    },
    LIMIT_MS + 3000,
  );
});
