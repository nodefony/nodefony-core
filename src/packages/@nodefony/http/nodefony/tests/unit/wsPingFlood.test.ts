/// <reference types="node" />
/**
 * Rafale de Ping d'un pair qui ne LIT plus : chaque Ping reçu met un Pong
 * automatique en file (RFC 6455 §5.5.2), et ces Pongs s'accumulent en mémoire
 * côté serveur jusqu'à l'épuisement du process (avis de sécurité de `ws`
 * 8.23.0). Le serveur que Nodefony bâtit avec sa configuration PAR DÉFAUT doit
 * couper ce pair de lui-même, sans réglage de l'application.
 *
 * Sockets réelles : c'est le client qui constate la coupure (1006).
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createNodefonyWebSocketServer } from "../../src/servers/upgradeDispatch";
import { httpConfigSchema } from "../../config/config";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

/**
 * Borne dure de la rafale : sans coupure, le serveur garderait autant de
 * Pongs en mémoire — il faut que le test échoue, pas qu'il épuise le process.
 * Elle dépasse largement ce que les tampons noyau d'une boucle locale
 * absorbent avant que les Pongs ne restent en file (Linux : quelques Mo).
 */
const MAX_PINGS = 400_000;

async function serveWithDefaults(): Promise<number> {
  const options = httpConfigSchema.parse({}).websocket;
  const wss = createNodefonyWebSocketServer(options);
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", () => {});
      wss.emit("connection", ws, req);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  );
  return (server.address() as AddressInfo).port;
}

/** Inonde de Ping sans lire ; rend le code de fermeture vu, ou `null` si rien n'a coupé. */
function flood(port: number): Promise<{ code: number | null; sent: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    closers.push(async () => ws.terminate());
    const data = Buffer.alloc(125);
    let sent = 0;
    ws.once("error", (error) => {
      if (ws.readyState === WebSocket.CONNECTING) reject(error);
    });
    ws.once("close", (code) => resolve({ code, sent }));
    ws.once("open", () => {
      ws.pause();
      const ping = (error?: Error): void => {
        if (error) return; // la coupure arrive par « close »
        if (sent >= MAX_PINGS) {
          resolve({ code: null, sent });
          return;
        }
        sent++;
        ws.ping(data, true, ping);
      };
      ping();
    });
  });
}

describe("serveur WebSocket — rafale de Ping d'un pair qui ne lit plus", () => {
  it("la configuration par défaut coupe le pair avant que les Pongs en file n'épuisent la mémoire", async () => {
    const port = await serveWithDefaults();
    const { code, sent } = await flood(port);
    expect(code, `aucune coupure après ${sent} Ping`).toBe(1006);
    expect(sent).toBeLessThan(MAX_PINGS);
  }, 60_000);
});
