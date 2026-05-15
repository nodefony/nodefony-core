import { expect } from "chai";
import "mocha";
import "reflect-metadata";
import Router from "../../service/router.js";
import Controller from "../../src/Controller.js";
import { route, controller } from "../../decorators/routerDecorators.js";
import type { ContextType } from "@nodefony/http";

// Classe de base stub — pas instanciée dans ces tests (décorateurs évalués à la définition)
class StubController extends Controller {
  constructor() {
    super("stub", {} as ContextType);
  }
}

// ─── @route + @controller ─────────────────────────────────────────────────────

describe("routerDecorators — @route + @controller", () => {
  afterEach(() => { while (Router.routes.length) Router.routes.pop(); });

  it("@controller creates route in Router.routes", () => {
    @controller("/deco")
    class DecoCtrl extends StubController {
      @route("deco-index", { path: "/index" })
      deco_index() { return null; }
    }
    void DecoCtrl;
    const found = Router.routes.find((r) => r.name === "deco-index");
    expect(found).to.exist;
    expect(found?.path).to.equal("/deco/index");
  });

  it("route prefix is applied from @controller", () => {
    @controller("/api/v1")
    class ApiCtrl extends StubController {
      @route("apiv1-hello", { path: "/hello" })
      apiv1_hello() { return null; }
    }
    void ApiCtrl;
    const r = Router.routes.find((r) => r.name === "apiv1-hello");
    expect(r?.path).to.equal("/api/v1/hello");
  });

  it("multiple @route on same class — all registered", () => {
    @controller("/multi")
    class MultiCtrl extends StubController {
      @route("multi-a", { path: "/a" })
      multi_a() { return null; }
      @route("multi-b", { path: "/b" })
      multi_b() { return null; }
    }
    void MultiCtrl;
    expect(Router.routes.some((r) => r.name === "multi-a")).to.be.true;
    expect(Router.routes.some((r) => r.name === "multi-b")).to.be.true;
  });

  it("@controller deletes reflect metadata after processing", () => {
    @controller("/clean")
    class CleanCtrl extends StubController {
      @route("clean-index", { path: "/" })
      clean_index() { return null; }
    }
    expect(Reflect.getMetadata("routes:definitions", CleanCtrl)).to.be.undefined;
  });

  it("route has compiled pattern after @controller", () => {
    @controller("/pat")
    class PatCtrl extends StubController {
      @route("pat-index", { path: "/item/{id}" })
      pat_index() { return null; }
    }
    void PatCtrl;
    const r = Router.routes.find((r) => r.name === "pat-index");
    expect(r?.pattern).to.be.instanceof(RegExp);
    expect(r?.variables).to.deep.equal(["id"]);
  });
});
