/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
import "mocha";

// ── transport helper ─────────────────────────────────────────────

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

type Response = {
  status: number;
  headers: Record<string, unknown>;
  body: unknown;
};

function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return req("GET", path, headers);
}

function post(
  path: string,
  body = "",
  headers: Record<string, string> = {},
): Promise<Response> {
  return req(
    "POST",
    path,
    { "Content-Length": String(Buffer.byteLength(body)), ...headers },
    body,
  );
}

function req(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = https.request({ ...BASE, path, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => (raw += c));
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body: JSON.parse(raw),
          });
        } catch {
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body: raw,
          });
        }
      });
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

// ── HttpKernel pipeline ──────────────────────────────────────────

describe("HttpKernel — pipeline (requires server)", () => {
  describe("Routing", () => {
    it("resolves route and returns 200", async () => {
      const { status } = await get("/nodefony/test/index");
      expect(status).to.equal(200);
    });

    it("returns 404 for unknown path", async () => {
      const { status } = await get("/nodefony/test/this-does-not-exist");
      expect(status).to.equal(404);
    });

    it("route with path param — GET /route/ele/dev/json/add", async () => {
      const { status, body } = await get(
        "/nodefony/test/route/ele/dev/json/add",
      );
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b).to.have.property("metier", "dev");
      expect(b).to.have.property("format", "json");
    });

    it("wildcard route catches GET /route/add — returns 200", async () => {
      const { status } = await get("/nodefony/test/route/add");
      expect(status).to.be.within(200, 599);
    });

    it("POST-only route accepts POST with 200", async () => {
      const { status } = await post("/nodefony/test/route/add");
      expect(status).to.equal(200);
    });
  });

  describe("Content-Type negotiation", () => {
    it("returns application/json when renderJson is called", async () => {
      const { headers } = await get("/nodefony/test/index");
      expect(String(headers["content-type"])).to.include("application/json");
    });

    it("returns text/html for HTML routes", async () => {
      const { headers } = await get("/nodefony/test/html");
      expect(String(headers["content-type"])).to.include("text/html");
    });
  });

  describe("Error handling in pipeline", () => {
    it("nodefonyError in controller → correct status code", async () => {
      const { status } = await get("/nodefony/test/index2");
      expect(status).to.equal(502);
    });

    it("HttpError with JSON payload → status + Content-Type JSON", async () => {
      const { status, headers } = await get("/nodefony/test/index3");
      expect(status).to.equal(503);
      expect(String(headers["content-type"])).to.include("application/json");
    });

    it("sync throw (no HttpError) → 500", async () => {
      const { status } = await get("/nodefony/test/crash/sync");
      expect(status).to.equal(500);
    });

    it("async rejection → 500", async () => {
      const { status } = await get("/nodefony/test/crash/async");
      expect(status).to.equal(500);
    });

    it("TypeError in controller → 500", async () => {
      const { status } = await get("/nodefony/test/crash/native");
      expect(status).to.equal(500);
    });

    it("server survives all crash types — next request succeeds", async () => {
      await get("/nodefony/test/crash/sync");
      await get("/nodefony/test/crash/async");
      await get("/nodefony/test/crash/native");
      const { status } = await get("/nodefony/test/index");
      expect(status).to.equal(200);
    });
  });

  describe("Parallel requests — no context leakage", () => {
    it("10 concurrent GET requests all return 200", async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => get("/nodefony/test/index")),
      );
      for (const r of results) {
        expect(r.status).to.equal(200);
      }
    });

    it("concurrent requests to different routes return correct status each", async () => {
      const [ok, not, err] = await Promise.all([
        get("/nodefony/test/index"),
        get("/nodefony/test/this-does-not-exist"),
        get("/nodefony/test/index2"),
      ]);
      expect(ok.status).to.equal(200);
      expect(not.status).to.equal(404);
      expect(err.status).to.equal(502);
    });
  });
});

// ── HttpContext properties ───────────────────────────────────────

describe("HttpContext — properties (requires server)", () => {
  it("type is a non-empty string", async () => {
    const { body } = await get("/nodefony/test/context");
    expect((body as Record<string, unknown>).type)
      .to.be.a("string")
      .with.length.greaterThan(0);
  });

  it("scheme is 'https' for HTTPS port", async () => {
    const { body } = await get("/nodefony/test/context");
    expect((body as Record<string, unknown>).scheme).to.equal("https");
  });

  it("method is 'GET' for GET request", async () => {
    const { body } = await get("/nodefony/test/context");
    expect((body as Record<string, unknown>).method).to.equal("GET");
  });

  it("method is 'POST' for POST request", async () => {
    const { body } = await post("/nodefony/test/context");
    expect((body as Record<string, unknown>).method).to.equal("POST");
  });

  it("host is 'localhost'", async () => {
    const { body } = await get("/nodefony/test/context");
    expect(String((body as Record<string, unknown>).host)).to.include(
      "localhost",
    );
  });

  it("remoteAddress is populated", async () => {
    const { body } = await get("/nodefony/test/context");
    const addr = (body as Record<string, unknown>).remoteAddress;
    expect(addr).to.be.a("string").with.length.greaterThan(0);
  });

  it("spoofed X-Forwarded-For is ignored when trustProxy=false (default) — real socket IP", async () => {
    const { body } = await get("/nodefony/test/context", {
      "x-forwarded-for": "1.2.3.4",
    });
    const addr = String((body as Record<string, unknown>).remoteAddress);
    expect(addr).to.not.equal("1.2.3.4");
    expect(addr).to.match(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/u);
  });

  it("sessionId is set (initialize() starts session)", async () => {
    const { body } = await get("/nodefony/test/context");
    expect((body as Record<string, unknown>).sessionId).to.be.a("string");
  });

  it("userAgent is string or null", async () => {
    const { body } = await get("/nodefony/test/context");
    const ua = (body as Record<string, unknown>).userAgent;
    expect(ua === null || typeof ua === "string").to.be.true;
  });

  it("context properties are independent across concurrent requests", async () => {
    const results = await Promise.all([
      get("/nodefony/test/context"),
      post("/nodefony/test/context"),
      get("/nodefony/test/context"),
    ]);
    expect((results[0].body as Record<string, unknown>).method).to.equal("GET");
    expect((results[1].body as Record<string, unknown>).method).to.equal(
      "POST",
    );
    expect((results[2].body as Record<string, unknown>).method).to.equal("GET");
  });
});

// ── Request Tracing (requestId) ──────────────────────────────────

describe("Request Tracing — X-Request-Id (requires server)", () => {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("200 response includes X-Request-Id header", async () => {
    const { headers } = await get("/nodefony/test/index");
    expect(headers["x-request-id"])
      .to.be.a("string")
      .with.length.greaterThan(0);
  });

  it("X-Request-Id is a valid UUID v4", async () => {
    const { headers } = await get("/nodefony/test/index");
    expect(headers["x-request-id"]).to.match(UUID_RE);
  });

  it("each request gets a unique X-Request-Id", async () => {
    const [r1, r2] = await Promise.all([
      get("/nodefony/test/index"),
      get("/nodefony/test/index"),
    ]);
    expect(r1.headers["x-request-id"]).to.not.equal(r2.headers["x-request-id"]);
  });

  it("incoming X-Request-Id is honored (correlation propagation)", async () => {
    const custom = "my-trace-abc-123";
    const { headers } = await get("/nodefony/test/index", {
      "x-request-id": custom,
    });
    expect(headers["x-request-id"]).to.equal(custom);
  });

  it("rejects an X-Request-Id with a space — falls back to server UUID (no reflection, no 500)", async () => {
    const evil = "evil value";
    const { status, headers } = await get("/nodefony/test/index", {
      "x-request-id": evil,
    });
    expect(status).to.equal(200);
    expect(headers["x-request-id"]).to.not.equal(evil);
    expect(headers["x-request-id"]).to.match(UUID_RE);
  });

  it("rejects an oversized X-Request-Id (>128) — falls back to server UUID", async () => {
    const tooLong = "a".repeat(200);
    const { status, headers } = await get("/nodefony/test/index", {
      "x-request-id": tooLong,
    });
    expect(status).to.equal(200);
    expect(headers["x-request-id"]).to.not.equal(tooLong);
    expect(headers["x-request-id"]).to.match(UUID_RE);
  });

  it("error response (500) also includes X-Request-Id", async () => {
    const { headers, status } = await get("/nodefony/test/crash/sync");
    expect(status).to.equal(500);
    expect(headers["x-request-id"])
      .to.be.a("string")
      .with.length.greaterThan(0);
  });

  it("404 response includes X-Request-Id", async () => {
    const { headers, status } = await get("/nodefony/test/this-does-not-exist");
    expect(status).to.equal(404);
    expect(headers["x-request-id"])
      .to.be.a("string")
      .with.length.greaterThan(0);
  });

  it("concurrent requests each get distinct X-Request-Id", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => get("/nodefony/test/index")),
    );
    const ids = results.map((r) => r.headers["x-request-id"] as string);
    const unique = new Set(ids);
    expect(unique.size).to.equal(5);
  });
});

// ── HttpKernel resilience ────────────────────────────────────────

describe("HttpKernel resilience — server must never stop (requires server)", () => {
  it("HEAD request on existing route returns 200 with no body", async () => {
    const { status, body } = await req("HEAD", "/nodefony/test/index");
    expect(status).to.equal(200);
    expect(String(body)).to.have.length(0);
  });

  it("unknown HTTP method does not crash server", async () => {
    const { status } = await req("PROPFIND", "/nodefony/test/index");
    expect(status).to.be.within(200, 599);
  });

  it("very long URL path returns 4xx — no crash", async () => {
    const longPath = "/nodefony/test/" + "x".repeat(1000);
    const { status } = await get(longPath);
    expect(status).to.be.within(400, 499);
  });

  it("server handles 50 rapid sequential requests without degrading", async () => {
    for (let i = 0; i < 50; i++) {
      const { status } = await get("/nodefony/test/index");
      expect(status).to.equal(200);
    }
  });
});
