/// <reference types="node" />
/**
 * Context lifecycle guard for the ALS fix (BUG-001/002/003) — FAST checks only.
 *
 * The AsyncResource.bind() wraps + the BUG-003 fix must NOT alter the
 * deterministic tear-down:
 *   - the WS after-response hook fires exactly once per connection
 *     (onFinish dedup — guarded by `once` + `finished` + `_afterResponseFired`);
 *   - leaveScope()/clean() run on every close, success OR error (no scope leak).
 *
 * Heavy load versions (100s of connections, heap deltas) live in
 * tests/load/als-load.test.ts. Covers part of P2.2 + P4.3.
 *
 * Live server: wss://localhost:5152 + 127.0.0.1:5152 (HTTPS).
 * Routes: src/modules/test/.../AlsController.ts (prefix /nodefony/test/als-test)
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

type Json = Record<string, unknown>;

function get(path: string): Promise<Json> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        hostname: "127.0.0.1",
        port: 5152,
        method: "GET",
        path,
        rejectUnauthorized: false,
      },
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

/** Open a WS that errors before connect() (404 / 1002), then close. */
function badWs(path: string): Promise<void> {
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

/** Open a session-bearing WS (/ws does startSession) and close at handshake. */
function openCloseSessionWs(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WSS}/nodefony/test/ws`, wsOpts);
    ws.once("open", () => ws.close());
    ws.once("close", () => resolve());
    ws.once("error", reject);
  });
}

const liveScopes = async () =>
  (await get("/nodefony/test/als-test/scopes")).requestScopes as number;

describe("Context lifecycle — ALS tear-down (BUG-001/002)", function () {
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
    expect(
      s.wsHookFireCount,
      "5 connections => 5 fires, never doubled",
    ).to.equal(5);
  });

  it("BUG-003 — WS errors before connect() (404 + 1002) leak no request scope", async () => {
    // Delta around our own loop — robust to ambient scopes left by other suites.
    // Without the fix this grew by 30 (1 leaked scope per error).
    const before = await liveScopes();
    for (let i = 0; i < 15; i++) await badWs("/nodefony/test/als-test/nope");
    for (let i = 0; i < 15; i++) await badWs("/nodefony/test/ws/echo/proto");
    await wait(150);
    expect(
      (await liveScopes()) - before,
      "error path must release every scope",
    ).to.be.below(3);
  });

  it("valid session-less WS connections leave no residual scope", async () => {
    const before = await liveScopes();
    for (let i = 0; i < 10; i++) await cycleWsAfter();
    await wait(120);
    expect((await liveScopes()) - before).to.be.below(3);
  });

  it("BUG-004 — session-bearing WS closed at handshake (no message) leaks no scope", async () => {
    // /ws calls startSession() in initialize. Closing before any message used
    // to strand the scope on a never-fired once("onSaveSession").
    const before = await liveScopes();
    for (let i = 0; i < 20; i++) await openCloseSessionWs();
    await wait(200);
    expect(
      (await liveScopes()) - before,
      "session WS teardown must release scope",
    ).to.be.below(3);
  });
});
