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

// ─── route magic '*' (catch-all) ──────────────────────────────────────────────
// Le décorateur @controller traite `path == "*"` comme route "magic" : elle est
// créée APRÈS toutes les autres routes du controller (registered last), pour ne
// pas masquer les routes spécifiques sœurs.

describe("routerDecorators — route magic '*'", () => {
  afterEach(() => { while (Router.routes.length) Router.routes.pop(); });

  it("la route magic (path '*') est enregistrée EN DERNIER, après les routes spécifiques", () => {
    @controller("/mg")
    class MgCtrl extends StubController {
      @route("mg-a", { path: "/a" })
      mg_a() { return null; }
      @route("mg-catch", { path: "*" })
      mg_catch() { return null; }
      @route("mg-b", { path: "/b" })
      mg_b() { return null; }
    }
    void MgCtrl;
    const names = Router.routes.map((r) => r.name);
    const idxCatch = names.indexOf("mg-catch");
    expect(idxCatch).to.be.greaterThan(names.indexOf("mg-a"));
    expect(idxCatch).to.be.greaterThan(names.indexOf("mg-b"));
  });

  it("la route magic compile en wildcard `/<prefix>/*` (matche tout suffixe profond)", () => {
    @controller("/mg2")
    class Mg2Ctrl extends StubController {
      @route("mg2-catch", { path: "*" })
      mg2_catch() { return null; }
    }
    void Mg2Ctrl;
    const r = Router.routes.find((x) => x.name === "mg2-catch");
    expect(r?.path).to.equal("/mg2/*");
    expect(r?.pattern!.test("/mg2/any/deep/path")).to.be.true;
  });
});

// ─── @Param / @Body / @Query ──────────────────────────────────────────────────
import {
  Param,
  Body,
  Query,
  PARAM_ARGS_METADATA,
  type ParamMeta,
} from "../../decorators/routerDecorators.js";

describe("routerDecorators — @Param / @Body / @Query", () => {
  it("@Param stores source=param with key on method metadata", () => {
    class C extends StubController {
      getItem(@Param("id") _id: string) { return _id; }
    }
    const metas: ParamMeta[] = Reflect.getMetadata(PARAM_ARGS_METADATA, C.prototype, "getItem");
    expect(metas).to.have.lengthOf(1);
    expect(metas[0]).to.deep.equal({ source: "param", key: "id", index: 0 });
  });

  it("@Param without key stores undefined key", () => {
    class C extends StubController {
      listAll(@Param() _all: Record<string, unknown>) { return _all; }
    }
    const metas: ParamMeta[] = Reflect.getMetadata(PARAM_ARGS_METADATA, C.prototype, "listAll");
    expect(metas[0].source).to.equal("param");
    expect(metas[0].key).to.be.undefined;
  });

  it("@Body stores source=body with key", () => {
    class C extends StubController {
      create(@Body("name") _name: string) { return _name; }
    }
    const metas: ParamMeta[] = Reflect.getMetadata(PARAM_ARGS_METADATA, C.prototype, "create");
    expect(metas[0]).to.deep.equal({ source: "body", key: "name", index: 0 });
  });

  it("@Query stores source=query with key and correct index", () => {
    class C extends StubController {
      search(_x: string, @Query("page") _page: string) { return _x + _page; }
    }
    const metas: ParamMeta[] = Reflect.getMetadata(PARAM_ARGS_METADATA, C.prototype, "search");
    expect(metas[0]).to.deep.equal({ source: "query", key: "page", index: 1 });
  });

  it("multiple param decorators on same method", () => {
    class C extends StubController {
      update(
        @Param("id") _id: string,
        @Body("payload") _payload: unknown,
        @Query("sort") _sort: string
      ) { return [_id, _payload, _sort]; }
    }
    const metas: ParamMeta[] = Reflect.getMetadata(PARAM_ARGS_METADATA, C.prototype, "update");
    expect(metas).to.have.lengthOf(3);
    const byIndex = metas.sort((a, b) => a.index - b.index);
    expect(byIndex[0]).to.deep.equal({ source: "param", key: "id", index: 0 });
    expect(byIndex[1]).to.deep.equal({ source: "body", key: "payload", index: 1 });
    expect(byIndex[2]).to.deep.equal({ source: "query", key: "sort", index: 2 });
  });
});
