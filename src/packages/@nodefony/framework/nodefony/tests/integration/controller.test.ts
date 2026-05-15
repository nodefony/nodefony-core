/// <reference types="node" />
/**
 * Integration tests — Controller features via HTTP
 * Requires: server running on 5151 (plain HTTP) and 5152 (HTTPS)
 * Start: /start-nodefony-server  (or skill in CLAUDE.md)
 */
import { expect } from "chai";
import http from "node:http";
import https from "node:https";
import "mocha";

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const HTTP_BASE  = { hostname: "localhost", port: 5151 };
const HTTPS_BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

type Res = {
  status: number;
  headers: Record<string, unknown>;
  body: unknown;
};

function httpReq(
  method: string,
  path: string,
  body?: string,
  extraHeaders: Record<string, string> = {}
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) {
      headers["Content-Length"] = String(Buffer.byteLength(body));
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    const r = http.request({ ...HTTP_BASE, method, path, headers }, (res) => {
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

function httpsReq(
  method: string,
  path: string,
  body?: string,
  extraHeaders: Record<string, string> = {}
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) {
      headers["Content-Length"] = String(Buffer.byteLength(body));
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    const r = https.request({ ...HTTPS_BASE, method, path, headers }, (res) => {
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

const BASE = "/nodefony/test/fw";
const TIMEOUT = 10_000;

// ── renderJson ────────────────────────────────────────────────────────────────

describe("Controller — renderJson (HTTP)", function () {
  this.timeout(TIMEOUT);

  it("GET /fw/json → 200 application/json", async () => {
    const { status, headers, body } = await httpReq("GET", `${BASE}/json`);
    expect(status).to.equal(200);
    expect(headers["content-type"] as string).to.include("application/json");
    expect((body as Record<string, unknown>).ok).to.be.true;
  });

  it("GET /fw/json → 200 on HTTPS", async () => {
    const { status } = await httpsReq("GET", `${BASE}/json`);
    expect(status).to.equal(200);
  });
});

// ── @HttpCode ─────────────────────────────────────────────────────────────────

describe("Controller — @HttpCode decorator (HTTP)", function () {
  this.timeout(TIMEOUT);

  it("POST /fw/created → 201 status", async () => {
    const { status, body } = await httpReq("POST", `${BASE}/created`, "{}");
    expect(status).to.equal(201);
    expect((body as Record<string, unknown>).created).to.be.true;
  });

  it("POST /fw/created → 201 on HTTPS", async () => {
    const { status } = await httpsReq("POST", `${BASE}/created`, "{}");
    expect(status).to.equal(201);
  });
});

// ── @Header ───────────────────────────────────────────────────────────────────

describe("Controller — @Header decorator (HTTP)", function () {
  this.timeout(TIMEOUT);

  it("GET /fw/with-header → X-Framework: nodefony header present", async () => {
    const { status, headers } = await httpReq("GET", `${BASE}/with-header`);
    expect(status).to.equal(200);
    expect(headers["x-framework"]).to.equal("nodefony");
  });

  it("GET /fw/multi-header → both X-Version and X-Powered-By present", async () => {
    const { status, headers } = await httpReq("GET", `${BASE}/multi-header`);
    expect(status).to.equal(200);
    expect(headers["x-version"]).to.equal("10");
    expect(headers["x-powered-by"]).to.equal("nodefony");
  });
});

// ── redirect() method ─────────────────────────────────────────────────────────

describe("Controller — redirect() method (HTTP)", function () {
  this.timeout(TIMEOUT);

  it("GET /fw/redirect-302 → 302 Location: /nodefony/test/fw/json", async () => {
    const { status, headers } = await httpReq("GET", `${BASE}/redirect-302`);
    expect(status).to.equal(302);
    expect(headers["location"]).to.equal(`${BASE}/json`);
  });

  it("GET /fw/redirect-301 → 301 Location: /nodefony/test/fw/json", async () => {
    const { status, headers } = await httpReq("GET", `${BASE}/redirect-301`);
    expect(status).to.equal(301);
    expect(headers["location"]).to.equal(`${BASE}/json`);
  });
});

// ── @Redirect decorator ───────────────────────────────────────────────────────

describe("Controller — @Redirect decorator (HTTP)", function () {
  this.timeout(TIMEOUT);

  it("GET /fw/deco-redirect → 302 Location: /nodefony/test/fw/json", async () => {
    const { status, headers } = await httpReq("GET", `${BASE}/deco-redirect`);
    expect(status).to.equal(302);
    expect(headers["location"]).to.equal(`${BASE}/json`);
  });

  it("GET /fw/deco-redirect-301 → 301 Location: /nodefony/test/fw/json", async () => {
    const { status, headers } = await httpReq("GET", `${BASE}/deco-redirect-301`);
    expect(status).to.equal(301);
    expect(headers["location"]).to.equal(`${BASE}/json`);
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe("Controller — error handling (HTTP)", function () {
  this.timeout(TIMEOUT);

  it("GET /fw/error/sync → 500 (sync throw)", async () => {
    const { status } = await httpReq("GET", `${BASE}/error/sync`);
    expect(status).to.equal(500);
  });

  it("GET /fw/error/http-422 → 422 (HttpError)", async () => {
    const { status } = await httpReq("GET", `${BASE}/error/http-422`);
    expect(status).to.equal(422);
  });

  it("GET /fw/error/http-400 → 400 with body", async () => {
    const { status, body } = await httpReq("GET", `${BASE}/error/http-400`);
    expect(status).to.equal(400);
    // error response should be JSON
    expect(body).to.be.an("object");
  });
});

// ── queryGet ─────────────────────────────────────────────────────────────────

describe("Controller — queryGet params (HTTP)", function () {
  this.timeout(TIMEOUT);

  it("GET /fw/echo?name=foo&page=2 → les deux params correctement parsés (fix Request.ts slice(1))", async () => {
    const { status, body } = await httpReq("GET", `${BASE}/echo?name=foo&page=2`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.name).to.equal("foo");
    expect(b.page).to.equal("2");
  });

  it("GET /fw/echo (no params) → null values", async () => {
    const { status, body } = await httpReq("GET", `${BASE}/echo`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.name).to.be.null;
    expect(b.page).to.be.null;
  });
});

// ── HTTP method constraints (@Post, @Put, @Delete, @Patch) ───────────────────

describe("Controller — HTTP method decorators (HTTP)", function () {
  this.timeout(TIMEOUT);

  it("POST /fw/post-only → 200", async () => {
    const { status, body } = await httpReq("POST", `${BASE}/post-only`, "{}");
    expect(status).to.equal(200);
    expect((body as Record<string, unknown>).method).to.equal("POST");
  });

  it("GET /fw/post-only → 4xx or 5xx (method not allowed)", async () => {
    const { status } = await httpReq("GET", `${BASE}/post-only`);
    expect(status).to.be.greaterThanOrEqual(400);
  });

  it("PUT /fw/put-only → 200", async () => {
    const { status, body } = await httpReq("PUT", `${BASE}/put-only`, "{}");
    expect(status).to.equal(200);
    expect((body as Record<string, unknown>).method).to.equal("PUT");
  });

  it("DELETE /fw/delete-only → 200", async () => {
    const { status, body } = await httpReq("DELETE", `${BASE}/delete-only`);
    expect(status).to.equal(200);
    expect((body as Record<string, unknown>).method).to.equal("DELETE");
  });

  it("PATCH /fw/patch-only → 200", async () => {
    const { status, body } = await httpReq("PATCH", `${BASE}/patch-only`, "{}");
    expect(status).to.equal(200);
    expect((body as Record<string, unknown>).method).to.equal("PATCH");
  });
});

// ── context info ──────────────────────────────────────────────────────────────

describe("Controller — context info (HTTP/HTTPS)", function () {
  this.timeout(TIMEOUT);

  it("GET /fw/context over HTTP → scheme=http type=http", async () => {
    const { status, body } = await httpReq("GET", `${BASE}/context`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.scheme).to.equal("http");
    expect(b.type).to.equal("http");
    expect(b.method).to.equal("GET");
  });

  it("GET /fw/context over HTTPS → scheme=https", async () => {
    const { status, body } = await httpsReq("GET", `${BASE}/context`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.scheme).to.equal("https");
  });
});

// ── session ───────────────────────────────────────────────────────────────────

describe("Controller — session (HTTP)", function () {
  this.timeout(TIMEOUT);

  it("GET /fw/session → 200 sessionStarted true and Set-Cookie present", async () => {
    const { status, headers, body } = await httpReq("GET", `${BASE}/session`);
    expect(status).to.equal(200);
    expect((body as Record<string, unknown>).sessionStarted).to.be.true;
    // session cookie should be set
    const setCookie = headers["set-cookie"];
    expect(setCookie).to.exist;
  });
});
