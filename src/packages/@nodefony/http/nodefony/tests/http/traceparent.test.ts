/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

// P2.7 — W3C Trace Context honored + generated end-to-end.
// Spec: https://www.w3.org/TR/trace-context/
//
// Coverage:
//   - HTTP request without traceparent → response carries a fresh, well-formed header.
//   - HTTP request with a valid traceparent → response keeps the same traceId.
//   - HTTP request with an invalid traceparent → server falls back to a new one.
//   - WS upgrade with a valid traceparent → server-side context.traceparent
//     reuses the incoming traceId (asserted via a controller probe endpoint).

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const TRACEPARENT_RE =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

function getRaw(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { ...BASE, path, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function parseTrace(value: string): {
  version: string;
  traceId: string;
  parentId: string;
  flags: string;
} | null {
  const m = TRACEPARENT_RE.exec(value);
  if (!m) return null;
  const [, version, traceId, parentId, flags] = m;
  return { version, traceId, parentId, flags };
}

describe("P2.7 — W3C traceparent (requires server)", () => {
  describe("HTTP — generate when missing", () => {
    it("response carries a well-formed traceparent header", async () => {
      const { status, headers } = await getRaw("/nodefony/test/index");
      expect(status).to.equal(200);
      const tp = headers.traceparent as string | undefined;
      expect(tp, "traceparent header is set on the response").to.be.a("string");
      const parsed = parseTrace(tp!);
      expect(parsed, "header matches W3C grammar").to.not.equal(null);
      expect(parsed!.version).to.equal("00");
      expect(parsed!.traceId).to.not.match(/^0+$/);
      expect(parsed!.parentId).to.not.match(/^0+$/);
    });

    it("two consecutive requests have different traceIds", async () => {
      const a = await getRaw("/nodefony/test/index");
      const b = await getRaw("/nodefony/test/index");
      const pa = parseTrace(a.headers.traceparent as string);
      const pb = parseTrace(b.headers.traceparent as string);
      expect(pa!.traceId).to.not.equal(pb!.traceId);
    });
  });

  describe("HTTP — honor incoming valid traceparent", () => {
    it("keeps the same traceId, mints a new spanId", async () => {
      const incoming =
        "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
      const { status, headers } = await getRaw("/nodefony/test/index", {
        traceparent: incoming,
      });
      expect(status).to.equal(200);
      const out = headers.traceparent as string;
      const parsed = parseTrace(out)!;
      expect(parsed.version).to.equal("00");
      expect(parsed.traceId).to.equal("0af7651916cd43dd8448eb211c80319c");
      // we are a child span — parentId must differ
      expect(parsed.parentId).to.not.equal("b7ad6b7169203331");
      expect(parsed.flags).to.equal("01");
    });

    it("preserves flags (e.g. not-sampled `00`)", async () => {
      const incoming =
        "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00";
      const { headers } = await getRaw("/nodefony/test/index", {
        traceparent: incoming,
      });
      const parsed = parseTrace(headers.traceparent as string)!;
      expect(parsed.flags).to.equal("00");
    });
  });

  describe("HTTP — reject and regenerate on invalid input", () => {
    it("malformed header → new traceparent generated", async () => {
      const { headers } = await getRaw("/nodefony/test/index", {
        traceparent: "not-a-valid-traceparent",
      });
      const parsed = parseTrace(headers.traceparent as string)!;
      expect(parsed.version).to.equal("00");
      expect(parsed.traceId).to.not.equal("");
    });

    it("all-zero traceId → new traceparent generated", async () => {
      const incoming =
        "00-00000000000000000000000000000000-b7ad6b7169203331-01";
      const { headers } = await getRaw("/nodefony/test/index", {
        traceparent: incoming,
      });
      const parsed = parseTrace(headers.traceparent as string)!;
      expect(parsed.traceId).to.not.equal("00000000000000000000000000000000");
    });

    it("reserved version `ff` → new traceparent generated", async () => {
      const incoming =
        "ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
      const { headers } = await getRaw("/nodefony/test/index", {
        traceparent: incoming,
      });
      const parsed = parseTrace(headers.traceparent as string)!;
      expect(parsed.version).to.equal("00");
      // freshly generated traceId, not the rejected one
      expect(parsed.traceId).to.not.equal("0af7651916cd43dd8448eb211c80319c");
    });
  });

  describe("WS — traceparent propagated into the message lifecycle", () => {
    // Probe: /als-test/ws echoes RequestContext.traceparent on handshake AND on
    // every message frame (BUG-001 — ALS must survive across WS messages).
    const WS_PROBE = "wss://localhost:5152/nodefony/test/als-test/ws";

    // Opens the WS with the given upgrade headers, sends one frame, resolves
    // with the parsed JSON of the *message* response (not the handshake).
    function wsTrace(
      headers: Record<string, string>,
    ): Promise<{ handshake: boolean; alsTraceparent: string | null }> {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_PROBE, {
          rejectUnauthorized: false,
          headers,
        });
        let opened = false;
        ws.on("open", () => {
          opened = true;
          ws.send("ping");
        });
        ws.on("message", (raw: Buffer) => {
          const msg = JSON.parse(raw.toString());
          if (msg.handshake === false) {
            ws.close();
            resolve(msg);
          }
        });
        ws.on("error", (err) => reject(err));
        setTimeout(() => {
          if (!opened) reject(new Error("WS never opened"));
        }, 2000);
      });
    }

    it("handshake completes when a valid traceparent is sent (regression)", async () => {
      const ws = new WebSocket("wss://localhost:5152/nodefony/test/ws/echo", {
        rejectUnauthorized: false,
        headers: {
          traceparent:
            "00-deadbeefdeadbeefdeadbeefdeadbeef-cafebabecafebabe-01",
        },
      });
      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.close();
          resolve();
        });
        ws.on("error", (err) => reject(err));
      });
    });

    it("incoming traceId survives into a WS message handler (via ALS)", async () => {
      const incoming =
        "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
      const { alsTraceparent } = await wsTrace({ traceparent: incoming });
      expect(
        alsTraceparent,
        "traceparent readable in WS message via RequestContext",
      ).to.be.a("string");
      const parsed = parseTrace(alsTraceparent!);
      expect(parsed, "stored traceparent matches W3C grammar").to.not.equal(
        null,
      );
      expect(
        parsed!.traceId,
        "same trace, propagated across the upgrade",
      ).to.equal("0af7651916cd43dd8448eb211c80319c");
      // child span on our side — parentId must have been re-minted
      expect(parsed!.parentId).to.not.equal("b7ad6b7169203331");
    });

    it("generates a fresh traceparent when none is sent on the upgrade", async () => {
      const { alsTraceparent } = await wsTrace({});
      expect(alsTraceparent, "WS context always has a traceparent").to.be.a(
        "string",
      );
      const parsed = parseTrace(alsTraceparent!);
      expect(parsed, "generated header is W3C-valid").to.not.equal(null);
      expect(parsed!.traceId).to.not.match(/^0+$/);
    });

    it("rejects an invalid incoming traceparent and mints a new one", async () => {
      const { alsTraceparent } = await wsTrace({
        traceparent: "garbage-not-w3c",
      });
      const parsed = parseTrace(alsTraceparent!);
      expect(parsed, "fallback header is W3C-valid").to.not.equal(null);
      expect(parsed!.version).to.equal("00");
    });
  });
});
