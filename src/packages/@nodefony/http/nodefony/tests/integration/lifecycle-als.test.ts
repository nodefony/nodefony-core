/// <reference types="node" />
/**
 * Context lifecycle guard for the ALS fix (BUG-001/BUG-002).
 *
 * The AsyncResource.bind() wraps must NOT alter the deterministic tear-down:
 *   - the WS after-response hook fires exactly once per connection
 *     (onFinish dedup — guarded by `once` + `finished` + `_afterResponseFired`);
 *   - leaveScope()/clean() still run on every close (no scope/context leak);
 *   - no EventEmitter listener accumulation.
 *
 * Covers part of P2.2 (deterministic tear-down) and P4.3 (context-leak tests).
 *
 * Live server: wss://localhost:5152 + 127.0.0.1:5152 (HTTPS).
 * Routes: src/modules/test/.../AlsController.ts (prefix /nodefony/test/als-test)
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import "mocha";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

type Json = Record<string, unknown>;

function get(path: string): Promise<Json> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { hostname: "127.0.0.1", port: 5152, method: "GET", path, rejectUnauthorized: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()) as Json);
          } catch {
            resolve({});
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Open /ws/after, exchange one message, close cleanly. */
function cycleWsAfter(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WSS}/nodefony/test/als-test/ws/after`, wsOpts);
    ws.once("message", () => {
      ws.send("x");
      setTimeout(() => ws.close(), 5);
    });
    ws.once("close", () => resolve());
    ws.once("error", reject);
  });
}

async function serverHeap(): Promise<number> {
  return (await get("/nodefony/test/memory")).heapUsed as number;
}

describe("Context lifecycle — ALS tear-down (BUG-001/002)", function () {
  this.timeout(60_000);

  beforeEach(async () => {
    await get("/nodefony/test/als-test/reset");
    await wait(30);
  });

  it("WS after-response hook fires exactly once per connection (onFinish dedup)", async () => {
    await cycleWsAfter();
    await wait(120);
    const s = await get("/nodefony/test/als-test/state");
    expect(s.wsHookFireCount, "exactly one tear-down fire").to.equal(1);
    expect(s.wsHookRequestId).to.equal(s.wsHookHandshakeId);
    expect(s.wsHookRequestId, "ALS restored at tear-down").to.be.a("string");
  });

  it("each of 5 sequential connections tears down exactly once (no double finish/close)", async () => {
    for (let i = 0; i < 5; i++) await cycleWsAfter();
    await wait(150);
    const s = await get("/nodefony/test/als-test/state");
    expect(s.wsHookFireCount, "5 connections => 5 fires, never doubled").to.equal(5);
  });

  it("150 WS connections open/msg/close — leaveScope+clean run, heap delta < 20 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 150; i++) await cycleWsAfter();
    await wait(200);
    const after = await serverHeap();
    const deltaMb = (after - before) / 1024 / 1024;
    // Leaked scopes/contexts would grow the heap unbounded.
    expect(after - before).to.be.below(
      20 * 1024 * 1024,
      `heap grew ${deltaMb.toFixed(1)} MB — clean()/leaveScope must run on every close`,
    );
    // Server still healthy after the load.
    const s = await get("/nodefony/test/als-test/state");
    expect(s.wsHookFireCount).to.equal(150);
  });
});
