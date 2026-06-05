import { expect } from "chai";
import { Container } from "nodefony";
import Resolver from "../../src/Resolver.js";
import type Route from "../../src/Route.js";
import type { ControllerConstructor } from "../../src/Route.js";
import type { ContextType } from "@nodefony/http";

// Proxy : on teste les méthodes « pures » du Resolver sans l'instancier — son
// ctor exige un Context complet + Container DI. On crée l'objet via
// Object.create(prototype) et on n'injecte QUE les champs touchés par la méthode
// (même technique que Router.test.ts).
function proxy(): Resolver {
  return Object.create(Resolver.prototype) as Resolver;
}

// Fake Context minimal : seules les méthodes touchées par returnController.
// `type` distingue HTTP de WebSocket. ⚠️ un WebsocketContext n'expose PAS
// `sended` (propre à HttpContext) → on le laisse `undefined` en WS pour refléter
// le vrai comportement (le retour object d'un handler WS doit être ENVOYÉ, pas
// droppé — cf realtime `return { type: "pong" }`).
function makeCtx(type: "http" | "websocket" = "http") {
  const calls = { send: [] as unknown[], render: [] as unknown[], json: 0 };
  const ctx = {
    type,
    sended: type === "http" ? false : undefined,
    waitAsync: false,
    setContextJson() {
      calls.json++;
    },
    send(chunk?: unknown) {
      calls.send.push(chunk);
      return Promise.resolve({});
    },
    render(chunk?: unknown) {
      calls.render.push(chunk);
      return Promise.resolve({});
    },
  };
  return { ctx, calls };
}

// ─── getMatchedParams ───────────────────────────────────────────────────────

describe("Resolver — getMatchedParams()", () => {
  it("zips route variable names with matched values", () => {
    const r = proxy();
    r.route = { variables: ["id", "name"] } as unknown as Route;
    r.variables = ["42", "bob"];
    expect(r.getMatchedParams()).to.deep.equal({ id: "42", name: "bob" });
  });

  it("returns empty object when route has no variables", () => {
    const r = proxy();
    r.route = { variables: [] } as unknown as Route;
    r.variables = [];
    expect(r.getMatchedParams()).to.deep.equal({});
  });

  it("exposes the wildcard capture under '*'", () => {
    const r = proxy();
    r.route = { variables: [] } as unknown as Route;
    const vars = [] as unknown as string[] & Record<string, unknown>;
    vars["*"] = "rest/of/path";
    r.variables = vars;
    expect(r.getMatchedParams()["*"]).to.equal("rest/of/path");
  });

  it("does not add '*' when no wildcard was captured", () => {
    const r = proxy();
    r.route = { variables: ["id"] } as unknown as Route;
    r.variables = ["7"];
    expect(r.getMatchedParams()).to.not.have.property("*");
  });
});

// ─── returnController ─────────────────────────────────────────────────────────

describe("Resolver — returnController() — HTTP context", () => {
  it("sends a string result directly", async () => {
    const r = proxy();
    const { ctx, calls } = makeCtx();
    r.context = ctx as unknown as ContextType;
    await r.returnController("hello");
    expect(calls.send).to.deep.equal(["hello"]);
    expect(calls.render).to.have.lengthOf(0);
  });

  it("auto-JSON a plain object (setContextJson + render)", async () => {
    const r = proxy();
    const { ctx, calls } = makeCtx();
    r.context = ctx as unknown as ContextType;
    await r.returnController({ a: 1 });
    expect(calls.json).to.equal(1);
    expect(calls.render).to.deep.equal([{ a: 1 }]);
  });

  it("auto-JSON an array (setContextJson + render)", async () => {
    const r = proxy();
    const { ctx, calls } = makeCtx();
    r.context = ctx as unknown as ContextType;
    await r.returnController([1, 2, 3]);
    expect(calls.json).to.equal(1);
    expect(calls.render).to.deep.equal([[1, 2, 3]]);
  });

  it("no-ops when the response was already sent", async () => {
    const r = proxy();
    const { ctx, calls } = makeCtx();
    ctx.sended = true;
    r.context = ctx as unknown as ContextType;
    const res = await r.returnController({ a: 1 });
    expect(res).to.be.undefined;
    expect(calls.render).to.have.lengthOf(0);
    expect(calls.json).to.equal(0);
  });

  it("unwraps a Promise then re-dispatches the resolved value", async () => {
    const r = proxy();
    const { ctx, calls } = makeCtx();
    r.context = ctx as unknown as ContextType;
    await r.returnController(Promise.resolve("deferred"));
    expect(calls.send).to.deep.equal(["deferred"]);
  });
});

// Co-citoyenneté HTTP/WS : un controller sert les deux protocoles, donc le
// retour d'action doit être traité de façon symétrique côté WebSocket.
describe("Resolver — returnController() — WebSocket context", () => {
  it("sends a string result directly", async () => {
    const r = proxy();
    const { ctx, calls } = makeCtx("websocket");
    r.context = ctx as unknown as ContextType;
    await r.returnController("pong");
    expect(calls.send).to.deep.equal(["pong"]);
    expect(calls.render).to.have.lengthOf(0);
  });

  it("renders a returned plain object (realtime `return { type: 'pong' }`)", async () => {
    const r = proxy();
    const { ctx, calls } = makeCtx("websocket");
    r.context = ctx as unknown as ContextType;
    // WS n'a pas `sended` (undefined) → le message NE doit PAS être droppé.
    await r.returnController({ type: "pong" });
    expect(calls.json).to.equal(1);
    expect(calls.render).to.deep.equal([{ type: "pong" }]);
  });

  it("renders a returned array", async () => {
    const r = proxy();
    const { ctx, calls } = makeCtx("websocket");
    r.context = ctx as unknown as ContextType;
    await r.returnController([{ event: "tick" }]);
    expect(calls.json).to.equal(1);
    expect(calls.render).to.deep.equal([[{ event: "tick" }]]);
  });

  it("unwraps a Promise then re-dispatches (async WS handler)", async () => {
    const r = proxy();
    const { ctx, calls } = makeCtx("websocket");
    r.context = ctx as unknown as ContextType;
    await r.returnController(Promise.resolve({ type: "pong" }));
    expect(calls.json).to.equal(1);
    expect(calls.render).to.deep.equal([{ type: "pong" }]);
  });
});

// ─── parsePathernController ───────────────────────────────────────────────────

describe("Resolver — parsePathernController()", () => {
  it("throws on a non-string name", () => {
    const r = proxy();
    expect(() =>
      r.parsePathernController(undefined as unknown as string),
    ).to.throw(/expected a string/);
  });

  it("throws when the name is not module:controller:action", () => {
    const r = proxy();
    expect(() => r.parsePathernController("only:two")).to.throw(
      /module:controller:action/,
    );
  });
});

// ─── newController + hook initialize() ─────────────────────────────────────────

// Fake Injector : instancie le controller comme le vrai ferait via le DI, mais
// sans le Container complet — newController n'a besoin que d'`instantiate`.
function withInjector(r: Resolver, instantiate: () => unknown): void {
  r.container = new Container(); // requis par this.set("controller", …)
  r.injector = { instantiate } as unknown as Resolver["injector"];
}

describe("Resolver — newController() + initialize() hook", () => {
  it("awaits the optional initialize() hook after instantiation", async () => {
    let initialized = false;
    class FakeCtrl {
      async initialize() {
        initialized = true;
        return this;
      }
    }
    const r = proxy();
    r.controller = FakeCtrl as unknown as ControllerConstructor;
    withInjector(r, () => new FakeCtrl());
    const ctrl = await r.newController();
    expect(initialized).to.be.true;
    expect(ctrl).to.be.instanceof(FakeCtrl);
  });

  it("returns the controller as-is when no initialize() is defined", async () => {
    class PlainCtrl {}
    const r = proxy();
    r.controller = PlainCtrl as unknown as ControllerConstructor;
    withInjector(r, () => new PlainCtrl());
    const ctrl = await r.newController();
    expect(ctrl).to.be.instanceof(PlainCtrl);
  });

  it("throws when no controller is set on the resolver", async () => {
    const r = proxy();
    r.controller = null;
    let threw = false;
    try {
      await r.newController();
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});
