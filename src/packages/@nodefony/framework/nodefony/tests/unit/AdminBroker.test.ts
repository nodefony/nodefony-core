/// <reference types="node" />
/**
 * Unit tests — AdminBroker (data plane admin) — registry + montage.
 *
 * AdminBroker étend Service (constructeur = Module complet). On l'instancie via
 * un proxy `Object.create` + init manuelle des champs (même technique que
 * Router.test.ts) pour tester la logique sans booter un kernel.
 */
import { expect } from "chai";
import "mocha";
import AdminBroker from "../../service/AdminBroker.js";
import Router from "../../service/router.js";
import type { IAdminApi, IAdminEndpoint } from "nodefony";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeBroker(): AdminBroker {
  const b = Object.create(AdminBroker.prototype) as unknown as Record<string, unknown>;
  b.producers = new Map();
  b.byRouteName = new Map();
  b.mounted = false;
  b.frameworkModule = { name: "framework", log() {} };
  b.rootPrefix = "/nodefony";
  b.apiSegment = "api";
  b.defaultRole = "ROLE_NODEFONY_ADMIN";
  b.log = () => {};
  return b as unknown as AdminBroker;
}

function fakeApi(ns: string, endpoints: IAdminEndpoint[] = []): IAdminApi {
  return {
    adminNamespace: ns,
    adminDescriptor: () => ({ label: ns }),
    adminEndpoints: () => endpoints,
  };
}

function cleanupAdminRoutes(): void {
  for (let i = Router.routes.length - 1; i >= 0; i--) {
    if (Router.routes[i].name.startsWith("admin.")) Router.routes.splice(i, 1);
  }
}

// ── registry ───────────────────────────────────────────────────────────────

describe("AdminBroker — registry", () => {
  it("register() stores the producer and returns this", () => {
    const b = makeBroker();
    const api = fakeApi("kernel");
    expect(b.register(api)).to.equal(b);
    expect(b.has("kernel")).to.be.true;
    expect(b.getApi("kernel")).to.equal(api);
  });

  it("register() throws on duplicate namespace", () => {
    const b = makeBroker();
    b.register(fakeApi("http"));
    expect(() => b.register(fakeApi("http"))).to.throw(/déjà enregistré/);
  });

  it("has() is false for unknown namespace", () => {
    expect(makeBroker().has("nope")).to.be.false;
  });

  it("list() returns all registered producers", () => {
    const b = makeBroker();
    b.register(fakeApi("a")).register(fakeApi("b"));
    expect(b.list().map((p) => p.adminNamespace)).to.have.members(["a", "b"]);
  });

  it("unregister() removes a producer (before mount)", () => {
    const b = makeBroker();
    b.register(fakeApi("x"));
    expect(b.unregister("x")).to.be.true;
    expect(b.has("x")).to.be.false;
    expect(b.unregister("x")).to.be.false;
  });
});

// ── resolvePath ──────────────────────────────────────────────────────────────

describe("AdminBroker — resolvePath()", () => {
  it("builds /nodefony/<ns>/api/<path>", () => {
    expect(makeBroker().resolvePath("kernel", "health")).to.equal(
      "/nodefony/kernel/api/health",
    );
  });

  it("strips a leading slash on the endpoint path", () => {
    expect(makeBroker().resolvePath("http", "/servers")).to.equal(
      "/nodefony/http/api/servers",
    );
  });

  it("supports route variables in the path", () => {
    expect(makeBroker().resolvePath("kernel", "module/{name}")).to.equal(
      "/nodefony/kernel/api/module/{name}",
    );
  });
});

// ── mountAll ─────────────────────────────────────────────────────────────────

describe("AdminBroker — mountAll()", () => {
  afterEach(cleanupAdminRoutes);

  it("creates one Router route per endpoint + indexes them (resolve O(1)) + idempotent", () => {
    const b = makeBroker();
    const ep: IAdminEndpoint[] = [
      { path: "ping", handler: () => ({ ok: true }) },
      { path: "items/{id}", method: "POST", role: "ROLE_X", handler: () => null },
    ];
    b.register(fakeApi("demo", ep));
    b.mountAll();

    // routes créées dans le Router
    const ping = Router.routes.find((r) => r.name === "admin.demo.GET.ping");
    const items = Router.routes.find((r) => r.name === "admin.demo.POST.items/{id}");
    expect(ping?.path).to.equal("/nodefony/demo/api/ping");
    expect(items?.path).to.equal("/nodefony/demo/api/items/{id}");

    // index resolve() + défauts (method GET, role défaut)
    const rPing = b.resolve("admin.demo.GET.ping");
    expect(rPing?.namespace).to.equal("demo");
    expect(rPing?.method).to.equal("GET");
    expect(rPing?.role).to.equal("ROLE_NODEFONY_ADMIN");
    expect(b.resolve("admin.demo.POST.items/{id}")?.role).to.equal("ROLE_X");

    // routes() reflète l'index
    expect(b.routes()).to.have.length(2);

    // idempotence — second mountAll = no-op (pas de doublon)
    b.mountAll();
    expect(Router.routes.filter((r) => r.name.startsWith("admin.demo."))).to.have.length(2);
  });

  it("register() after mountAll throws (routes figées)", () => {
    const b = makeBroker();
    b.register(fakeApi("locked", [{ path: "x", handler: () => 1 }]));
    b.mountAll();
    expect(() => b.register(fakeApi("late"))).to.throw(/mountAll/);
  });
});
