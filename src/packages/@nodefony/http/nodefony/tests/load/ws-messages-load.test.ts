/// <reference types="node" />
/**
 * LOAD / STRESS — Axis 2: WebSocket MESSAGE throughput / broadcast fan-out
 * (how hard the pipeline can be hammered with frames), distinct from the
 * connection-count ceiling (axis 1, see ws-connections-load.test.ts).
 *
 * Excluded from non-regression — run via `vitest.load.config.ts` (npm run test:load).
 * Live server: wss://localhost:5152.
 *
 * Routes:
 *   /nodefony/test/ws/echo       — replies to each frame (throughput probe)
 *   /nodefony/test/ws/broadcast  — fans the frame out to every client (incl. sender)
 *
 * CI-stable cases assert lossless delivery + a sane throughput floor. The
 * unbounded "until it breaks" flood is gated behind NF_RUN_WS_RUPTURE=1.
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import {
  THRESHOLDS,
  retention,
  serverHeap,
  setSyslogRing,
} from "../helpers/retention.js";

const WSS = "wss://localhost:5152";
const ECHO = `${WSS}/nodefony/test/ws/echo`;
const BROADCAST = `${WSS}/nodefony/test/ws/broadcast`;
const wsOpts = { rejectUnauthorized: false };

function getJson(path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        hostname: "localhost",
        port: 5152,
        path,
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

/** Opens a WS and resolves once the handshake frame is consumed. */
function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, wsOpts);
    ws.once("error", reject);
    ws.once("message", () => resolve(ws)); // handshake frame
  });
}

describe("LOAD — WS messages (axis 2: throughput + broadcast)", function () {
  it("echo flood — 5000 frames on one socket, every frame replied, > 1000 msg/s", async () => {
    const TOTAL = 5000;
    const ws = await open(ECHO);
    let received = 0;
    const t0 = Date.now();
    await new Promise<void>((resolve, reject) => {
      ws.on("message", () => {
        if (++received >= TOTAL) resolve();
      });
      ws.on("error", reject);
      for (let i = 0; i < TOTAL; i++) ws.send(`f-${i}`);
    });
    const rate = (TOTAL / (Date.now() - t0)) * 1000;
    ws.close();
    expect(received, "every echoed frame received (no drop)").to.equal(TOTAL);
    expect(rate, `throughput ${rate.toFixed(0)} msg/s`).to.be.above(1000);
  });

  it("broadcast fan-out — 20 clients, 50 broadcasts → 1000 deliveries each, lossless", async () => {
    const CLIENTS = 20;
    const BURSTS = 50;
    const clients = await Promise.all(
      Array.from({ length: CLIENTS }, () => open(BROADCAST)),
    );
    const counts = new Array(CLIENTS).fill(0);
    const expected = CLIENTS * BURSTS; // each client receives every broadcast (incl. own)

    const allDone = new Promise<void>((resolve) => {
      let totalDeliveries = 0;
      clients.forEach((ws, idx) => {
        ws.on("message", () => {
          counts[idx]++;
          if (++totalDeliveries >= CLIENTS * expected) resolve();
        });
      });
      // safety timeout — resolve and let assertions report the shortfall
      setTimeout(resolve, 30_000);
    });

    // one sender emits BURSTS frames; the route fans each out to all clients,
    // and all CLIENTS senders do the same → CLIENTS*BURSTS frames per client.
    for (const ws of clients) {
      for (let b = 0; b < BURSTS; b++) ws.send(`bc-${b}`);
    }
    await allDone;
    for (const ws of clients) ws.close();

    const min = Math.min(...counts);
    expect(min, `slowest client got ${min}/${expected} broadcasts`).to.equal(
      expected,
    );
  });

  it("sustained — 10 sockets echoing frames: retains nothing per frame", async () => {
    // Les sockets restent OUVERTES pendant toute la mesure : on mesure ce que
    // le serveur garde par TRAME, pas par connexion (cf ws-connections-load).
    // Une itération = 20 trames par socket, soit 200 trames (`unit`).
    const SOCKETS = 10;
    const PER_ROUND = 20;
    await setSyslogRing(false);
    const sockets = await Promise.all(
      Array.from({ length: SOCKETS }, () => open(ECHO)),
    );
    const round = () =>
      Promise.all(
        sockets.map(
          (ws) =>
            new Promise<void>((resolve, reject) => {
              let got = 0;
              const onMessage = () => {
                if (++got >= PER_ROUND) {
                  ws.removeListener("message", onMessage);
                  ws.removeListener("error", reject);
                  resolve();
                }
              };
              ws.on("message", onMessage);
              ws.once("error", reject);
              for (let i = 0; i < PER_ROUND; i++) ws.send(`x-${i}`);
            }),
        ),
      );
    try {
      const assertRetention = await retention(
        "sustained — 10 sockets echoing frames",
        {
          probe: serverHeap,
          act: async () => {
            await round();
          },
          warmup: 10,
          batch: 10,
          batches: 6,
          unit: SOCKETS * PER_ROUND,
        },
        THRESHOLDS.wsFrame,
      );
      assertRetention();
    } finally {
      for (const ws of sockets) ws.close();
      await setSyslogRing(true);
    }
  });

  // Unbounded message flood — find where delivery starts to drop / lag.
  const rupture = process.env.NF_RUN_WS_RUPTURE === "1" ? it : it.skip;
  rupture(
    "RUPTURE — escalate frame bursts until loss/latency blows up",
    async function () {
      const ws = await open(ECHO);
      let lastGoodRate = 0;
      let brokeAt = 0;
      for (const burst of [1_000, 5_000, 20_000, 50_000, 100_000, 200_000]) {
        let received = 0;
        const t0 = Date.now();
        const ok = await new Promise<boolean>((resolve) => {
          const onMsg = () => {
            if (++received >= burst) {
              ws.removeListener("message", onMsg);
              resolve(true);
            }
          };
          ws.on("message", onMsg);
          for (let i = 0; i < burst; i++) ws.send(`r-${i}`);
          setTimeout(() => {
            ws.removeListener("message", onMsg);
            resolve(received >= burst);
          }, 60_000);
        });
        const rate = (received / (Date.now() - t0)) * 1000;
        // eslint-disable-next-line no-console
        console.log(
          `      ▶ burst ${burst}: ${received} received @ ${rate.toFixed(0)} msg/s ${ok ? "" : "(SHORTFALL)"}`,
        );
        if (!ok) {
          brokeAt = burst;
          break;
        }
        lastGoodRate = rate;
      }
      ws.close();
      // eslint-disable-next-line no-console
      console.log(
        `      ▶ last clean rate: ${lastGoodRate.toFixed(0)} msg/s${brokeAt ? `, shortfall at burst ${brokeAt}` : " (no shortfall up to cap)"}`,
      );
      expect(
        lastGoodRate,
        "should sustain a meaningful rate before breaking",
      ).to.be.above(1000);
    },
  );
});
