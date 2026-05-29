import { expect } from "chai";
import https from "node:https";
import http2 from "node:http2";
import tls from "node:tls";
import net from "node:net";
import "mocha";

// ── helpers ──────────────────────────────────────────────────────

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function get(path: string, headers: Record<string, string> = {}): Promise<Res> {
  return httpReq("GET", path, headers);
}

function post(
  path: string,
  body: string | Buffer = "",
  headers: Record<string, string> = {},
): Promise<Res> {
  const len = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
  return httpReq(
    "POST",
    path,
    { "Content-Length": String(len), ...headers },
    body,
  );
}

function httpReq(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string | Buffer,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
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
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Sends a partial TLS request then abruptly destroys the socket (ECONNRESET)
function abruptDisconnect(path: string): Promise<void> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: "localhost", port: 5152, rejectUnauthorized: false },
      () => {
        socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n`);
        // partial request — no trailing \r\n → server is waiting
        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 80);
      },
    );
    socket.on("error", () => resolve());
  });
}

// ── tests ────────────────────────────────────────────────────────

describe("Resilience — server must never crash (requires server)", () => {
  describe("Abrupt client disconnect", () => {
    it("ECONNRESET mid-request is absorbed — server stays alive", async () => {
      await abruptDisconnect("/nodefony/test/index");
      // give the server a moment to handle the socket close
      await new Promise((r) => setTimeout(r, 150));
      const { status } = await get("/nodefony/test/index");
      expect(status).to.equal(200);
    });

    it("three abrupt disconnects in a row — server still serves 200", async () => {
      await Promise.all([
        abruptDisconnect("/nodefony/test/index"),
        abruptDisconnect("/nodefony/test/index"),
        abruptDisconnect("/nodefony/test/index"),
      ]);
      await new Promise((r) => setTimeout(r, 150));
      const { status } = await get("/nodefony/test/index");
      expect(status).to.equal(200);
    });
  });

  describe("Oversized payloads", () => {
    it("POST with 3 MB body to non-upload route — server responds (no crash)", async () => {
      const bigBody = Buffer.alloc(3 * 1024 * 1024, "x");
      const { status } = await post("/nodefony/test/rest", bigBody, {
        "Content-Type": "application/x-www-form-urlencoded",
      });
      // server may return 413, 400, or 200 depending on config — must NOT crash
      expect(status).to.be.within(200, 599);
    });

    it("POST with 5 MB form field — server responds (no crash)", async () => {
      const bigField = "field=" + "A".repeat(5 * 1024 * 1024);
      const { status } = await post("/nodefony/test/html/upload", bigField, {
        "Content-Type": "application/x-www-form-urlencoded",
      });
      expect(status).to.be.within(200, 599);
    });
  });

  describe("Malformed requests", () => {
    it("missing Host header — server responds (no crash)", async () => {
      const { status } = await httpReq("GET", "/nodefony/test/index", {
        host: "", // override mocha's default Host header
      });
      expect(status).to.be.within(200, 599);
    });

    it("Content-Length: 0 with no body on POST — server responds", async () => {
      const { status } = await post("/nodefony/test/rest", "", {
        "Content-Type": "application/json",
        "Content-Length": "0",
      });
      expect(status).to.be.within(200, 599);
    });

    it("Unknown HTTP method — server returns 4xx (no crash)", async () => {
      const { status } = await httpReq("FAKEMETHOD", "/nodefony/test/index");
      expect(status).to.be.within(400, 499);
    });

    it("malformed header (clientError) → 400 + socket closed (no FD leak)", (done) => {
      // Socket brut sur le port HTTP clair (5151) : nom d'en-tête contenant un
      // caractère de contrôle → llhttp rejette → event 'clientError'. Le serveur
      // DOIT répondre 400 et fermer (sinon fuite de socket). Cf handleClientError.
      const socket = net.connect(5151, "localhost", () => {
        socket.write(
          "GET /nodefony/test/index HTTP/1.1\r\nHost: localhost\r\nX\x01Y: 1\r\n\r\n",
        );
      });
      let data = "";
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        done(err);
      };
      socket.setTimeout(4000);
      socket.on("data", (c: Buffer) => (data += c.toString()));
      socket.on("close", () => {
        try {
          expect(data).to.match(/400 Bad Request/u);
          finish();
        } catch (e) {
          finish(e as Error);
        }
      });
      socket.on("timeout", () =>
        finish(new Error("no 400 response / socket left open")),
      );
      socket.on("error", () => {
        /* ECONNRESET possible après fermeture serveur — toléré */
      });
    });
  });

  describe("Burst / sustained load", () => {
    it("50 concurrent GET requests — all receive valid status", async () => {
      const results = await Promise.all(
        Array.from({ length: 50 }, () => get("/nodefony/test/index")),
      );
      for (const r of results) {
        expect(r.status).to.be.within(200, 599);
      }
    });

    it("50 concurrent crash requests — server alive after", async () => {
      await Promise.allSettled(
        Array.from({ length: 50 }, () => get("/nodefony/test/crash/sync")),
      );
      const { status } = await get("/nodefony/test/index");
      expect(status).to.equal(200);
    });

    it("mixed burst: crashes + valid requests — no interference", async () => {
      const [crash, ok1, notFound, ok2] = await Promise.all([
        get("/nodefony/test/crash/async"),
        get("/nodefony/test/index"),
        get("/nodefony/test/does-not-exist"),
        get("/nodefony/test/rest/session"),
      ]);
      expect(crash.status).to.equal(500);
      expect(ok1.status).to.equal(200);
      expect(notFound.status).to.equal(404);
      expect(ok2.status).to.equal(200);
    });
  });

  describe("Error response format", () => {
    it("4xx response has non-empty body", async () => {
      const { status, body } = await get("/nodefony/test/does-not-exist");
      expect(status).to.equal(404);
      expect(String(body)).to.have.length.greaterThan(0);
    });

    it("500 response has non-empty body", async () => {
      const { body } = await get("/nodefony/test/crash/sync");
      expect(String(body)).to.have.length.greaterThan(0);
    });

    it("error response has content-type header", async () => {
      const { headers } = await get("/nodefony/test/does-not-exist");
      expect(headers["content-type"]).to.be.a("string");
    });
  });
});

// Régression — abort client PENDANT une réponse STREAMÉE (streamFile/pipe).
// Différent de l'abort mid-requête (ECONNRESET ci-dessus) : ici le serveur écrit
// déjà le corps. Sur HTTP/2 un write sur stream détruit = ERR_HTTP2_INVALID_STREAM
// / ERR_STREAM_WRITE_AFTER_END (CRITIC) si non gardé. Vérifie : pas de crash
// (serveur sert encore 200) — gardes Http2Response + sémantique pipe Node.
// Sert le media 14 Mo (/nodefony/test/html/media) → abort après quelques Ko.
function abortMediaStreamHttp2(killAfterBytes: number): Promise<void> {
  return new Promise((resolve) => {
    const session = http2.connect("https://localhost:5152", {
      rejectUnauthorized: false,
    });
    session.on("error", () => resolve());
    const req = session.request({
      ":path": "/nodefony/test/html/media",
      ":method": "GET",
    });
    let received = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      req.destroy();
      session.destroy();
      resolve();
    };
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received >= killAfterBytes) finish(); // abort mid-stream
    });
    req.on("error", finish);
    req.on("end", finish);
    req.end();
  });
}

describe("Resilience — abort pendant une réponse streamée (HTTP/2)", () => {
  it("abort mid media-stream → serveur reste vivant (pas de write-after-end crash)", async () => {
    await abortMediaStreamHttp2(16 * 1024);
    await new Promise((r) => setTimeout(r, 300));
    const health = await get("/nodefony/test/index");
    expect(health.status).to.equal(200);
  });

  it("8 aborts mid-stream consécutifs → serveur sert toujours 200", async () => {
    for (let i = 0; i < 8; i++) {
      await abortMediaStreamHttp2(8 * 1024);
    }
    await new Promise((r) => setTimeout(r, 300));
    const health = await get("/nodefony/test/index");
    expect(health.status).to.equal(200);
  });
});
