/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

// Conformité du retour AUTO-JSON des actions controller (Resolver.returnController)
// + headers réponse. Un controller qui `return { ... }` / `return [ ... ]` (sans
// renderJson) doit produire une réponse JSON RFC-conforme.
//
// RFC 8259 §11 (media type application/json) :
//   Required parameters: n/a — Optional parameters: n/a
//   « No "charset" parameter is defined for this registration. »
//   → Content-Type = `application/json` SANS `; charset=...`.
// RFC 9110 : Content-Length = taille en octets du corps ; status 200 par défaut.

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function get(
  path: string,
): Promise<{ status: number; headers: Record<string, unknown>; raw: string }> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode!,
          headers: res.headers as Record<string, unknown>,
          raw: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    r.on("error", reject);
    r.end();
  });
}

describe("Auto-JSON controller return — RFC 8259 / 9110 (requires server)", function () {
  describe("return { object } → auto-JSON", () => {
    it("status 200 (RFC 9110 défaut)", async () => {
      const { status } = await get("/nodefony/test/rest/auto/object");
      expect(status).to.equal(200);
    });

    it("Content-Type = 'application/json' SANS charset (RFC 8259 §11)", async () => {
      const { headers } = await get("/nodefony/test/rest/auto/object");
      expect(headers["content-type"]).to.equal("application/json");
      expect(String(headers["content-type"])).to.not.match(/charset/i);
    });

    it("corps = l'objet retourné (sérialisé fidèlement)", async () => {
      const { raw } = await get("/nodefony/test/rest/auto/object");
      expect(JSON.parse(raw)).to.deep.equal({
        ok: true,
        n: 42,
        nested: { a: [1, 2, 3] },
      });
    });

    it("Content-Length = nb d'octets UTF-8 du corps (RFC 9110)", async () => {
      const { headers, raw } = await get("/nodefony/test/rest/auto/object");
      expect(headers["content-length"]).to.equal(
        String(Buffer.byteLength(raw, "utf8")),
      );
    });
  });

  describe("return [ array ] → auto-JSON", () => {
    it("array sérialisé en JSON, Content-Type application/json", async () => {
      const { status, headers, raw } = await get(
        "/nodefony/test/rest/auto/array",
      );
      expect(status).to.equal(200);
      expect(headers["content-type"]).to.equal("application/json");
      expect(JSON.parse(raw)).to.deep.equal([1, "two", { three: 3 }]);
    });
  });

  describe("return scalaire (number/boolean) → auto-JSON (RFC 8259 §2)", () => {
    it("return 42 → corps '42', application/json, 200", async () => {
      const { status, headers, raw } = await get(
        "/nodefony/test/rest/auto/number",
      );
      expect(status).to.equal(200);
      expect(headers["content-type"]).to.equal("application/json");
      expect(JSON.parse(raw)).to.equal(42);
    });

    it("return true → corps 'true', application/json, 200", async () => {
      const { status, headers, raw } = await get(
        "/nodefony/test/rest/auto/boolean",
      );
      expect(status).to.equal(200);
      expect(headers["content-type"]).to.equal("application/json");
      expect(JSON.parse(raw)).to.equal(true);
    });
  });

  describe("return Buffer → envoi binaire direct (case 'buffer')", () => {
    it("octets intacts, 200 (avant : aucun envoi → timeout 408)", async () => {
      // Lecture BINAIRE (pas le helper get() qui décode utf8 → corromprait
      // 0xFE/0xFF en U+FFFD).
      const { status, body } = await new Promise<{
        status: number;
        body: Buffer;
      }>((resolve, reject) => {
        const r = https.request(
          { ...BASE, path: "/nodefony/test/rest/auto/buffer", method: "GET" },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () =>
              resolve({
                status: res.statusCode!,
                body: Buffer.concat(chunks),
              }),
            );
          },
        );
        r.on("error", reject);
        r.end();
      });
      expect(status).to.equal(200);
      expect(body).to.deep.equal(Buffer.from([0x00, 0x01, 0xfe, 0xff]));
    });
  });

  describe("return '' (corps vide légal)", () => {
    it("200 corps vide — pas de 500 ERR_STREAM_NULL_VALUES", async () => {
      const { status, raw } = await get("/nodefony/test/rest/auto/empty");
      expect(status).to.equal(200);
      expect(raw).to.equal("");
    });
  });

  describe("renderJson explicite — même conformité RFC", () => {
    it("application/json sans charset", async () => {
      const { status, headers } = await get("/nodefony/test/rest");
      expect(status).to.equal(200);
      expect(headers["content-type"]).to.equal("application/json");
    });
  });

  describe("headers réponse transverses", () => {
    it("X-Request-Id présent (corrélation requête)", async () => {
      const { headers } = await get("/nodefony/test/rest/auto/object");
      expect(headers["x-request-id"])
        .to.be.a("string")
        .with.length.greaterThan(0);
    });
  });
});
