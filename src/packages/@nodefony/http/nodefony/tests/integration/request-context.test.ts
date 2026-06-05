/// <reference types="node" />
/**
 * P1.4 — RequestContext (AsyncLocalStorage).
 *
 * Validates that `RequestContext.getRequestId()` returns the same value as
 * `context.requestId` and survives across `await` boundaries, AND that two
 * concurrent requests are properly isolated (no cross-talk).
 *
 * Live server: 127.0.0.1:5152 (HTTPS).
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };

function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { ...BASE, method: "GET", path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          try {
            resolve({
              status: res.statusCode!,
              body: raw ? JSON.parse(raw) : {},
              headers: res.headers as Record<
                string,
                string | string[] | undefined
              >,
            });
          } catch {
            resolve({ status: res.statusCode!, body: { raw }, headers: {} });
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

describe("P1.4 — RequestContext (AsyncLocalStorage)", () => {
  it("ALS requestId matches context.requestId in the controller", async () => {
    const r = await get("/nodefony/test/als/now");
    expect(r.status).to.equal(200);
    expect(r.body.requestId).to.be.a("string");
    expect(r.body.requestId).to.equal(r.body.contextRequestId);
  });

  it("ALS requestId matches the X-Request-Id response header", async () => {
    const r = await get("/nodefony/test/als/now");
    expect(r.body.requestId).to.equal(r.headers["x-request-id"]);
  });

  it("X-Request-Id propagation: client header is honored by the kernel AND visible via ALS", async () => {
    const custom = "p14-custom-req-id-xyz";
    const r = await get("/nodefony/test/als/now", { "x-request-id": custom });
    expect(r.body.requestId).to.equal(custom);
    expect(r.body.contextRequestId).to.equal(custom);
    expect(r.headers["x-request-id"]).to.equal(custom);
  });

  it("ALS scheme is set to the current transport ('https' here)", async () => {
    const r = await get("/nodefony/test/als/now");
    expect(r.body.scheme).to.equal("https");
  });

  it("ALS state survives an async hop (await setTimeout)", async () => {
    const r = await get("/nodefony/test/als/async");
    expect(r.status).to.equal(200);
    expect(r.body.sameAcrossAwait).to.equal(true);
    expect(r.body.beforeAwait).to.equal(r.body.afterAwait);
    expect(r.body.beforeAwait).to.equal(r.body.contextRequestId);
  });

  it("isolation: 100 concurrent requests each see their own requestId", async () => {
    const N = 100;
    const results = await Promise.all(
      Array.from({ length: N }, () => get("/nodefony/test/als/async")),
    );
    // All requests must succeed
    results.forEach((r) => expect(r.status).to.equal(200));
    // All ids unique (no cross-talk in ALS)
    const ids = results.map((r) => r.body.afterAwait as string);
    expect(new Set(ids).size).to.equal(N, `expected ${N} distinct requestIds`);
    // For each request, before == after (preserved through await)
    results.forEach((r) => {
      expect(r.body.sameAcrossAwait).to.equal(true);
      expect(r.body.beforeAwait).to.equal(r.body.contextRequestId);
    });
  });
});
