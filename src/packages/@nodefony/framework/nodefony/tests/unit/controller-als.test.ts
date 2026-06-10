import { expect } from "chai";
import { Container, Event, RequestContext } from "nodefony";
import Controller from "../../src/Controller.js";
import type Route from "../../src/Route.js";
import type Resolver from "../../src/Resolver.js";
import type { ContextType } from "@nodefony/http";

// V4.1 — équivalence `this.context` (champ shadow) vs ALS `RequestContext`.
// Un controller per-request porte son context (comportement legacy intact) ;
// un controller SANS champ (futur singleton V4.3) doit retrouver le context de
// LA requête courante via l'ALS — request/response/method/query*/route/session
// dérivent alors du payload de la bulle, jamais d'une autre requête.

interface FakeCalls {
  send: unknown[];
  json: number;
}

function makeContext(tag: string) {
  const calls: FakeCalls = { send: [], json: 0 };
  const route = { name: `route-${tag}` } as unknown as Route;
  const ctx = {
    container: new Container(),
    notificationsCenter: new Event(),
    request: {
      url: new URL(`http://127.0.0.1/${tag}`),
      queryGet: { from: tag },
      query: { q: tag },
      queryFile: [tag],
      queryPost: { p: tag },
      headers: {},
    },
    method: "GET",
    session: { id: `session-${tag}` },
    response: {
      tag,
      setHeaders() {},
      setStatusCode() {},
    },
    resolver: { route } as unknown as Resolver,
    setContextJson() {
      calls.json++;
    },
    send(data?: unknown) {
      calls.send.push(data);
      return Promise.resolve({});
    },
  };
  ctx.container.set("template", { render: async () => "" });
  return { ctx: ctx as unknown as ContextType, calls, route };
}

function makeDetachedController(bootTag: string) {
  // Construit avec un context (le ctor l'exige) PUIS détaché : champ shadow
  // remis à null → tous les accessors doivent retomber sur l'ALS.
  const boot = makeContext(bootTag);
  const c = new Controller("als-ctrl", boot.ctx);
  c.context = undefined;
  return { c, boot };
}

describe("Controller — ALS fallback (V4.1)", () => {
  it("derives context and per-request state from the ALS when no field is set", () => {
    const { c } = makeDetachedController("boot");
    const { ctx, route } = makeContext("als");
    RequestContext.run({ requestId: "r1", context: ctx }, () => {
      expect(c.context).to.equal(ctx);
      expect(c.request).to.equal(ctx.request);
      expect(c.response).to.equal(ctx.response);
      expect(c.method).to.equal("GET");
      expect(c.queryGet).to.deep.equal({ from: "als" });
      expect(c.query).to.deep.equal({ q: "als" });
      expect(c.queryFile).to.deep.equal(["als"]);
      expect(c.queryPost).to.deep.equal({ p: "als" });
      expect(c.session).to.deep.equal({ id: "session-als" });
      expect(c.route).to.equal(route);
    });
  });

  it("prefers the instance field over the ALS (per-request legacy unchanged)", () => {
    const own = makeContext("own");
    const c = new Controller("field-ctrl", own.ctx);
    const other = makeContext("other");
    RequestContext.run({ requestId: "r2", context: other.ctx }, () => {
      expect(c.context).to.equal(own.ctx);
      expect(c.query).to.deep.equal({ q: "own" });
      expect(c.session).to.deep.equal({ id: "session-own" });
    });
  });

  it("returns safe empties outside any ALS scope when detached", () => {
    const { c } = makeDetachedController("boot");
    expect(c.context).to.equal(undefined);
    expect(c.request).to.equal(null);
    expect(c.response).to.equal(null);
    expect(c.method).to.equal(undefined);
    expect(c.query).to.equal(undefined);
    expect(c.session).to.equal(null);
    expect(c.route).to.equal(null);
  });

  it("setRoute shadows the resolver route of the ALS context", () => {
    const { c } = makeDetachedController("boot");
    const { ctx } = makeContext("als");
    const forced = { name: "forced" } as unknown as Route;
    RequestContext.run({ requestId: "r3", context: ctx }, () => {
      expect((c.route as Route).name).to.equal("route-als");
      c.setRoute(forced);
      expect(c.route).to.equal(forced);
    });
  });

  it("isolates two concurrent ALS scopes on the SAME instance (no bleed)", async () => {
    const { c } = makeDetachedController("boot");
    const a = makeContext("a");
    const b = makeContext("b");
    const seen: Record<string, unknown> = {};
    await Promise.all([
      RequestContext.run({ requestId: "ra", context: a.ctx }, async () => {
        await new Promise((r) => setTimeout(r, 20));
        seen.a = (c.query as { q: string }).q;
      }),
      RequestContext.run({ requestId: "rb", context: b.ctx }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.b = (c.query as { q: string }).q;
      }),
    ]);
    expect(seen.a).to.equal("a");
    expect(seen.b).to.equal("b");
  });

  it("renderJson sends through the ALS context when detached", async () => {
    const { c } = makeDetachedController("boot");
    const { ctx, calls } = makeContext("als");
    await RequestContext.run({ requestId: "r4", context: ctx }, async () => {
      await c.renderJson({ ok: true });
    });
    expect(calls.json).to.equal(1);
    expect(calls.send).to.deep.equal(['{"ok":true}']);
  });
});
