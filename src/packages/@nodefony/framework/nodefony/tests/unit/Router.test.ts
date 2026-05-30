import { expect } from "chai";
import "mocha";
import { Module } from "nodefony";
import Router, { type TypeController } from "../../service/router.js";
import Route, { type ControllerConstructor } from "../../src/Route.js";
import type Controller from "../../src/Controller.js";

// Router.routes est un tableau statique module-level.
// Router.prototype.{getRoutes,removeRoutes,matchRoutes} utilisent this.routes.
// On passe { routes: Router.routes } comme "this" pour tester sans instancier Router
// (qui nécessiterait un Module complet).
function proxy(): Router {
  const p = Object.create(Router.prototype) as Router;
  p.routes = Router.routes;
  return p;
}

function uniqueName(base: string): string {
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanup(name: string): void {
  const idx = Router.routes.findIndex((r) => r.name === name);
  if (idx !== -1) Router.routes.splice(idx, 1);
}

// ─── createRoute ──────────────────────────────────────────────────────────────

describe("Router — createRoute()", () => {
  const names: string[] = [];
  afterEach(() => {
    names.splice(0).forEach(cleanup);
  });

  it("returns a Route instance", () => {
    const n = uniqueName("r");
    names.push(n);
    expect(Router.createRoute(n, { path: "/test" })).to.be.instanceof(Route);
  });

  it("registers route in Router.routes", () => {
    const n = uniqueName("r");
    names.push(n);
    Router.createRoute(n, { path: "/test" });
    expect(Router.routes.some((r) => r.name === n)).to.be.true;
  });

  it("route has correct name and path", () => {
    const n = uniqueName("r");
    names.push(n);
    Router.createRoute(n, { path: "/my-path" });
    const found = Router.routes.find((r) => r.name === n);
    expect(found?.name).to.equal(n);
    expect(found?.path).to.equal("/my-path");
  });

  it("route with prefix is correctly assembled", () => {
    const n = uniqueName("r");
    names.push(n);
    Router.createRoute(n, { path: "detail", prefix: "/items" });
    const found = Router.routes.find((r) => r.name === n);
    expect(found?.path).to.equal("/items/detail");
  });
});

// ─── getRoutes ────────────────────────────────────────────────────────────────

describe("Router — getRoutes()", () => {
  let name: string;
  beforeEach(() => {
    name = uniqueName("g");
    Router.createRoute(name, { path: "/x" });
  });
  afterEach(() => cleanup(name));

  it("finds route by name", () => {
    const r = proxy().getRoutes(name);
    expect((r as Route)?.name).to.equal(name);
  });

  it("returns array when no name given", () => {
    const all = proxy().getRoutes("");
    expect(all).to.be.an("array");
  });
});

// ─── removeRoutes ─────────────────────────────────────────────────────────────

describe("Router — removeRoutes()", () => {
  it("removes a route by name", () => {
    const n = uniqueName("rm");
    Router.createRoute(n, { path: "/rm" });
    proxy().removeRoutes(n);
    expect(Router.routes.some((r) => r.name === n)).to.be.false;
  });

  it("throws when route name not found", () => {
    expect(() => proxy().removeRoutes("__not_found__")).to.throw();
  });

  it("clears all routes when empty string given", () => {
    const n1 = uniqueName("a1");
    const n2 = uniqueName("a2");
    Router.createRoute(n1, { path: "/a1" });
    Router.createRoute(n2, { path: "/a2" });
    proxy().removeRoutes("");
    expect(Router.routes).to.have.lengthOf(0);
  });
});

// ─── matchRoutes ──────────────────────────────────────────────────────────────

describe("Router — matchRoutes()", () => {
  let name: string;
  beforeEach(() => {
    name = uniqueName("m");
    Router.createRoute(name, { path: "/ping" });
  });
  afterEach(() => cleanup(name));

  it("returns matches for registered path", () => {
    expect(proxy().matchRoutes("/ping").length).to.be.greaterThan(0);
  });

  it("returns empty array for non-matching path", () => {
    expect(proxy().matchRoutes("/no-such-xyz"))
      .to.be.an("array")
      .with.lengthOf(0);
  });
});

// ─── getRoutesForController ────────────────────────────────────────────────────

describe("Router — getRoutesForController()", () => {
  it("returns only the routes owned by the given controller", () => {
    const ctor = class GcCtrl {} as unknown as TypeController<Controller>;
    const n = uniqueName("gc");
    const route = Router.createRoute(n, { path: "/gc" });
    route.controller = ctor as unknown as ControllerConstructor;
    const found = Router.getRoutesForController(ctor);
    expect(found.some((r) => r.name === n)).to.be.true;
    expect(found.every((r) => r.controller === ctor)).to.be.true;
    cleanup(n);
  });

  it("returns an empty array for an unknown controller", () => {
    const ctor = class NoneCtrl {} as unknown as TypeController<Controller>;
    expect(Router.getRoutesForController(ctor)).to.have.lengthOf(0);
  });
});

// ─── setController ─────────────────────────────────────────────────────────────

describe("Router — setController()", () => {
  const registry = Module.controllers as Record<string, unknown>;

  it("registers the controller and propagates the module to its routes", () => {
    const ctor = class SetCtrl {} as unknown as TypeController<Controller>;
    const key = (ctor as unknown as { name: string }).name;
    const logs: unknown[][] = [];
    const mod = {
      name: "test-mod",
      log: (...a: unknown[]) => logs.push(a),
    } as unknown as Module;
    const n = uniqueName("sc");
    const route = Router.createRoute(n, { path: "/sc" });
    route.controller = ctor as unknown as ControllerConstructor;

    Router.setController(ctor, mod);

    expect(registry[key]).to.equal(ctor);
    expect(route.module?.name).to.equal("test-mod");

    delete registry[key];
    cleanup(n);
  });
});
