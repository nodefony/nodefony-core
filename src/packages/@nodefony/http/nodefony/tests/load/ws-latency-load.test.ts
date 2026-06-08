/// <reference types="node" />
/**
 * LOAD — WebSocket round-trip LATENCY (p50/p95/p99) sous micro-frames rapides.
 * Distinct du débit (ws-messages-load) et du nombre de connexions
 * (ws-connections-load). Serveur live : wss://localhost:5152, route /echo.
 *
 * CI-stable : lossless + plafond p99 généreux (détecte une régression
 * pathologique sans flaker sur une CI chargée). Logge les percentiles réels.
 * G3 — comble le trou « latence non mesurée » du durcissement WebSocket.
 */
import { expect } from "chai";
import WebSocket from "ws";

const ECHO = "wss://localhost:5152/nodefony/test/ws/echo";
const wsOpts = { rejectUnauthorized: false };

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

describe("WS latency — round-trip p50/p95/p99 (micro-frames)", () => {
  it("mesure la latence RTT de 500 micro-frames séquentielles", async () => {
    const N = 500;
    const ws = new WebSocket(ECHO, wsOpts);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    // Consomme le handshake ({handshake:true}) envoyé à la connexion.
    await new Promise<void>((r) => ws.once("message", () => r()));

    const rtts: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const echoed = new Promise<void>((r) => ws.once("message", () => r()));
      ws.send(JSON.stringify({ seq: i }));
      await echoed; // round-trip : chaque envoi attend son echo (ordre garanti)
      rtts.push(performance.now() - t0);
    }
    ws.terminate();

    expect(rtts.length, "lossless — toutes les frames ont répondu").to.equal(N);
    rtts.sort((a, b) => a - b);
    const p50 = percentile(rtts, 50);
    const p95 = percentile(rtts, 95);
    const p99 = percentile(rtts, 99);
    console.log(
      `WS RTT (n=${N}) — p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms ` +
        `p99=${p99.toFixed(2)}ms max=${rtts[N - 1].toFixed(2)}ms`,
    );
    // Loopback ≪ 100 ms : borne généreuse anti-régression pathologique, CI-stable.
    expect(p99, "p99 sous une borne saine").to.be.lessThan(100);
  }, 30_000);
});
