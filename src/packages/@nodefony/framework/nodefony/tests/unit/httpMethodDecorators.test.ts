import { expect } from "chai";
import "mocha";
import "reflect-metadata";
import Router from "../../service/router.js";
import Controller from "../../src/Controller.js";
import {
  Get,
  Post,
  Put,
  Delete,
  Patch,
  HttpCode,
  Header,
  Redirect,
  controller,
  HTTP_CODE_METADATA,
  HEADERS_METADATA,
  REDIRECT_METADATA,
} from "../../decorators/routerDecorators.js";
import type { ContextType } from "@nodefony/http";

class StubCtrl extends Controller {
  constructor() {
    super("stub", {} as ContextType);
  }
}

// ─── HTTP method decorators ───────────────────────────────────────────────────

describe("HTTP method decorators — route auto-naming", () => {
  afterEach(() => { while (Router.routes.length) Router.routes.pop(); });

  it("@Get registers route with name ClassName::method", () => {
    @controller("/users")
    class UsersCtrl extends StubCtrl {
      @Get()
      index() { return null; }
    }
    void UsersCtrl;
    expect(Router.routes.some((r) => r.name === "UsersCtrl::index")).to.be.true;
  });

  it("@Get sets path correctly with prefix", () => {
    @controller("/api")
    class GetCtrl extends StubCtrl {
      @Get("/list")
      list() { return null; }
    }
    void GetCtrl;
    const r = Router.routes.find((r) => r.name === "GetCtrl::list");
    expect(r?.path).to.equal("/api/list");
  });

  it("@Get restricts to GET method", () => {
    @controller("/gm")
    class GetMethodCtrl extends StubCtrl {
      @Get("/x")
      x() { return null; }
    }
    void GetMethodCtrl;
    const r = Router.routes.find((r) => r.name === "GetMethodCtrl::x");
    expect(r?.requirements?.methods).to.deep.equal(["GET"]);
  });

  it("@Post restricts to POST method", () => {
    @controller("/pm")
    class PostMethodCtrl extends StubCtrl {
      @Post("/create")
      create() { return null; }
    }
    void PostMethodCtrl;
    const r = Router.routes.find((r) => r.name === "PostMethodCtrl::create");
    expect(r?.requirements?.methods).to.deep.equal(["POST"]);
  });

  it("@Put restricts to PUT method", () => {
    @controller("/putm")
    class PutMethodCtrl extends StubCtrl {
      @Put("/:id")
      update() { return null; }
    }
    void PutMethodCtrl;
    const r = Router.routes.find((r) => r.name === "PutMethodCtrl::update");
    expect(r?.requirements?.methods).to.deep.equal(["PUT"]);
  });

  it("@Delete restricts to DELETE method", () => {
    @controller("/delm")
    class DeleteMethodCtrl extends StubCtrl {
      @Delete("/:id")
      del() { return null; }
    }
    void DeleteMethodCtrl;
    const r = Router.routes.find((r) => r.name === "DeleteMethodCtrl::del");
    expect(r?.requirements?.methods).to.deep.equal(["DELETE"]);
  });

  it("@Patch restricts to PATCH method", () => {
    @controller("/patchm")
    class PatchMethodCtrl extends StubCtrl {
      @Patch("/:id")
      patch() { return null; }
    }
    void PatchMethodCtrl;
    const r = Router.routes.find((r) => r.name === "PatchMethodCtrl::patch");
    expect(r?.requirements?.methods).to.deep.equal(["PATCH"]);
  });

  it("multiple HTTP decorators on same class — all registered", () => {
    @controller("/res")
    class ResourceCtrl extends StubCtrl {
      @Get()
      index() { return null; }
      @Post()
      create() { return null; }
      @Delete("/:id")
      destroy() { return null; }
    }
    void ResourceCtrl;
    expect(Router.routes.some((r) => r.name === "ResourceCtrl::index")).to.be.true;
    expect(Router.routes.some((r) => r.name === "ResourceCtrl::create")).to.be.true;
    expect(Router.routes.some((r) => r.name === "ResourceCtrl::destroy")).to.be.true;
  });

  it("route has compiled RegExp pattern", () => {
    @controller("/compile")
    class CompileCtrl extends StubCtrl {
      @Get("/item/{id}")
      show() { return null; }
    }
    void CompileCtrl;
    const r = Router.routes.find((r) => r.name === "CompileCtrl::show");
    expect(r?.pattern).to.be.instanceof(RegExp);
  });
});

// ─── @HttpCode ────────────────────────────────────────────────────────────────

describe("@HttpCode — metadata storage", () => {
  it("stores statusCode metadata on method", () => {
    class HttpCodeCtrl extends StubCtrl {
      @HttpCode(201)
      create() { return null; }
    }
    const code = Reflect.getMetadata(HTTP_CODE_METADATA, HttpCodeCtrl.prototype, "create");
    expect(code).to.equal(201);
  });

  it("different methods have independent metadata", () => {
    class MultiCodeCtrl extends StubCtrl {
      @HttpCode(201)
      create() { return null; }
      @HttpCode(204)
      del() { return null; }
    }
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, MultiCodeCtrl.prototype, "create")).to.equal(201);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, MultiCodeCtrl.prototype, "del")).to.equal(204);
  });

  it("method without @HttpCode has no metadata", () => {
    class NoneCtrl extends StubCtrl {
      plain() { return null; }
    }
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, NoneCtrl.prototype, "plain")).to.be.undefined;
  });
});

// ─── @Header ─────────────────────────────────────────────────────────────────

describe("@Header — metadata storage", () => {
  it("stores single header", () => {
    class SingleHeaderCtrl extends StubCtrl {
      @Header("X-Cache", "HIT")
      index() { return null; }
    }
    const headers = Reflect.getMetadata(HEADERS_METADATA, SingleHeaderCtrl.prototype, "index");
    expect(headers).to.deep.equal({ "X-Cache": "HIT" });
  });

  it("accumulates multiple @Header decorators", () => {
    class MultiHeaderCtrl extends StubCtrl {
      @Header("X-Custom-A", "alpha")
      @Header("X-Custom-B", "beta")
      index() { return null; }
    }
    const headers = Reflect.getMetadata(HEADERS_METADATA, MultiHeaderCtrl.prototype, "index");
    expect(headers).to.include({ "X-Custom-A": "alpha", "X-Custom-B": "beta" });
  });

  it("different methods have independent header metadata", () => {
    class IndepHeaderCtrl extends StubCtrl {
      @Header("X-One", "1")
      a() { return null; }
      @Header("X-Two", "2")
      b() { return null; }
    }
    const ha = Reflect.getMetadata(HEADERS_METADATA, IndepHeaderCtrl.prototype, "a");
    const hb = Reflect.getMetadata(HEADERS_METADATA, IndepHeaderCtrl.prototype, "b");
    expect(ha).to.deep.equal({ "X-One": "1" });
    expect(hb).to.deep.equal({ "X-Two": "2" });
  });
});

// ─── @Redirect ───────────────────────────────────────────────────────────────

describe("@Redirect — metadata storage", () => {
  it("stores redirect url and default 302 status", () => {
    class RedirectCtrl extends StubCtrl {
      @Redirect("/home")
      old() { return null; }
    }
    const meta = Reflect.getMetadata(REDIRECT_METADATA, RedirectCtrl.prototype, "old");
    expect(meta).to.deep.equal({ url: "/home", statusCode: 302 });
  });

  it("stores custom statusCode", () => {
    class MovedCtrl extends StubCtrl {
      @Redirect("/new", 301)
      moved() { return null; }
    }
    const meta = Reflect.getMetadata(REDIRECT_METADATA, MovedCtrl.prototype, "moved");
    expect(meta).to.deep.equal({ url: "/new", statusCode: 301 });
  });

  it("different methods have independent redirect metadata", () => {
    class MultiRedirCtrl extends StubCtrl {
      @Redirect("/a")
      toA() { return null; }
      @Redirect("/b", 301)
      toB() { return null; }
    }
    expect(Reflect.getMetadata(REDIRECT_METADATA, MultiRedirCtrl.prototype, "toA"))
      .to.deep.equal({ url: "/a", statusCode: 302 });
    expect(Reflect.getMetadata(REDIRECT_METADATA, MultiRedirCtrl.prototype, "toB"))
      .to.deep.equal({ url: "/b", statusCode: 301 });
  });
});

// ─── Combined decorators ──────────────────────────────────────────────────────

describe("Combined decorators — @Post + @HttpCode + @Header", () => {
  afterEach(() => { while (Router.routes.length) Router.routes.pop(); });

  it("@Post + @HttpCode — route registered, metadata correct", () => {
    @controller("/combo")
    class ComboCtrl extends StubCtrl {
      @HttpCode(201)
      @Post("/items")
      create() { return null; }
    }
    void ComboCtrl;
    const r = Router.routes.find((r) => r.name === "ComboCtrl::create");
    expect(r).to.exist;
    expect(r?.requirements?.methods).to.deep.equal(["POST"]);
    const code = Reflect.getMetadata(HTTP_CODE_METADATA, ComboCtrl.prototype, "create");
    expect(code).to.equal(201);
  });

  it("@Get + @Header — route registered, header metadata correct", () => {
    @controller("/hdr")
    class HdrComboCtrl extends StubCtrl {
      @Header("Cache-Control", "no-cache")
      @Get("/data")
      data() { return null; }
    }
    void HdrComboCtrl;
    const r = Router.routes.find((r) => r.name === "HdrComboCtrl::data");
    expect(r).to.exist;
    const headers = Reflect.getMetadata(HEADERS_METADATA, HdrComboCtrl.prototype, "data");
    expect(headers).to.deep.equal({ "Cache-Control": "no-cache" });
  });
});
