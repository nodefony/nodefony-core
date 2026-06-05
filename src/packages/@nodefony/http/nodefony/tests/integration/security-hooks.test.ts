/// <reference types="node" />
/**
 * P1.7 — Security hooks (beforeResolve, afterAuth, onAuthFailure).
 *
 * Hooks fired by HttpKernel at well-defined points of the request pipeline so
 * `@nodefony/security` (Phase 6) and other auth modules can plug in without
 * the http module depending on them.
 *
 * The Test module registers listeners in its onKernelReady() and increments
 * shared counters. We probe via /nodefony/test/hooks/state and /nodefony/test/hooks/reset.
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

type HooksState = {
  beforeResolveCount: number;
  afterAuthCount: number;
  onAuthFailureCount: number;
  lastAuthFailureReason: string;
  lastHook: string;
};

async function readState(): Promise<HooksState> {
  const r = await get("/nodefony/test/hooks/state");
  return r.body as HooksState;
}

async function reset(): Promise<void> {
  await get("/nodefony/test/hooks/reset");
}

describe("P1.7 — HttpKernel security hooks", () => {
  beforeEach(async () => {
    await reset();
    await wait(20);
  });

  it("beforeResolve fires for every successful request", async () => {
    const before = await readState();
    await get("/nodefony/test/index");
    await wait(30);
    const after = await readState();
    // /nodefony/test/hooks/reset and /nodefony/test/hooks/state and /index each fire beforeResolve.
    // We started counting AFTER reset, so before=already 1 (the reset hit).
    // Be tolerant: just verify the increment is at least 2 (index + state read).
    expect(after.beforeResolveCount - before.beforeResolveCount).to.be.at.least(
      2,
    );
  });

  it("beforeResolve fires before route resolution (even for 404)", async () => {
    const before = await readState();
    await get("/nodefony/test/no-such-route-xyz");
    await wait(30);
    const after = await readState();
    // 404 went through beforeResolve before routing failed → counter incremented.
    expect(after.beforeResolveCount).to.be.greaterThan(
      before.beforeResolveCount,
    );
  });

  it("afterAuthCount never exceeds beforeResolveCount", async () => {
    // beforeResolve fires for EVERY request; afterAuth only when firewall ran
    // and succeeded. Invariant: count(afterAuth) <= count(beforeResolve).
    await get("/nodefony/test/index");
    await wait(30);
    const s = await readState();
    expect(s.afterAuthCount).to.be.at.most(s.beforeResolveCount);
  });

  it("onAuthFailure does NOT fire when no auth error occurs", async () => {
    const before = await readState();
    await get("/nodefony/test/index");
    await wait(30);
    const after = await readState();
    expect(after.onAuthFailureCount).to.equal(before.onAuthFailureCount);
  });

  it("lastHook is one of the registered hooks after any request", async () => {
    // App config may make some routes secure (afterAuth fires) and others not
    // (only beforeResolve fires). Both are valid — verify we observed *some* hook.
    await get("/nodefony/test/index");
    await wait(30);
    const s = await readState();
    expect(["beforeResolve", "afterAuth", "onAuthFailure"]).to.include(
      s.lastHook,
    );
  });

  it("multiple sequential requests each fire beforeResolve", async () => {
    const before = await readState();
    for (let i = 0; i < 5; i++) {
      await get("/nodefony/test/index");
    }
    await wait(50);
    const after = await readState();
    // 5 index + 1 state read = +6 minimum.
    expect(after.beforeResolveCount - before.beforeResolveCount).to.be.at.least(
      6,
    );
  });
});
