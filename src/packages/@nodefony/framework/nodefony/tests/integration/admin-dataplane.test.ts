/// <reference types="node" />
/**
 * Integration tests — data plane admin (IAdminApi / AdminBroker) via HTTPS.
 * Requires: server running on 5152 (HTTPS).
 * Start: /start-nodefony-server
 *
 * Couvre la chaîne complète (broker → AdminApiController → producteurs) ET les
 * régressions des 2 bugs trouvés en testant la regexp paramétrée :
 *  - extraction de params `{name}` (route.variables string[])
 *  - enveloppe IAdminResponse non double-wrappée
 */
import { expect } from "chai";
import https from "node:https";

const HTTPS_BASE = {
  hostname: "localhost",
  port: 5152,
  rejectUnauthorized: false,
};
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function req(method: string, path: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...HTTPS_BASE, method, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let body: unknown = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          /* keep raw */
        }
        resolve({
          status: res.statusCode!,
          headers: res.headers as Record<string, unknown>,
          body,
        });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

// ── kernel ───────────────────────────────────────────────────────────────────

describe("Admin data plane — kernel", () => {
  it("GET /nodefony/kernel/api/health → 200 liveness", async () => {
    const r = await req("GET", "/nodefony/kernel/api/health");
    expect(r.status).to.equal(200);
    const b = r.body as Record<string, unknown>;
    expect(b.status).to.be.a("string");
    expect(b.booted).to.equal(true);
    expect(b.uptime).to.be.a("number");
    expect(b.pid).to.be.a("number");
  });

  it("GET /nodefony/kernel/api/info → 200 runtime identity", async () => {
    const r = await req("GET", "/nodefony/kernel/api/info");
    expect(r.status).to.equal(200);
    const b = r.body as Record<string, unknown>;
    expect(b.version).to.be.a("string");
    expect(b.environment).to.be.a("string");
    expect(b.modules).to.be.a("number");
  });

  it("GET /nodefony/kernel/api/modules → 200 array of modules", async () => {
    const r = await req("GET", "/nodefony/kernel/api/modules");
    expect(r.status).to.equal(200);
    expect(r.body).to.be.an("array");
    expect((r.body as Array<Record<string, unknown>>)[0].key).to.be.a("string");
  });

  // ── REGRESSION: regexp param {name} + extraction ──────────────────────────
  it("GET /nodefony/kernel/api/module/{name} → 200, param extrait", async () => {
    const r = await req("GET", "/nodefony/kernel/api/module/http");
    expect(r.status).to.equal(200);
    const b = r.body as Record<string, unknown>;
    expect(b.key).to.equal("http");
    expect(b.name).to.equal("@nodefony/http");
  });

  // ── REGRESSION: enveloppe non double-wrappée ──────────────────────────────
  it("module/{name} success n'est PAS double-wrappé (pas de .body imbriqué)", async () => {
    const r = await req("GET", "/nodefony/kernel/api/module/framework");
    expect(r.body).to.not.have.property("body");
  });

  it("GET module/{inexistant} → 404 enveloppe IAdminResponse", async () => {
    const r = await req("GET", "/nodefony/kernel/api/module/zzz-nope");
    expect(r.status).to.equal(404);
    const b = r.body as Record<string, unknown>;
    expect(b.error).to.be.a("string");
    expect(b.key).to.equal("zzz-nope");
  });

  it("réponse admin porte le header x-nodefony-instance (per-instance)", async () => {
    const r = await req("GET", "/nodefony/kernel/api/health");
    expect(r.headers["x-nodefony-instance"]).to.be.a("string");
  });

  it("POST sur une route GET → 405 (RFC 9110 via Router)", async () => {
    const r = await req("POST", "/nodefony/kernel/api/health");
    expect(r.status).to.equal(405);
  });
});

// ── http ─────────────────────────────────────────────────────────────────────

describe("Admin data plane — http", () => {
  it("GET /nodefony/http/api/servers → liste serveurs + ports", async () => {
    const r = await req("GET", "/nodefony/http/api/servers");
    expect(r.status).to.equal(200);
    const servers = r.body as Array<Record<string, unknown>>;
    expect(servers.some((s) => s.service === "server-http" && s.port === 5151))
      .to.be.true;
  });

  it("GET /nodefony/http/api/info → résumé serveurs prêts", async () => {
    const r = await req("GET", "/nodefony/http/api/info");
    expect(r.status).to.equal(200);
    expect((r.body as Record<string, unknown>).serversReady).to.be.a("number");
  });

  it("GET /nodefony/http/api/sessions → état + flag deprecated", async () => {
    const r = await req("GET", "/nodefony/http/api/sessions");
    expect(r.status).to.equal(200);
    const b = r.body as Record<string, unknown>;
    expect(b.deprecated).to.equal(true);
    // active = nombre (storage fichier) ou null
    expect(b.active === null || typeof b.active === "number").to.be.true;
  });
});

// ── framework ──────────────────────────────────────────────────────────────

describe("Admin data plane — framework", () => {
  it("GET /nodefony/framework/api/routes → dump contient les routes admin", async () => {
    const r = await req("GET", "/nodefony/framework/api/routes");
    expect(r.status).to.equal(200);
    const routes = r.body as Array<Record<string, unknown>>;
    expect(routes.some((x) => x.path === "/nodefony/kernel/api/health")).to.be
      .true;
  });

  it("GET /nodefony/framework/api/info → routesTotal > 0", async () => {
    const r = await req("GET", "/nodefony/framework/api/info");
    expect(r.status).to.equal(200);
    expect((r.body as Record<string, unknown>).routesTotal).to.be.a("number");
  });

  it("GET /nodefony/framework/api/admin → catalogue des 4 producteurs", async () => {
    const r = await req("GET", "/nodefony/framework/api/admin");
    expect(r.status).to.equal(200);
    const producers = (r.body as { producers: Array<Record<string, unknown>> })
      .producers;
    const namespaces = producers.map((p) => p.namespace);
    expect(namespaces).to.include.members([
      "kernel",
      "http",
      "framework",
      "syslog",
    ]);
    // descriptors + endpoints exploitables par la nav Studio
    const kernel = producers.find((p) => p.namespace === "kernel")!;
    expect(kernel.label).to.equal("Kernel");
    expect(kernel.endpoints).to.be.an("array");
    const eps = kernel.endpoints as Array<Record<string, unknown>>;
    expect(eps.some((e) => e.path === "/nodefony/kernel/api/health")).to.be
      .true;
    // ordonné par descriptor.order croissant
    const orders = producers.map((p) => p.order as number);
    expect(orders).to.deep.equal([...orders].sort((a, b) => a - b));
  });
});

// ── syslog ───────────────────────────────────────────────────────────────────

describe("Admin data plane — syslog", () => {
  it("GET /nodefony/syslog/api/info → compteurs", async () => {
    const r = await req("GET", "/nodefony/syslog/api/info");
    expect(r.status).to.equal(200);
    expect((r.body as Record<string, unknown>).valid).to.be.a("number");
  });

  it("GET /nodefony/syslog/api/logs?limit=3 → ≤ 3 entrées", async () => {
    const r = await req("GET", "/nodefony/syslog/api/logs?limit=3");
    expect(r.status).to.equal(200);
    expect(r.body).to.be.an("array");
    expect((r.body as unknown[]).length).to.be.at.most(3);
  });
});

// ── SPA fallback ne masque PAS les vraies routes /nodefony/* (régression) ──────
// Le fallback deep-link Studio doit utiliser un préfixe LITTÉRAL (`/modules/{name}`),
// pas un générique `/{section}/{page}` : sinon il masque les routes des autres
// modules montées sous `/nodefony/<x>/<y>` (ex le module test `/nodefony/test/index`).
// Régression vécue 2026-05-20 (fallback générique → 21 échecs http). Requiert
// studio + module test chargés (app dev).

describe("Admin data plane — SPA fallback vs vraies routes (non-shadow)", () => {
  it("GET /nodefony/modules/core → 200 HTML (deep-link SPA, fallback littéral /modules/{name})", async () => {
    const r = await req("GET", "/nodefony/modules/core");
    expect(r.status).to.equal(200);
    expect(r.body, "le SPA renvoie du HTML brut, pas du JSON").to.be.a(
      "string",
    );
    expect(r.body as string).to.include("<!DOCTYPE");
  });

  it("GET /nodefony/kernel/api/info → 200 JSON (route ≥3 seg NON masquée)", async () => {
    const r = await req("GET", "/nodefony/kernel/api/info");
    expect(r.status).to.equal(200);
    expect(r.body, "la route data plane gagne → JSON").to.be.an("object");
    expect((r.body as Record<string, unknown>).version).to.be.a("string");
  });

  it("GET /nodefony/test/index → JSON (route 2-seg d'un AUTRE module NON masquée par le fallback)", async () => {
    const r = await req("GET", "/nodefony/test/index");
    expect(r.status).to.equal(200);
    expect(r.body, "le module test gagne → JSON, pas le HTML du SPA").to.be.an(
      "object",
    );
  });
});
