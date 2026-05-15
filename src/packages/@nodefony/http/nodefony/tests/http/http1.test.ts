/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";
import "mocha";

// Tests for plain HTTP on port 5151

const BASE = { hostname: "localhost", port: 5151 };

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function req(method: string, path: string, body?: string | Buffer, extraHeaders: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) {
      headers["Content-Length"] = String(Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body));
    }
    const r = http.request({ ...BASE, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode!, headers: res.headers as Record<string, unknown>, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode!, headers: res.headers as Record<string, unknown>, body: raw });
        }
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

describe("HTTP/1.1 — port 5151 (plain HTTP, requires server)", function () {
  this.timeout(15_000);

  // ── GET ─────────────────────────────────────────────────────────

  describe("GET", () => {
    it("GET / → 200 text/html", async () => {
      const { status, headers } = await req("GET", "/");
      expect(status).to.equal(200);
      expect(headers["content-type"] as string).to.include("text/html");
    });

    it("GET /nodefony/test/index → 200 application/json", async () => {
      const { status, headers } = await req("GET", "/nodefony/test/index");
      expect(status).to.equal(200);
      expect(headers["content-type"] as string).to.include("application/json");
    });

    it("GET /nodefony/test/context → scheme is 'http'", async () => {
      const { status, body } = await req("GET", "/nodefony/test/context");
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.scheme).to.equal("http");
      expect(b.type).to.equal("http");
      expect(b.method).to.equal("GET");
    });

    it("GET unknown path → 404", async () => {
      const { status } = await req("GET", "/does-not-exist-http1");
      expect(status).to.equal(404);
    });
  });

  // ── POST ────────────────────────────────────────────────────────

  describe("POST", () => {
    it("POST /nodefony/test/route/add → 200 JSON", async () => {
      const { status, headers } = await req("POST", "/nodefony/test/route/add", "", {
        "Content-Type": "application/json",
      });
      expect(status).to.equal(200);
      expect(headers["content-type"] as string).to.include("application/json");
    });

    it("POST with JSON body — Content-Length accepted", async () => {
      const payload = JSON.stringify({ hello: "world" });
      const { status } = await req("POST", "/nodefony/test/route/add", payload, {
        "Content-Type": "application/json",
      });
      expect(status).to.equal(200);
    });
  });

  // ── PUT ─────────────────────────────────────────────────────────

  describe("PUT", () => {
    it("PUT /nodefony/test/route/foo/move → 200 JSON", async () => {
      const { status, body } = await req("PUT", "/nodefony/test/route/foo/move");
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.name).to.equal("foo");
    });
  });

  // ── DELETE ──────────────────────────────────────────────────────

  describe("DELETE", () => {
    it("DELETE /nodefony/test/rest/session → 200 JSON with destroyed id", async () => {
      const { status, body } = await req("DELETE", "/nodefony/test/rest/session");
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b).to.have.property("destroyed");
      expect(b.destroyed).to.be.a("string").with.length.greaterThan(0);
    });
  });

  // ── Response headers ─────────────────────────────────────────────

  describe("Response headers", () => {
    it("response includes 'server: nodefony' header", async () => {
      const { headers } = await req("GET", "/nodefony/test/index");
      expect(headers["server"]).to.equal("nodefony");
    });

    it("response includes security headers (x-content-type-options)", async () => {
      const { headers } = await req("GET", "/nodefony/test/index");
      expect(headers["x-content-type-options"]).to.equal("nosniff");
    });

    it("response includes x-frame-options header", async () => {
      const { headers } = await req("GET", "/nodefony/test/index");
      expect(headers["x-frame-options"]).to.equal("DENY");
    });
  });

  // ── Chunked / transfer-encoding ──────────────────────────────────

  describe("Chunked transfer", () => {
    it("file stream route returns chunked or content-length over HTTP", async () => {
      const { status, headers } = await req("GET", "/nodefony/test/html/stream");
      expect(status).to.equal(200);
      // server may use chunked OR content-length — both are valid
      const te = headers["transfer-encoding"] as string | undefined;
      const cl = headers["content-length"] as string | undefined;
      expect(te === "chunked" || cl !== undefined, "expected chunked or content-length").to.be.true;
    });
  });
});
