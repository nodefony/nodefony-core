/// <reference types="node" />
/**
 * P1.3 — Context.signal (AbortSignal).
 *
 * Validates that `context.signal` aborts when the client disconnects before
 * the response is sent. Lazy alloc: no overhead if `signal` is never read.
 *
 * Live server: 127.0.0.1:5152 (HTTPS).
 *
 * Routes (DefaultController):
 *   GET /nodefony/test/abort/wait   — waits 2 s, resolves early on abort
 *   GET /nodefony/test/abort/state  — returns { abortedCount, completedCount, lastAbortReason }
 *   GET /nodefony/test/abort/reset  — resets counters
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function get(
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
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

// Sends a request and destroys the socket after `abortAfterMs`.
// Resolves once the socket is closed; ignores any client-side error.
function getAndAbort(path: string, abortAfterMs: number): Promise<void> {
  return new Promise((resolve) => {
    const r = https.request({ ...BASE, method: "GET", path }, (_res) => {
      // ignore — we abort before headers
    });
    r.on("error", () => {});
    r.end();
    setTimeout(() => {
      r.destroy();
      resolve();
    }, abortAfterMs);
  });
}

async function readState(): Promise<{
  abortedCount: number;
  completedCount: number;
  lastAbortReason: string;
}> {
  const r = await get("/nodefony/test/abort/state");
  return r.body as {
    abortedCount: number;
    completedCount: number;
    lastAbortReason: string;
  };
}

async function reset(): Promise<void> {
  await get("/nodefony/test/abort/reset");
}

describe("P1.3 — Context.signal (AbortSignal)", () => {
  beforeEach(async () => {
    await reset();
    await wait(30);
  });

  it("client abort before response → server observes signal.aborted", async () => {
    const before = await readState();
    await getAndAbort("/nodefony/test/abort/wait", 150);
    // Give the server a moment to observe the close and run the abort callback.
    await wait(200);
    const after = await readState();
    expect(after.abortedCount - before.abortedCount).to.equal(
      1,
      "abortedCount must increment by 1",
    );
    expect(after.completedCount - before.completedCount).to.equal(
      0,
      "completedCount must NOT increment",
    );
  });

  it("normal completion → completedCount increments, abortedCount does not", async function () {
    const before = await readState();
    const r = await get("/nodefony/test/abort/wait");
    expect(r.status).to.equal(200);
    expect(r.body.aborted).to.equal(false);
    await wait(50);
    const after = await readState();
    expect(after.completedCount - before.completedCount).to.equal(1);
    expect(after.abortedCount - before.abortedCount).to.equal(0);
  });

  it("abort reason is propagated to signal.reason", async () => {
    await getAndAbort("/nodefony/test/abort/wait", 100);
    await wait(200);
    const s = await readState();
    expect(s.lastAbortReason).to.match(
      /aborted|closed/i,
      `unexpected reason: "${s.lastAbortReason}"`,
    );
  });

  it("multiple sequential aborts each increment the counter", async function () {
    for (let i = 0; i < 3; i++) {
      await getAndAbort("/nodefony/test/abort/wait", 80);
      await wait(150);
    }
    const s = await readState();
    expect(s.abortedCount).to.equal(3);
  });

  it("regression: requests that never read context.signal still succeed (lazy alloc)", async () => {
    // /index never reads signal — verifies no breakage from lazy init.
    const r = await get("/nodefony/test/index");
    expect(r.status).to.equal(200);
  });
});
