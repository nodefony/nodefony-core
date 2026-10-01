/// <reference types="node" />
/**
 * RFC compliance + symbiose http↔framework — error paths.
 *
 * RFC 9110 (HTTP semantics)
 * RFC 7230 §3.1.2 (status-line reason-phrase)
 * RFC 7807 (Problem Details for HTTP APIs) — informational
 *
 * Tests run against a live Nodefony server on 127.0.0.1:5152 (HTTPS).
 */
import { expect } from "vitest";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };

type RawResponse = {
  status: number;
  statusMessage: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  bodyLen: number;
};

function req(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        resolve({
          status: res.statusCode!,
          statusMessage: res.statusMessage ?? "",
          headers: res.headers,
          body: raw.toString("utf-8"),
          bodyLen: raw.length,
        });
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

const isAsciiPrintable = (s: string) => /^[\x20-\x7E]*$/.test(s);

// ─── RFC 7230 §3.1.2 — reason-phrase ─────────────────────────────────────────

describe("RFC 7230 §3.1.2 — Reason-phrase US-ASCII printable", () => {
  it("200 OK status-message is ASCII printable", async () => {
    const r = await req("GET", "/nodefony/test/index");
    expect(r.status).to.equal(200);
    expect(isAsciiPrintable(r.statusMessage)).to.equal(
      true,
      `got: "${r.statusMessage}"`,
    );
  });

  it("404 status-message is ASCII printable", async () => {
    const r = await req("GET", "/nodefony/test/nonexistent-route");
    expect(r.status).to.equal(404);
    expect(isAsciiPrintable(r.statusMessage)).to.equal(true);
  });

  it("500 status-message is ASCII printable (regression ERR_INVALID_CHAR)", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    expect(r.status).to.equal(500);
    expect(isAsciiPrintable(r.statusMessage)).to.equal(true);
  });

  it("server survives a request that previously triggered ERR_INVALID_CHAR", async () => {
    await req("GET", "/nodefony/test/crash/sync");
    const r = await req("GET", "/nodefony/test/index");
    expect(r.status).to.equal(200);
  });
});

// ─── RFC 9110 §9.3.2 — HEAD method ───────────────────────────────────────────

describe("RFC 9110 §9.3.2 — HEAD must not return body", () => {
  it("HEAD on 200 route — no body, same headers as GET", async () => {
    const get = await req("GET", "/nodefony/test/index");
    const head = await req("HEAD", "/nodefony/test/index");
    expect(head.status).to.equal(200);
    expect(head.bodyLen).to.equal(0);
    expect(head.headers["content-type"]).to.equal(get.headers["content-type"]);
  });

  it("HEAD on 404 route — no body", async () => {
    const r = await req("HEAD", "/nodefony/test/nonexistent");
    expect(r.status).to.equal(404);
    expect(r.bodyLen).to.equal(0);
  });

  it("HEAD on crash route — no body, status preserved", async () => {
    const r = await req("HEAD", "/nodefony/test/crash/sync");
    expect(r.status).to.equal(500);
    expect(r.bodyLen).to.equal(0);
  });
});

// ─── RFC 9110 §15.5.6 — 405 Method Not Allowed ───────────────────────────────

describe("RFC 9110 §15.5.6 — 405 Method Not Allowed MUST include Allow header", () => {
  it("DELETE on GET-only route returns 405 (not 200)", async () => {
    const r = await req("DELETE", "/nodefony/test/index");
    expect(r.status).to.equal(
      405,
      `expected 405 Method Not Allowed, got ${r.status}`,
    );
  });

  it("PUT on GET-only route returns 405", async () => {
    const r = await req("PUT", "/nodefony/test/index");
    expect(r.status).to.equal(405);
  });

  it("PATCH on GET-only route returns 405", async () => {
    const r = await req("PATCH", "/nodefony/test/index");
    expect(r.status).to.equal(405);
  });

  it("405 response includes Allow header listing permitted methods", async () => {
    const r = await req("DELETE", "/nodefony/test/index");
    expect(r.headers["allow"]).to.be.a("string");
    expect(String(r.headers["allow"]).toUpperCase()).to.include("GET");
  });
});

// ─── RFC 9110 §6.4.1 + §15.3.5 — no body in 204 / 304 ────────────────────────

describe("RFC 9110 §6.4.1 — 204/304 MUST NOT have a body", () => {
  it("204 No Content has empty body and no Content-Length > 0", async () => {
    const r = await req("GET", "/nodefony/test/nocontent");
    expect(r.status).to.equal(204);
    expect(r.bodyLen).to.equal(0);
    expect(r.headers["content-length"]).to.satisfy(
      (v: string | undefined) => v === undefined || v === "0",
    );
  });
});

// ─── Status code propagation: HttpError → onError → response ─────────────────

describe("Symbiose http↔framework — status code preservation", () => {
  it("controller throws Error → 500", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    expect(r.status).to.equal(500);
  });

  it("controller throws TypeError → 500", async () => {
    const r = await req("GET", "/nodefony/test/crash/native");
    expect(r.status).to.equal(500);
  });

  it("controller throws nodefonyError(502) → 502", async () => {
    const r = await req("GET", "/nodefony/test/index2");
    expect(r.status).to.equal(502);
  });

  it("controller throws HttpError(503) → 503", async () => {
    const r = await req("GET", "/nodefony/test/index3");
    expect(r.status).to.equal(503);
  });

  it("unknown route → 404", async () => {
    const r = await req("GET", "/nodefony/test/this-does-not-exist");
    expect(r.status).to.equal(404);
  });
});

// ─── Error JSON shape — current Nodefony contract ────────────────────────────

describe("Error JSON body — Nodefony contract (NOT RFC 7807)", () => {
  it("404 body is valid JSON", async () => {
    const r = await req("GET", "/nodefony/test/nonexistent");
    expect(() => JSON.parse(r.body)).to.not.throw();
  });

  it("500 body is valid JSON", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    expect(() => JSON.parse(r.body)).to.not.throw();
  });

  it("error body contains 'code' equal to HTTP status", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    const body = JSON.parse(r.body);
    expect(body.code).to.equal(500);
  });

  it("error body contains 'message' string", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    const body = JSON.parse(r.body);
    expect(body.message).to.be.a("string").with.length.greaterThan(0);
  });

  it("error body includes requestId (under nodefony.requestId)", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    const body = JSON.parse(r.body);
    expect(body.nodefony?.requestId)
      .to.be.a("string")
      .with.length.greaterThan(0);
  });

  it("error body requestId matches X-Request-Id response header", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    const body = JSON.parse(r.body);
    expect(body.nodefony?.requestId).to.equal(r.headers["x-request-id"]);
  });

  it("error body includes nodefony.scheme", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    const body = JSON.parse(r.body);
    expect(body.nodefony?.scheme).to.equal("https");
  });

  it("error body 'error' has Controller/Action when route resolved (HttpError fields)", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    const body = JSON.parse(r.body);
    // controller/action fields are populated by HttpError(context) when resolver was present
    expect(body.error).to.be.an("object");
    if (body.error.controller !== undefined) {
      expect(body.error.controller).to.be.a("string");
      expect(body.error.action).to.be.a("string");
    }
  });
});

// ─── Content-Length integrity (RFC 9110 §8.6) ────────────────────────────────

describe("RFC 9110 §8.6 — Content-Length matches body length", () => {
  it("200 response Content-Length matches actual body byte length", async () => {
    const r = await req("GET", "/nodefony/test/index");
    if (r.headers["content-length"]) {
      const expected = parseInt(String(r.headers["content-length"]), 10);
      expect(r.bodyLen).to.equal(expected);
    }
  });

  it("500 response Content-Length matches body byte length", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    if (r.headers["content-length"]) {
      const expected = parseInt(String(r.headers["content-length"]), 10);
      expect(r.bodyLen).to.equal(expected);
    }
  });
});

// ─── X-Request-Id propagation on errors ──────────────────────────────────────

describe("X-Request-Id — propagation on every response code", () => {
  it("200 response includes X-Request-Id", async () => {
    const r = await req("GET", "/nodefony/test/index");
    expect(r.headers["x-request-id"]).to.be.a("string");
  });

  it("404 response includes X-Request-Id", async () => {
    const r = await req("GET", "/nodefony/test/nope");
    expect(r.headers["x-request-id"]).to.be.a("string");
  });

  it("500 response includes X-Request-Id", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    expect(r.headers["x-request-id"]).to.be.a("string");
  });

  it("client-provided X-Request-Id is echoed back on error response", async () => {
    const id = "trace-rfc-test-9999";
    const r = await req("GET", "/nodefony/test/crash/sync", {
      "x-request-id": id,
    });
    expect(r.headers["x-request-id"]).to.equal(id);
  });
});

// ─── Symbiose : reason-phrase derived from status code ───────────────────────

// RFC 9112 §4 : la phrase de raison est une description TEXTUELLE du code — le
// client l'ignore, HTTP/2 ne la transporte pas. Une réponse d'ERREUR porte donc
// la phrase IANA ; le détail (nom de zone, méthode refusée) vit dans le corps.
// Le message de l'erreur y fuyait : `401 Authentication required for area
// "nodefony-admin"` nommait la zone à n'importe quel client anonyme.
describe("RFC 9112 §4 — une erreur porte la phrase de raison IANA, pas son message", () => {
  it("500 → 'Internal Server Error'", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    expect(r.status).to.equal(500);
    expect(r.statusMessage).to.equal("Internal Server Error");
  });

  it("404 → 'Not Found'", async () => {
    const r = await req("GET", "/nodefony/test/nope");
    expect(r.statusMessage).to.equal("Not Found");
  });

  it("405 → 'Method Not Allowed' (pas « Method DELETE Not Allowed »)", async () => {
    const r = await req("DELETE", "/nodefony/test/als-test/state");
    expect(r.status).to.equal(405);
    expect(r.statusMessage).to.equal("Method Not Allowed");
  });

  it("401 d'une zone → 'Unauthorized', sans le nom de la zone", async () => {
    const r = await req("GET", "/nodefony/kernel/api/modules");
    expect(r.status).to.equal(401);
    expect(r.statusMessage).to.equal("Unauthorized");
  });

  it("le détail reste dans le corps", async () => {
    const r = await req("DELETE", "/nodefony/test/als-test/state");
    const body = JSON.parse(r.body) as { message?: string };
    expect(body.message).to.match(/DELETE/);
  });
});

// RFC 9110 §15.5.2 : « The server generating a 401 response MUST send a
// WWW-Authenticate header field containing at least one challenge ». Une zone à
// session seule répondait un 401 NU — par crainte de la fenêtre de connexion du
// navigateur, que seuls Basic/Digest/Negotiate déclenchent.
describe("RFC 9110 §15.5.2 — tout 401 porte un challenge WWW-Authenticate", () => {
  it("401 d'une zone à session seule → WWW-Authenticate présent", async () => {
    const r = await req("GET", "/nodefony/kernel/api/modules");
    expect(r.status).to.equal(401);
    expect(r.headers["www-authenticate"]).to.be.a("string").and.not.equal("");
  });

  it("…et ce challenge n'ouvre pas la fenêtre du navigateur (ni Basic, ni Digest, ni Negotiate)", async () => {
    const r = await req("GET", "/nodefony/kernel/api/modules");
    expect(String(r.headers["www-authenticate"])).to.not.match(
      /^(Basic|Digest|Negotiate)\b/i,
    );
  });
});

// RFC 9112 §6.3 : le Content-Length DÉLIMITE le message. Un corps plus long que
// la longueur annoncée déborde sur la réponse suivante de la même connexion —
// désynchronisation qu'un proxy partagé transforme en empoisonnement de cache.
// OPTIONS et TRACE étaient traités comme HEAD (`Content-Length: 0`) alors que
// Node n'écarte le corps QUE pour HEAD : le 405 JSON partait quand même.
describe("RFC 9112 §6.3 — Content-Length exact sur OPTIONS et TRACE (pas de désynchronisation)", () => {
  for (const method of ["OPTIONS", "TRACE"]) {
    it(`${method} puis GET sur la MÊME connexion : chaque réponse fait exactement sa longueur`, async () => {
      const tls = await import("node:tls");
      const raw = await new Promise<string>((resolve, reject) => {
        const sock = tls.connect(
          { host: "127.0.0.1", port: 5152, rejectUnauthorized: false },
          () => {
            sock.write(
              `${method} /nodefony/test/als-test/state HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n` +
                "GET /nodefony/test/als-test/state HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            );
          },
        );
        let buf = "";
        sock.setEncoding("latin1");
        sock.on("data", (d: string) => (buf += d));
        sock.on("end", () => resolve(buf));
        sock.on("error", reject);
      });
      const head = raw.slice(0, raw.indexOf("\r\n\r\n"));
      const len = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? NaN);
      const next = raw.slice(head.length + 4 + len);
      expect(
        next.startsWith("HTTP/1.1 200"),
        `après ${len} octets : ${JSON.stringify(next.slice(0, 40))}`,
      ).to.equal(true);
    });
  }
});

// ─── RFC 7807 Problem Details — informational (current Nodefony format) ─────

describe("RFC 7807 — Problem Details (informational: current format diverges)", () => {
  it("[INFO] Nodefony does NOT use application/problem+json (uses application/json)", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    expect(String(r.headers["content-type"])).to.include("application/json");
    expect(String(r.headers["content-type"])).to.not.include("problem+json");
  });

  it("[INFO] Nodefony error body has 'code' (Nodefony) instead of 'status' (RFC 7807)", async () => {
    const r = await req("GET", "/nodefony/test/crash/sync");
    const body = JSON.parse(r.body);
    expect(body).to.have.property("code");
  });
});
