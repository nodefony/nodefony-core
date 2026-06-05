/// <reference types="node" />
/**
 * Integration tests — @Param / @Body / @Query + queryGet fix
 * Requires: server on 5151/5152
 */
import { expect } from "chai";
import http from "node:http";

const BASE = { hostname: "localhost", port: 5151 };
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

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
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    const r = http.request({ ...BASE, method, path, headers }, (res) => {
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
    r.on("error", reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

const FW = "/nodefony/test/fw";

// ── @Param ──────────────────────────────────────────────────────────────────

describe("Framework — @Param (integration)", () => {
  it("GET /fw/item/{id} — @Param('id') injecte la valeur", async () => {
    const { status, body } = await req("GET", `${FW}/item/42`);
    expect(status).to.equal(200);
    expect((body as Record<string, unknown>).id).to.equal("42");
  });

  it("@Param avec valeur contenant des lettres", async () => {
    const { status, body } = await req("GET", `${FW}/item/abc-123`);
    expect(status).to.equal(200);
    expect((body as Record<string, unknown>).id).to.equal("abc-123");
  });

  it("GET /fw/items/{cat}/{page} — deux @Param nommés", async () => {
    const { status, body } = await req("GET", `${FW}/items/books/3`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.cat).to.equal("books");
    expect(b.page).to.equal("3");
  });

  it("GET /fw/params-all/{x}/{y} — @Param() sans clé retourne l'objet complet", async () => {
    const { status, body } = await req("GET", `${FW}/params-all/hello/world`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.x).to.equal("hello");
    expect(b.y).to.equal("world");
  });

  it("GET /fw/pos/{name} — variable positionnelle sans @Param", async () => {
    const { status, body } = await req("GET", `${FW}/pos/alice`);
    expect(status).to.equal(200);
    expect((body as Record<string, unknown>).name).to.equal("alice");
  });
});

// ── @Query ───────────────────────────────────────────────────────────────────

describe("Framework — @Query (integration)", () => {
  it("GET /fw/search?q=hello&page=2 — @Query extrait les deux params", async () => {
    const { status, body } = await req("GET", `${FW}/search?q=hello&page=2`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.q).to.equal("hello");
    expect(b.page).to.equal("2");
  });

  it("GET /fw/search?q=only — param manquant est null", async () => {
    const { status, body } = await req("GET", `${FW}/search?q=only`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.q).to.equal("only");
    expect(b.page).to.be.null;
  });

  it("GET /fw/search sans query string — null values", async () => {
    const { status, body } = await req("GET", `${FW}/search`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.q).to.be.null;
    expect(b.page).to.be.null;
  });
});

// ── queryGet fix (url.search.slice(1)) ───────────────────────────────────────

describe("Framework — queryGet premier param (fix Request.ts)", () => {
  it("GET /fw/qs?first=aaa&second=bbb — premier param maintenant correct", async () => {
    const { status, body } = await req("GET", `${FW}/qs?first=aaa&second=bbb`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.first).to.equal("aaa");
    expect(b.second).to.equal("bbb");
  });

  it("GET /fw/qs?first=X — seul le premier param", async () => {
    const { status, body } = await req("GET", `${FW}/qs?first=X`);
    expect(status).to.equal(200);
    expect((body as Record<string, unknown>).first).to.equal("X");
    expect((body as Record<string, unknown>).second).to.be.null;
  });

  it("GET /fw/echo?name=test&page=1 — premier param name correct (fix)", async () => {
    const { status, body } = await req("GET", `${FW}/echo?name=test&page=1`);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.name).to.equal("test");
    expect(b.page).to.equal("1");
  });
});

// ── @Body ────────────────────────────────────────────────────────────────────

describe("Framework — @Body (integration)", () => {
  it("POST /fw/submit — @Body() injecte le body JSON complet", async () => {
    const payload = JSON.stringify({ hello: "world", n: 42 });
    const { status, body } = await req("POST", `${FW}/submit`, payload);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.hello).to.equal("world");
    expect(b.n).to.equal(42);
  });

  it("POST /fw/submit body vide → objet vide", async () => {
    const { status, body } = await req("POST", `${FW}/submit`, "{}");
    expect(status).to.equal(200);
    expect(body).to.deep.equal({});
  });

  it("POST /fw/submit/{type} — @Param + @Body('value') combinés", async () => {
    const payload = JSON.stringify({ value: "premium" });
    const { status, body } = await req("POST", `${FW}/submit/order`, payload);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.type).to.equal("order");
    expect(b.value).to.equal("premium");
  });

  it("POST /fw/submit/{type} sans le champ — value null", async () => {
    const payload = JSON.stringify({ other: "ignored" });
    const { status, body } = await req("POST", `${FW}/submit/invoice`, payload);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.type).to.equal("invoice");
    expect(b.value).to.be.null;
  });
});

// ── @Param + @Body + @Query combinés ─────────────────────────────────────────

describe("Framework — @Param + @Body + @Query combinés (DecoratorController)", () => {
  const DC = "/nodefony/test/decorators";

  it("POST /mix/{id}?v=3 avec body — trois sources injectées", async () => {
    const payload = JSON.stringify({ name: "test-user" });
    const { status, body } = await req("POST", `${DC}/mix/99?v=3`, payload);
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.id).to.equal("99");
    expect(b.name).to.equal("test-user");
    expect(b.v).to.equal("3");
  });

  it("POST /mix/{id} sans query ni champ body — null", async () => {
    const { status, body } = await req("POST", `${DC}/mix/7`, "{}");
    expect(status).to.equal(200);
    const b = body as Record<string, unknown>;
    expect(b.id).to.equal("7");
    expect(b.name).to.be.null;
    expect(b.v).to.be.null;
  });
});
