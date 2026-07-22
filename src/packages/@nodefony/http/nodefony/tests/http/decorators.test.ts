/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

const BASE = { hostname: "localhost", port: 5151 };

type Res = { status: number; body: unknown };

function req(
  method: string,
  path: string,
  body?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) {
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    const r = http.request({ ...BASE, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode!, body: raw });
        }
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

describe("@Param / @Body / @Query decorators — integration (requires server)", function () {
  // ── @Param ──────────────────────────────────────────────────────────────────

  describe("@Param", () => {
    it("GET /param/{id} — @Param('id') injecte la valeur de route", async () => {
      const { status, body } = await req(
        "GET",
        "/nodefony/test/decorators/param/42",
      );
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).id).to.equal("42");
    });

    it("GET /params/{name}/{age} — deux @Param nommés", async () => {
      const { status, body } = await req(
        "GET",
        "/nodefony/test/decorators/params/alice/30",
      );
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.name).to.equal("alice");
      expect(b.age).to.equal("30");
    });

    it("GET /params-all/{name}/{age} — @Param() sans clé retourne l'objet complet", async () => {
      const { status, body } = await req(
        "GET",
        "/nodefony/test/decorators/params-all/bob/25",
      );
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.name).to.equal("bob");
      expect(b.age).to.equal("25");
    });
  });

  // ── @Query ──────────────────────────────────────────────────────────────────

  describe("@Query", () => {
    it("GET /query?q=hello&page=2 — @Query extrait les paramètres", async () => {
      const { status, body } = await req(
        "GET",
        "/nodefony/test/decorators/query?q=hello&page=2",
      );
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.q).to.equal("hello");
      expect(b.page).to.equal("2");
    });

    it("GET /query sans paramètres — valeurs null", async () => {
      const { status, body } = await req(
        "GET",
        "/nodefony/test/decorators/query",
      );
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.q).to.be.null;
      expect(b.page).to.be.null;
    });
  });

  // ── @Body ───────────────────────────────────────────────────────────────────

  describe("@Body", () => {
    it("POST /body — @Body() injecte le body complet", async () => {
      const payload = JSON.stringify({ hello: "world", count: 1 });
      const { status, body } = await req(
        "POST",
        "/nodefony/test/decorators/body",
        payload,
        {
          "Content-Type": "application/json",
        },
      );
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.hello).to.equal("world");
      expect(b.count).to.equal(1);
    });

    it("POST /body-field — @Body('name') extrait un champ", async () => {
      const payload = JSON.stringify({ name: "nodefony", other: "ignored" });
      const { status, body } = await req(
        "POST",
        "/nodefony/test/decorators/body-field",
        payload,
        {
          "Content-Type": "application/json",
        },
      );
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).name).to.equal("nodefony");
    });

    it("POST /body-alias — `body` livre le CORPS sur les 3 chemins, jamais la query string", async () => {
      const payload = JSON.stringify({ msg: "hello" });
      const { status, body } = await req(
        "POST",
        "/nodefony/test/decorators/body-alias?v=fromUrl",
        payload,
        { "Content-Type": "application/json" },
      );
      expect(status).to.equal(200);
      const r = body as Record<string, Record<string, unknown> | null>;
      // Les 3 alias rendent le corps parsé, à l'identique.
      for (const source of [
        "fromController",
        "fromRequest",
        "fromNodeRequest",
      ]) {
        expect(r[source], source).to.deep.equal({ msg: "hello" });
      }
      expect(r.queryPost).to.deep.equal({ msg: "hello" });
      // Contrôle : `query` FUSIONNE l'URL — c'est ce qui le distingue de `body`.
      expect(r.query).to.have.property("v", "fromUrl");
      expect(r.fromController).to.not.have.property("v");
    });

    it("POST /body-field sans le champ — null", async () => {
      const payload = JSON.stringify({ other: "foo" });
      const { status, body } = await req(
        "POST",
        "/nodefony/test/decorators/body-field",
        payload,
        {
          "Content-Type": "application/json",
        },
      );
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).name).to.be.null;
    });
  });

  // ── Mix @Param + @Body + @Query ─────────────────────────────────────────────

  describe("@Param + @Body + @Query combinés", () => {
    it("POST /mix/{id}?v=3 avec body — les trois sources sont injectées", async () => {
      const payload = JSON.stringify({ name: "test-user" });
      const { status, body } = await req(
        "POST",
        "/nodefony/test/decorators/mix/99?v=3",
        payload,
        { "Content-Type": "application/json" },
      );
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.id).to.equal("99");
      expect(b.name).to.equal("test-user");
      expect(b.v).to.equal("3");
    });

    it("POST /mix/{id} sans query ni body — champs manquants sont null", async () => {
      const { status, body } = await req(
        "POST",
        "/nodefony/test/decorators/mix/7",
        JSON.stringify({}),
        { "Content-Type": "application/json" },
      );
      expect(status).to.equal(200);
      const b = body as Record<string, unknown>;
      expect(b.id).to.equal("7");
      expect(b.name).to.be.null;
      expect(b.v).to.be.null;
    });
  });
});
