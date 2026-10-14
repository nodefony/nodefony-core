/// <reference types="node" />
import { expect } from "vitest";
import http2 from "node:http2";
import https from "node:https";
import tls from "node:tls";
import { devAuthorityPem } from "../helpers/devAuthority";

// Tests for HTTPS/TLS on port 5152

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function get(
  path: string,
  extraHeaders: Record<string, string> = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { ...BASE, path, method: "GET", headers: extraHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: JSON.parse(raw),
            });
          } catch {
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: raw,
            });
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

function tlsConnect(): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tls.connect(
      { host: "localhost", port: 5152, rejectUnauthorized: false },
      () => resolve(s),
    );
    s.on("error", reject);
  });
}

describe("HTTPS/TLS — port 5152 (requires server)", function () {
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

    it("server certificate advertises 'localhost' in SAN", async () => {
      const s = await tlsConnect();
      const cert = s.getPeerCertificate();
      // Le hostname doit être dans le subjectAltName (RFC 9525) — le CN est
      // déprécié et n'est plus posé par mkcert ni par le fallback auto-signé.
      expect(cert.subjectaltname).to.match(/DNS:localhost/);
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

  // ── Certificat VALIDÉ ────────────────────────────────────────────
  //
  // Les autres cas ignorent la chaîne (`rejectUnauthorized: false`) : ils
  // resteraient verts avec un certificat qu'aucun navigateur n'accepte — nom
  // absent du SAN, autorité régénérée sans le certificat, racine mkcert pas
  // recopiée. Ici, l'autorité que le serveur a écrite (`caPath`) valide la
  // chaîne ET le nom, comme un navigateur qui l'a reçue. `ca:` est local à
  // chaque connexion : les ancres du processus ne bougent pas.

  describe("certificat servi — validé par l'autorité générée", () => {
    const ca = devAuthorityPem();

    function verifiedConnect(
      host: string,
      options: tls.ConnectionOptions = {},
    ): Promise<tls.TLSSocket> {
      return new Promise((resolve, reject) => {
        const s = tls.connect({ host, port: 5152, ca, ...options }, () =>
          resolve(s),
        );
        s.on("error", reject);
      });
    }

    for (const host of ["localhost", "127.0.0.1"]) {
      it(`${host} : chaîne et nom validés (HTTP/1.1)`, async () => {
        const s = await verifiedConnect(host);
        expect(s.authorized, String(s.authorizationError)).toBe(true);
        s.destroy();
      });

      it(`${host} : chaîne et nom validés en HTTP/2 (ALPN h2)`, async () => {
        const session = http2.connect(`https://${host}:5152`, { ca });
        try {
          const status = await new Promise<number>((resolve, reject) => {
            session.on("error", reject);
            const req = session.request({ ":path": "/nodefony/test/index" });
            req.on("response", (h) => resolve(Number(h[":status"])));
            req.on("error", reject);
            req.resume();
            req.end();
          });
          expect(session.alpnProtocol).toBe("h2");
          expect(status).toBe(200);
        } finally {
          session.close();
        }
      });
    }

    it("témoin : sans cette autorité, la chaîne est refusée", async () => {
      // Une racine publique qui n'a rien signé ici : prouve que c'est bien
      // `caPath` qui valide, et non une ancre posée par l'environnement.
      const other = tls.rootCertificates[0]!;
      await expect(
        verifiedConnect("localhost", { ca: other }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/CERT|VERIFY/),
      });
    });

    it("témoin : un nom absent du certificat est refusé", async () => {
      await expect(
        verifiedConnect("127.0.0.1", {
          servername: "absent-du-certificat.example",
        }),
      ).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
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
      expect(headers["content-type"]).to.include("application/json");
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
      const r = https.request({
        ...BASE,
        path: "/nodefony/test/html/redirect",
        method: "GET",
      });
      const { status, location } = await new Promise<{
        status: number;
        location: string;
      }>((resolve, reject) => {
        r.on("response", (res) => {
          res.resume();
          resolve({
            status: res.statusCode!,
            location: (res.headers["location"] as string) ?? "",
          });
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
        Array.from({ length: 10 }, () => get("/nodefony/test/index")),
      );
      for (const r of results) {
        expect(r.status).to.equal(200);
      }
    });
  });
});
