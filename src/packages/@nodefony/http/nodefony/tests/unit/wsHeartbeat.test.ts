/// <reference types="node" />
import { expect } from "vitest";
import Ws, { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import {
  heartbeatTick,
  startHeartbeat,
  trackPong,
  type IHeartbeatClient,
} from "../../service/servers/wsHeartbeat.js";

// G2 — heartbeat keep-alive (RFC 6455 §5.5.2/§5.5.3) au-dessus de `ws@8` qui n'a
// AUCUN keep-alive natif. Vérifie : (1) un client conforme (auto-pong) reste ouvert,
// (2) un zombie qui ne pong jamais est `terminate()` dans la fenêtre interval+grace,
// (3) `keepaliveInterval <= 0` désactive proprement (retourne null).

/**
 * La RÈGLE du keep-alive, prouvée sur une horloge passée en argument : aucun
 * minuteur réel, donc aucune boucle d'événements chargée qui se ferait passer
 * pour un zombie.
 */
describe("heartbeatTick — la règle, à horloge contrôlée", () => {
  const INTERVAL = 1_000;
  const GRACE = 500;

  interface IProbe extends IHeartbeatClient {
    readyState: number;
    pings: number;
    terminated: number;
  }
  const client = (lastPong: number | null = 0): IProbe => {
    const probe: IProbe = {
      readyState: Ws.OPEN,
      pings: 0,
      terminated: 0,
      ping() {
        probe.pings++;
      },
      terminate() {
        probe.terminated++;
      },
    };
    if (lastPong !== null) {
      probe._nfLastPong = lastPong;
      probe._nfPingedAt = 0;
    }
    return probe;
  };
  const tick = (c: IProbe, now: number) =>
    heartbeatTick([c], now, INTERVAL, GRACE);

  it("muet depuis moins d'un intervalle : ni ping, ni coupure", () => {
    const c = client(0);
    tick(c, INTERVAL - 1);
    expect([c.pings, c.terminated]).to.deep.equal([0, 0]);
  });

  it("muet depuis un intervalle : un ping, un seul tant qu'il attend sa réponse", () => {
    const c = client(0);
    tick(c, INTERVAL);
    tick(c, INTERVAL + 100);
    expect([c.pings, c.terminated]).to.deep.equal([1, 0]);
  });

  it("le pong arrive : jamais coupé, et re-pingué un intervalle plus tard", () => {
    const c = client(0);
    tick(c, INTERVAL);
    c._nfLastPong = INTERVAL + 10; // le pong
    tick(c, INTERVAL + GRACE + 100);
    expect(c.terminated).to.equal(0);
    tick(c, 2 * INTERVAL + 10);
    expect(c.pings).to.equal(2);
  });

  it("pas de pong : coupé APRÈS la grâce, pas à la grâce", () => {
    const c = client(0);
    tick(c, INTERVAL);
    tick(c, INTERVAL + GRACE);
    expect(c.terminated, "à la grâce exacte").to.equal(0);
    tick(c, INTERVAL + GRACE + 1);
    expect(c.terminated, "au-delà").to.equal(1);
  });

  it("une connexion qui n'est plus ouverte est ignorée", () => {
    const c = client(0);
    c.readyState = Ws.CLOSING;
    tick(c, 10 * INTERVAL);
    expect([c.pings, c.terminated]).to.deep.equal([0, 0]);
  });

  it("une connexion jamais amorcée l'est au premier tick, sans ping", () => {
    const c = client(null);
    tick(c, 5 * INTERVAL);
    expect(c._nfLastPong).to.equal(5 * INTERVAL);
    expect(c.pings).to.equal(0);
  });
});

describe("wsHeartbeat — keep-alive WS (détection half-open)", () => {
  const open = (port: number): Promise<Ws> =>
    new Promise((resolve, reject) => {
      const ws = new Ws(`ws://127.0.0.1:${port}`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });

  // Le CÂBLAGE sur de vraies sockets : la règle est prouvée plus haut, à horloge
  // contrôlée. Grâce large : un runner chargé peut retarder le traitement du
  // pong du client vivant de plusieurs centaines de ms, et le couper serait
  // alors un faux zombie — le zombie, lui, ne répond jamais, quelle que soit
  // la grâce.
  it("garde un client vivant ouvert et terminate un zombie sans pong", async () => {
    const interval = 300;
    const grace = 2_000;
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

      await zombieClosed; // résout uniquement si le serveur a terminate() le zombie
      expect(alive.readyState, "client vivant doit rester OPEN").to.equal(
        Ws.OPEN,
      );
      expect(zombie.readyState, "zombie doit être fermé").to.satisfy(
        (s: number) => s === Ws.CLOSED || s === Ws.CLOSING,
      );
    } finally {
      if (timer) clearInterval(timer);
      alive?.terminate();
      zombie?.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    }
    // Le zombie tombe vers interval + grace + un tick ≈ 2,6 s : le délai par
    // défaut (5 s) ne laisserait que 2 s de marge à un runner chargé.
  }, 15_000);

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
