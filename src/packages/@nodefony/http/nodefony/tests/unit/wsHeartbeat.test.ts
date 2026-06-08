/// <reference types="node" />
import { expect } from "chai";
import Ws, { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import {
  startHeartbeat,
  trackPong,
} from "../../service/servers/wsHeartbeat.js";

// G2 — heartbeat keep-alive (RFC 6455 §5.5.2/§5.5.3) au-dessus de `ws@8` qui n'a
// AUCUN keep-alive natif. Vérifie : (1) un client conforme (auto-pong) reste ouvert,
// (2) un zombie qui ne pong jamais est `terminate()` dans la fenêtre interval+grace,
// (3) `keepaliveInterval <= 0` désactive proprement (retourne null).

describe("wsHeartbeat — keep-alive WS (détection half-open)", () => {
  const open = (port: number): Promise<Ws> =>
    new Promise((resolve, reject) => {
      const ws = new Ws(`ws://127.0.0.1:${port}`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });

  it("garde un client vivant ouvert et terminate un zombie sans pong", async () => {
    const interval = 300;
    const grace = 300;
    const wss = new WebSocketServer({ port: 0, clientTracking: true });
    wss.on("connection", (ws) => trackPong(ws));
    await new Promise<void>((r) => wss.once("listening", () => r()));
    const timer = startHeartbeat(wss, {
      keepaliveInterval: interval,
      keepaliveGracePeriod: grace,
    });
    const port = (wss.address() as AddressInfo).port;

    let alive: Ws | null = null;
    let zombie: Ws | null = null;
    try {
      // Client conforme : auto-pong actif (RFC §5.5.2 « MUST send Pong »).
      alive = await open(port);
      // Zombie : auto-pong désactivé → ne répond JAMAIS aux pings serveur.
      zombie = await open(port);
      (zombie as unknown as { _autoPong: boolean })._autoPong = false;
      const zombieClosed = new Promise<void>((r) =>
        zombie!.once("close", () => r()),
      );

      // Attendre > interval + grace + une granularité de tick (+ marge CI).
      await new Promise((r) => setTimeout(r, interval + grace + 900));

      expect(alive.readyState, "client vivant doit rester OPEN").to.equal(
        Ws.OPEN,
      );
      await zombieClosed; // résout uniquement si le serveur a terminate() le zombie
      expect(zombie.readyState, "zombie doit être fermé").to.satisfy(
        (s: number) => s === Ws.CLOSED || s === Ws.CLOSING,
      );
    } finally {
      if (timer) clearInterval(timer);
      alive?.terminate();
      zombie?.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    }
  });

  it("retourne null quand keepaliveInterval <= 0 (désactivé)", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", () => r()));
    try {
      expect(startHeartbeat(wss, { keepaliveInterval: 0 })).to.equal(null);
      expect(startHeartbeat(wss, {})).to.equal(null);
    } finally {
      await new Promise<void>((r) => wss.close(() => r()));
    }
  });
});
