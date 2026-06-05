/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

// P2.5 — request timeout integrated with the Nodefony pipeline + AbortSignal.
//
// /timeout/probe re-arms a short socket idle timeout (250ms) for that request
// then hangs. When it fires, the Nodefony onTimeout pipeline runs:
//   onTimeout → _abortIfPending (aborts ctx.signal) → onError → 408 rendered.
// We assert BOTH halves:
//   1. the client receives a coherent 408 (pipeline / errorRenderer);
//   2. ctx.signal aborted server-side (in-flight work cancellation).
// Plain HTTP (5151) → HTTP/1.1 → 408 (the HTTP/2 stream path yields 504).

const HOST = "localhost";
const PORT = 5151;

function get(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: HOST, port: PORT, path, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function getJson(path: string): Promise<{ status: number; body: any }> {
  return get(path).then(({ status, body }) => {
    try {
      return { status, body: JSON.parse(body) };
    } catch {
      return { status, body };
    }
  });
}

describe("Request timeout → pipeline 408 + AbortSignal — P2.5 (requires server)", () => {
  beforeAll(async () => {
    await getJson("/nodefony/test/timeout/reset");
  });

  it("a timed-out request returns 408 AND aborts ctx.signal", async () => {
    const res = await get("/nodefony/test/timeout/probe");
    expect(res.status).to.equal(408);

    // The signal listener ran server-side (in-flight work was cancelled).
    await new Promise((r) => setTimeout(r, 200));
    const state = await getJson("/nodefony/test/timeout/state");
    expect(state.status).to.equal(200);
    expect(state.body.signalAbortedCount).to.be.at.least(1);
    expect(state.body.lastReason).to.match(/timeout/i);
  });

  it("the server stays healthy after a timeout", async () => {
    const health = await getJson("/nodefony/test/index");
    expect(health.status).to.equal(200);
  });
});
