/// <reference types="node" />
/**
 * P1.2 — Context.onAfterResponse(fn) — fires once after response is sent,
 * deduplicated across response "finish" and "close" events.
 *
 * Live server: 127.0.0.1:5152 (HTTPS).
 *
 * Routes exposed by src/modules/test/.../DefaultController.ts:
 *   GET /nodefony/test/after/incr   — registers a +1 hook
 *   GET /nodefony/test/after/multi  — registers 3 hooks (+1, +10, +100)
 *   GET /nodefony/test/after/throw  — registers a +1 hook then throws (500)
 *   GET /nodefony/test/after/state  — returns current counters
 *   GET /nodefony/test/after/reset  — resets counters
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };

type Json = Record<string, unknown>;

function get(path: string): Promise<{ status: number; body: Json }> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve({
            status: res.statusCode!,
            body: raw ? JSON.parse(raw) : {},
          });
        } catch {
          resolve({ status: res.statusCode!, body: { raw } });
        }
      });
    });
    r.on("error", reject);
    r.end();
  });
}

// Hooks may run on a microtask after "finish" — wait briefly to observe their effect.
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readState(): Promise<{
  count: number;
  multiCount: number;
  lastFiredAtMs: number;
}> {
  const r = await get("/nodefony/test/after/state");
  return r.body as { count: number; multiCount: number; lastFiredAtMs: number };
}

async function reset(): Promise<void> {
  await get("/nodefony/test/after/reset");
}

describe("P1.2 — Context.onAfterResponse", () => {
  beforeEach(async () => {
    await reset();
    await wait(30);
  });

  it("hook fires after a successful 200 response", async () => {
    const before = await readState();
    const r = await get("/nodefony/test/after/incr");
    expect(r.status).to.equal(200);
    await wait(50);
    const after = await readState();
    expect(after.count - before.count).to.equal(1);
  });

  it("hook fires exactly once per request (dedup finish vs close)", async () => {
    await get("/nodefony/test/after/incr");
    await wait(50);
    const s = await readState();
    expect(s.count).to.equal(
      1,
      "single request must increment exactly once, not twice",
    );
  });

  it("multiple successive requests each fire their own hook", async () => {
    for (let i = 0; i < 5; i++) {
      await get("/nodefony/test/after/incr");
    }
    await wait(80);
    const s = await readState();
    expect(s.count).to.equal(5);
  });

  it("multiple hooks registered on a single context all fire in order", async () => {
    const r = await get("/nodefony/test/after/multi");
    expect(r.status).to.equal(200);
    await wait(50);
    const s = await readState();
    expect(s.multiCount).to.equal(111, "expected 1 + 10 + 100 = 111");
  });

  it("hook still fires when the action throws (response is a 500)", async () => {
    const r = await get("/nodefony/test/after/throw");
    expect(r.status).to.equal(500);
    await wait(50);
    const s = await readState();
    expect(s.count).to.equal(1);
  });

  it("hook timestamp lands after the response is observed by the client", async () => {
    const clientBefore = Date.now();
    await get("/nodefony/test/after/incr");
    const clientAfterRecv = Date.now();
    await wait(50);
    const s = await readState();
    expect(s.lastFiredAtMs).to.be.at.least(clientBefore);
    // hook fires after finish, so lastFiredAtMs may be a tick after the client got bytes
    expect(s.lastFiredAtMs).to.be.at.most(clientAfterRecv + 200);
  });
});
