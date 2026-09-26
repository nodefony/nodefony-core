/// <reference types="node" />
/**
 * LOAD / STRESS tests for the ALS fix + WS lifecycle (BUG-001/002/003).
 *
 * Excluded from the default non-regression run (heavy network loops) — run via
 * `vitest.load.config.ts` (npm run test:load). Keep functional assertions in tests/integration/.
 *
 * Live server: wss://localhost:5152 + 127.0.0.1:5152 (HTTPS).
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import { drainTo } from "../helpers/scopeDrain.js";
import {
  THRESHOLDS,
  retention,
  serverHeap,
  setSyslogRing,
} from "../helpers/retention.js";
import { asError } from "../helpers/wsText";

const WSS = "wss://localhost:5152";
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
            reject(asError(e));
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

const scopes = async () =>
  (await getJson("/nodefony/test/als-test/scopes")).requestScopes as number;

/**
 * Asserte que la boucle n'a laissé AUCUN scope `request` ouvert : sondage
 * borné jusqu'au drainage (`drainTo`), jamais un délai fixe — un délai mesure
 * la machine, et la tolérance « < 5 » qu'il imposait laissait passer quatre
 * scopes épinglés par boucle.
 */
async function scopesDrained(what: string, before: number): Promise<void> {
  const delta = await drainTo(scopes, before, 1);
  expect(
    delta,
    `${what} : ${delta} scope(s) « request » jamais refermé(s)`,
  ).to.be.at.most(0);
}

function wsExchange(path: string, messages: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WSS}${path}`, wsOpts);
    let sent = 0;
    ws.on("message", () => {
      if (sent < messages.length) ws.send(messages[sent++]);
      else ws.close();
    });
    ws.once("close", () => resolve());
    ws.once("error", reject);
  });
}

function wsBadClose(path: string): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WSS}${path}`, wsOpts);
    let done = false;
    const fin = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    ws.on("open", () =>
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        fin();
      }, 3),
    );
    ws.on("close", fin);
    ws.on("unexpected-response", fin);
    ws.on("error", fin);
    setTimeout(fin, 400);
  });
}

describe("LOAD — ALS WebSocket lifecycle", function () {
  // Ring du syslog coupé pendant les mesures de rétention (`setSyslogRing`).
  beforeAll(() => setSyslogRing(false));
  afterAll(() => setSyslogRing(true));

  it("BUG-001 — WS connections × 10 messages: retains nothing per connection", async () => {
    const batch = Array.from({ length: 10 }, (_, i) => `msg-${i}`);
    const assertRetention = await retention(
      "BUG-001 — WS connections × 10 messages",
      {
        probe: serverHeap,
        act: () => wsExchange("/nodefony/test/als-test/ws", batch),
        warmup: 100,
        batch: 30,
        batches: 6,
      },
      THRESHOLDS.alsMessages,
    );
    assertRetention();
  });

  it("lifecycle — WS connections open/msg/close: retains nothing per connection + scopes drained", async () => {
    const scopesBefore = await scopes();
    const assertRetention = await retention(
      "lifecycle — WS connections open/msg/close",
      {
        probe: serverHeap,
        act: () => wsExchange("/nodefony/test/als-test/ws/after", ["x"]),
        warmup: 100,
        batch: 40,
        batches: 6,
      },
      THRESHOLDS.alsLifecycle,
    );
    await scopesDrained("lifecycle", scopesBefore);
    assertRetention();
  });

  it("BUG-003 — 500 WS errors (404 + 1002) leak zero request scopes", async () => {
    const before = await scopes();
    for (let i = 0; i < 250; i++)
      await wsBadClose("/nodefony/test/als-test/nope");
    for (let i = 0; i < 250; i++)
      await wsBadClose("/nodefony/test/ws/echo/proto");
    await scopesDrained("BUG-003 — error path", before);
  });

  it("BUG-004 — 300 session-bearing WS closed at handshake leak zero scope", async () => {
    const before = await scopes();
    for (let i = 0; i < 300; i++) {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${WSS}/nodefony/test/ws`, wsOpts);
        ws.once("open", () => ws.close());
        ws.once("close", () => resolve());
        ws.once("error", reject);
      });
    }
    await scopesDrained("BUG-004 — session WS teardown", before);
  });
});
