/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
import tls from "node:tls";
import "mocha";

// Tests for HTTPS/TLS on port 5152

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function get(path: string, extraHeaders: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, path, method: "GET", headers: extraHeaders }, (res) => {
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
    r.end();
  });
}

function tlsConnect(): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: "localhost", port: 5152, rejectUnauthorized: false }, () => resolve(s));
    s.on("error", reject);
  });
}

describe("HTTPS/TLS — port 5152 (requires server)", function () {
  this.timeout(15_000);

  // ── TLS handshake ────────────────────────────────────────────────

  describe("TLS handshake", () => {
    it("TLS socket connects successfully", async () => {
      const s = await tlsConnect();
      expect(s.authorized).to.be.false; // self-signed cert
      s.destroy();
    });

    it("uses TLSv1.2 or TLSv1.3", async () => {
      const s = await tlsConnect();
      const proto = s.getProtocol();
      expect(proto).to.match(/^TLSv1\.[23]$/);
      s.destroy();
    });

    it("server certificate CN is 'localhost'", async () => {
      const s = await tlsConnect();
      const cert = s.getPeerCertificate();
      expect(cert.subject.CN).to.equal("localhost");
      s.destroy();
    });

    it("cipher is a known strong algorithm", async () => {
      const s = await tlsConnect();
      const cipher = s.getCipher();
      // AES-128/256-GCM or CHACHA20 — all strong
      expect(cipher.name).to.match(/AES|CHACHA/);
      s.destroy();
    });
  });

  // ── HTTPS requests ───────────────────────────────────────────────

  describe("HTTPS requests", () => {
    it("GET / → 200", async () => {
      const { status } = await get("/");
      expect(status).to.equal(200);
    });

    it("GET /nodefony/test/index → 200 JSON", async () => {
      const { status, headers } = await get("/nodefony/test/index");
      expect(status).to.equal(200);
      expect(headers["content-type"] as string).to.include("application/json");
    });

    it("GET /nodefony/test/context → scheme is 'https'", async () => {
      const { status, body } = await get("/nodefony/test/context");
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.scheme).to.equal("https");
      expect(b.type).to.equal("https");
    });
  });

  // ── HTTPS-specific headers ───────────────────────────────────────

  describe("HTTPS security headers", () => {
    it("strict-transport-security header present on HTTPS", async () => {
      const { headers } = await get("/nodefony/test/index");
      const hsts = headers["strict-transport-security"] as string;
      expect(hsts).to.be.a("string");
      expect(hsts).to.include("max-age=");
    });

    it("HSTS includes includeSubDomains", async () => {
      const { headers } = await get("/nodefony/test/index");
      const hsts = headers["strict-transport-security"] as string;
      expect(hsts).to.include("includeSubDomains");
    });
  });

  // ── Redirect route ───────────────────────────────────────────────

  describe("Redirect", () => {
    it("GET /nodefony/test/html/redirect → 3xx Location header", async () => {
      const r = https.request({ ...BASE, path: "/nodefony/test/html/redirect", method: "GET" });
      const { status, location } = await new Promise<{ status: number; location: string }>((resolve, reject) => {
        r.on("response", (res) => {
          res.resume();
          resolve({ status: res.statusCode!, location: res.headers["location"] as string ?? "" });
        });
        r.on("error", reject);
        r.end();
      });
      expect(status).to.be.within(300, 399);
      expect(location).to.be.a("string").with.length.greaterThan(0);
    });
  });

  // ── Concurrent HTTPS ─────────────────────────────────────────────

  describe("Concurrent HTTPS", () => {
    it("10 simultaneous HTTPS requests — all 200", async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => get("/nodefony/test/index"))
      );
      for (const r of results) {
        expect(r.status).to.equal(200);
      }
    });
  });
});
