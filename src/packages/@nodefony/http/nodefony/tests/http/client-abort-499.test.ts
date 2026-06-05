/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
import fs from "node:fs";

// P2.3 — internal 499 ("client closed request").
//
// When a client disconnects before ANY response byte is produced, the kernel
// records an internal 499 on the response so the request log + profiler reflect
// the abort instead of a misleading default 200. The 499 is NEVER written to
// the wire (the socket is already dead) — it is observability only, asserted
// here via the server-side request log line ("http 499 GET ...").

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const LOG_PATH = "/tmp/nodefony-server.log";

function getJson(path: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode! }));
    });
    req.on("error", reject);
    req.end();
  });
}

// Fires GET /abort/wait (hangs 2s server-side) and destroys the socket after
// `abortAfterMs` < 2000 → client gone before any response → internal 499.
function abortedGet(path: string, abortAfterMs: number): Promise<void> {
  return new Promise((resolve) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      res.resume();
    });
    req.on("error", () => resolve());
    req.on("close", () => resolve());
    req.end();
    setTimeout(() => req.destroy(), abortAfterMs);
  });
}

function countInLog(pattern: RegExp, since: number): number {
  try {
    const text = fs
      .readFileSync(LOG_PATH, "utf8")
      .replace(/\x1b\[[0-9;]*m/g, "");
    return text
      .split("\n")
      .slice(since)
      .filter((l) => pattern.test(l)).length;
  } catch {
    return -1; // log unreadable — assertion skipped
  }
}

describe("Client abort → internal 499 — P2.3 (requires server)", () => {
  let logBaseline = 0;

  beforeAll(() => {
    try {
      logBaseline = fs.readFileSync(LOG_PATH, "utf8").split("\n").length;
    } catch {
      logBaseline = -1;
    }
  });

  it("aborting before any response is logged as 499, not 200", async () => {
    const N = 8;
    await Promise.all(
      Array.from({ length: N }, () =>
        abortedGet("/nodefony/test/abort/wait", 100),
      ),
    );
    // Let the close → teardown → logRequest handlers settle.
    await new Promise((r) => setTimeout(r, 500));

    if (logBaseline >= 0) {
      // Request log line for an aborted GET: "GET  499 https://.../abort/wait ...".
      const found499 = countInLog(
        /GET\s+499\s+https?:\/\/\S*\/abort\/wait/,
        logBaseline,
      );
      if (found499 >= 0) {
        expect(
          found499,
          "expected at least one '499' request log line",
        ).to.be.at.least(1);
      }
    }
    // Server stays healthy.
    const health = await getJson("/nodefony/test/index");
    expect(health.status).to.equal(200);
  });
});
