import { expect } from "chai";
import { Container, Event, RequestContext } from "nodefony";
import type { Injector } from "nodefony";
import Controller from "../../src/Controller.js";
import Resolver from "../../src/Resolver.js";
import Router from "../../service/router.js";
import { Scope } from "../../decorators/routerDecorators.js";
import type Route from "../../src/Route.js";
import type { ControllerConstructor } from "../../src/Route.js";
import type { ContextType } from "@nodefony/http";

// V4.3 — @Scope("singleton") opt-in : une instance partagée pour les
// controllers stateless ; défaut per-request INCHANGÉ. On teste la mécanique
// complète : statique hérité, ctor sans capture, cache Router (promesse =
// anti-race de création), skip setRoute, fallback sans Router.

function makeCtx(tag: string) {
  const container = new Container();
  container.set("template", { render: async () => "" });
  const route = { name: `route-${tag}` } as unknown as Route;
  const ctx = {
    container,
    notificationsCenter: new Event(),
    // Cf `IContext` : le vrai Context instrumente ses phases (le Resolver mesure
    // `initialize` autour de la création du controller).
    phaseStart() {},
    phaseEnd() {},
    request: {
      url: new URL(`http://127.0.0.1/${tag}`),
      query: { q: tag },
      queryGet: {},
      queryFile: [],
      queryPost: {},
      headers: {},
    },
    method: "GET",
    resolver: { route },
    router: null as unknown,
    setContextJson() {},
    send: () => Promise.resolve({}),
  };
  return { ctx: ctx as unknown as ContextType, route };
}

// Router réel via le pattern proxy (Object.create) — getSingletonController
// utilise un champ TS `private` lazy (`== null` guard) exprès pour ce pattern.
function makeRouter(): Router {
  return Object.create(Router.prototype) as Router;
}

const fakeInjector = {
  instantiate: (Ctor: new (c: ContextType) => Controller, c: ContextType) =>
    new Ctor(c),
} as unknown as Injector;

function makeSingletonClass() {
  @Scope("singleton")
  class SingletonCtrl extends Controller {
    static created = 0;
    static initialized = 0;
    constructor(context: ContextType) {
      super("singleton-ctrl", context);
      SingletonCtrl.created++;
    }
    async initialize(): Promise<this> {
      SingletonCtrl.initialized++;
      await new Promise((r) => setTimeout(r, 10));
      return this;
    }
    index() {
      return "singleton-ok";
    }
  }
  return SingletonCtrl;
}

class RequestCtrl extends Controller {
  constructor(context: ContextType) {
    super("request-ctrl", context);
  }
  index() {
    return "request-ok";
  }
}

function makeResolver(
  ctor: ControllerConstructor,
  tag: string,
  router: Router | null,
) {
  const { ctx, route } = makeCtx(tag);
  (ctx as unknown as { router: Router | null }).router = router;
  const r = Object.create(Resolver.prototype) as Resolver;
  r.context = ctx;
  r.injector = fakeInjector;
  r.controller = ctor;
  r.actionName = "index";
  r.route = route;
  r.variables = [];
  return { r, ctx, route };
}

describe("Controller — static scope (V4.3)", () => {
  it("defaults to 'request' and is inherited", () => {
    expect(Controller.scope).to.equal("request");
    expect(RequestCtrl.scope).to.equal("request");
  });

  it("@Scope('singleton') sets the static on the class only", () => {
    const S = makeSingletonClass();
    expect(S.scope).to.equal("singleton");
    expect(Controller.scope).to.equal("request");
    expect(RequestCtrl.scope).to.equal("request");
  });

  it("singleton ctor captures NO per-request state (context from ALS only)", () => {
    const S = makeSingletonClass();
    const { ctx } = makeCtx("boot");
    const c = new S(ctx);
    // Pas de setContext : hors bulle ALS, aucun contexte visible.
    expect(c.context).to.equal(undefined);
    expect(c.session).to.equal(null);
    const { ctx: als } = makeCtx("als");
    RequestContext.run({ requestId: "r", context: als }, () => {
      expect(c.context).to.equal(als);
      expect(c.query).to.deep.equal({ q: "als" });
    });
  });

  it("singleton binds to the kernel container when present", () => {
    const S = makeSingletonClass();
    const { ctx } = makeCtx("boot");
    const kernelContainer = new Container();
    kernelContainer.set("template", { render: async () => "" });
    (ctx as unknown as { kernel: unknown }).kernel = {
      container: kernelContainer,
      notificationsCenter: new Event(),
    };
    const c = new S(ctx);
    expect(c.container).to.equal(kernelContainer);
    // Le per-request reste bindé au container de la requête.
    const { ctx: ctx2 } = makeCtx("req");
    const r = new RequestCtrl(ctx2);
    expect(r.container).to.equal(ctx2.container);
  });
});

describe("Resolver — newController singleton (V4.3)", () => {
  it("returns the SAME instance across resolvers and initializes once", async () => {
    const S = makeSingletonClass();
    const router = makeRouter();
    const a = makeResolver(S as unknown as ControllerConstructor, "a", router);
    const b = makeResolver(S as unknown as ControllerConstructor, "b", router);
    const c1 = await a.r.newController();
    const c2 = await b.r.newController();
    expect(c1).to.equal(c2);
    expect(S.created).to.equal(1);
    expect(S.initialized).to.equal(1);
  });

  it("caches the creation PROMISE — concurrent requests get one instance", async () => {
    const S = makeSingletonClass();
    const router = makeRouter();
    const a = makeResolver(S as unknown as ControllerConstructor, "a", router);
    const b = makeResolver(S as unknown as ControllerConstructor, "b", router);
    const [c1, c2] = await Promise.all([
      a.r.newController(),
      b.r.newController(),
    ]);
    expect(c1).to.equal(c2);
    expect(S.created).to.equal(1);
    expect(S.initialized).to.equal(1);
  });

  it("degrades to per-request creation when no router is available", async () => {
    const S = makeSingletonClass();
    const a = makeResolver(S as unknown as ControllerConstructor, "a", null);
    const b = makeResolver(S as unknown as ControllerConstructor, "b", null);
    const c1 = await a.r.newController();
    const c2 = await b.r.newController();
    expect(c1).to.not.equal(c2);
    expect(S.created).to.equal(2);
  });

  it("executeAction SKIPS setRoute for a singleton (route derives from ALS)", async () => {
    const S = makeSingletonClass();
    const router = makeRouter();
    const a = makeResolver(S as unknown as ControllerConstructor, "a", router);
    const { result } = await a.r.executeAction();
    expect(result).to.equal("singleton-ok");
    const instance = (await a.r.newController()) as Controller;
    // setRoute jamais appelé : hors bulle ALS, aucune route sur l'instance.
    expect(instance.route).to.equal(null);
    // Dans la bulle de la requête, la route dérive du resolver du context.
    RequestContext.run({ requestId: "r", context: a.ctx }, () => {
      expect(instance.route).to.equal(a.route);
    });
  });

  it("executeAction still calls setRoute for per-request controllers", async () => {
    const router = makeRouter();
    const a = makeResolver(
      RequestCtrl as unknown as ControllerConstructor,
      "a",
      router,
    );
    const { result } = await a.r.executeAction();
    expect(result).to.equal("request-ok");
    const instance = a.ctx.container?.get("controller") as Controller;
    expect(instance.route).to.equal(a.route);
  });

  it("reuses the request-container pointer on subsequent messages (WS path)", async () => {
    const S = makeSingletonClass();
    const router = makeRouter();
    const a = makeResolver(S as unknown as ControllerConstructor, "a", router);
    const first = await a.r.newController();
    expect(a.ctx.container?.get("controller")).to.equal(first);
    // 2e executeAction sans reload : prend le pointeur du container, 0 création.
    await a.r.executeAction();
    expect(S.created).to.equal(1);
  });
});
