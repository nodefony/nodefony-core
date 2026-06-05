/// <reference types="node" />
/**
 * LOAD / STRESS — Axis 1: WebSocket CONNECTION count (how many simultaneous
 * sockets a single process holds), distinct from message throughput (axis 2,
 * see ws-messages-load.test.ts).
 *
 * Excluded from non-regression — run via `vitest.load.config.ts` (npm run test:load).
 * Live server: wss://localhost:5152.
 *
 * The CI-stable case opens a bounded fleet of concurrent connections and
 * asserts every one reaches the handshake and tears down with no scope leak.
 * The unbounded rupture probe (find the ceiling) is gated behind
 *   RUN_WS_RUPTURE=1
 * because it intentionally exhausts loopback ephemeral ports (~16k) and is
 * disruptive to the host machine.
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

const WSS = "wss://localhost:5152";
const ECHO = `${WSS}/nodefony/test/ws/echo`;
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

const serverHeap = async () =>
  (await getJson("/nodefony/test/memory")).heapUsed as number;
const scopes = async () =>
  (await getJson("/nodefony/test/als-test/scopes")).requestScopes as number;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Server-side scope release lags the client "close" event (the kernel runs
// leaveScope when IT processes the close). Poll for eventual drain — a real
// leak never drains, mere lag drains within a couple of seconds. Returns the
// last observed delta vs `base`.
async function drainTo(
  base: number,
  target = 5,
  timeoutMs = 8000,
): Promise<number> {
  const t0 = Date.now();
  let delta = (await scopes()) - base;
  while (delta >= target && Date.now() - t0 < timeoutMs) {
    await wait(200);
    delta = (await scopes()) - base;
  }
  return delta;
}

// Every socket ever created is tracked so a mid-test failure can't leave open
// connections that poison the next test's scope baseline. afterEach reaps them.
const tracked = new Set<WebSocket>();
function track(ws: WebSocket): WebSocket {
  tracked.add(ws);
  ws.once("close", () => tracked.delete(ws));
  return ws;
}

/** Opens one WS, resolves once the handshake frame is received. */
function openHandshaked(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = track(new WebSocket(ECHO, wsOpts));
    const onErr = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onMsg = () => {
      cleanup();
      resolve(ws);
    };
    const cleanup = () => {
      ws.removeListener("error", onErr);
      ws.removeListener("message", onMsg);
    };
    ws.once("error", onErr);
    ws.once("message", onMsg); // echo route replies {handshake:true} on connect
  });
}

// Open `n` sockets in bounded batches — a single Promise.all of hundreds of
// concurrent loopback TLS connects throws AggregateError (dual-stack
// internalConnectMultiple). Batching is the realistic client behaviour anyway.
async function openFleet(n: number, batch = 50): Promise<WebSocket[]> {
  const out: WebSocket[] = [];
  while (out.length < n) {
    const size = Math.min(batch, n - out.length);
    const opened = await Promise.all(
      Array.from({ length: size }, () => openHandshaked()),
    );
    out.push(...opened);
    await wait(15);
  }
  return out;
}

function closeAll(sockets: WebSocket[]): Promise<void> {
  return new Promise((resolve) => {
    let pending = sockets.length;
    if (pending === 0) return resolve();
    for (const ws of sockets) {
      const done = () => {
        if (--pending === 0) resolve();
      };
      if (ws.readyState === WebSocket.CLOSED) {
        done();
        continue;
      }
      ws.once("close", done);
      try {
        ws.close();
      } catch {
        done();
      }
    }
    setTimeout(resolve, 5000); // hard backstop
  });
}

describe("LOAD — WS connections (axis 1: count)", function () {
  // Reap any socket a failing test left open, so it can't poison the next
  // test's scope baseline (a thrown Promise.all leaves its peers dangling).
  afterEach(async () => {
    if (tracked.size === 0) return;
    for (const ws of tracked) {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }
    tracked.clear();
    await wait(400);
  });

  it("500 concurrent connections — all handshake, heap delta < 60 MB", async () => {
    const FLEET = 500;
    const heapBefore = await serverHeap();
    const scopesBefore = await scopes();

    const sockets = await openFleet(FLEET);
    expect(sockets).to.have.length(FLEET);
    const open = sockets.filter((w) => w.readyState === WebSocket.OPEN).length;
    expect(open, "every connection is OPEN at peak").to.equal(FLEET);

    const heapPeak = await serverHeap();
    const deltaMb = (heapPeak - heapBefore) / 1024 / 1024;
    expect(heapPeak - heapBefore).to.be.below(
      60 * 1024 * 1024,
      `heap grew ${deltaMb.toFixed(1)} MB holding ${FLEET} sockets`,
    );

    await closeAll(sockets);
    expect(
      await drainTo(scopesBefore),
      "all WS scopes released after close",
    ).to.be.below(5);
  });

  it("churn — 5×200 open/close cycles leak zero scopes", async () => {
    const before = await scopes();
    for (let cycle = 0; cycle < 5; cycle++) {
      const batch = await openFleet(200);
      await closeAll(batch);
    }
    expect(
      await drainTo(before),
      "churn must not accumulate scopes",
    ).to.be.below(5);
  });

  // Unbounded ceiling probe — disruptive (eats loopback ephemeral ports).
  const rupture = process.env.RUN_WS_RUPTURE === "1" ? it : it.skip;
  rupture(
    "RUPTURE — ramp connections until the first failure (reports ceiling)",
    async function () {
      // Default cap stays under the loopback ephemeral-port limit so a stray run is
      // bounded; raise WS_RUPTURE_CAP (e.g. 20000) to reach the *real* ceiling
      // (~16k on loopback = 49152–65535 port range). Validated 2026-05-21: 16372.
      const CAP = Number(process.env.WS_RUPTURE_CAP ?? 8000);
      const STEP = Number(process.env.WS_RUPTURE_STEP ?? 1000);
      // Sub-batch the ramp: a single Promise.allSettled of hundreds of concurrent
      // loopback TLS connects fails on the CLIENT (dual-stack internalConnectMultiple)
      // — that under-reports the server ceiling (measured 4741 vs the real 16372).
      // Open in small chunks like a real client to read true server capacity.
      const BATCH = 50;
      const live: WebSocket[] = [];
      let ceiling = 0;
      try {
        while (live.length < CAP) {
          const want = Math.min(STEP, CAP - live.length);
          let openedInStep = 0;
          for (let i = 0; i < want; i += BATCH) {
            const size = Math.min(BATCH, want - i);
            const res = await Promise.allSettled(
              Array.from({ length: size }, () => openHandshaked()),
            );
            for (const r of res) {
              if (r.status === "fulfilled") {
                live.push(r.value);
                openedInStep++;
              }
            }
            await wait(10);
          }
          ceiling = live.length;
          if (openedInStep < want) break; // a full step couldn't open = real ceiling
        }
      } finally {
        // eslint-disable-next-line no-console
        console.log(
          `\n      ▶ WS connection ceiling reached: ${ceiling} simultaneous sockets`,
        );
        await closeAll(live);
        await wait(1000);
      }
      expect(
        ceiling,
        "should sustain at least a few hundred connections",
      ).to.be.above(300);
    },
  );
});
