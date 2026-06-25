/// <reference types="node" />
import { expect } from "chai";
import { Container, RequestContext } from "nodefony";
import Resolver from "../../src/Resolver.js";
import type Route from "../../src/Route.js";
import type { ControllerConstructor } from "../../src/Route.js";
import type { ContextType } from "@nodefony/http";
import {
  computeActionMeta,
  Post,
  Get,
  Idempotent,
} from "../../decorators/routerDecorators.js";
import type { IIdempotencyStore, IdempotentResponse } from "nodefony";

// P6.8 — seam d'idempotence userland : callController → _callWithIdempotency.
// On monte un Resolver SANS pipeline HTTP (pattern securityEnforcement.test) et
// on STUB returnController pour capturer le rendu sans transport. `execCount`
// prouve qu'un rejeu NE ré-exécute PAS l'action (le cœur de l'anti double-effet).

let execCount = 0;

class IdemCtrl {
  setRoute(): this {
    return this;
  }
  @Post("/")
  @Idempotent()
  create() {
    execCount += 1;
    return { created: true, n: execCount };
  }
  @Post("/soft")
  @Idempotent({ required: false })
  soft() {
    execCount += 1;
    return { ok: true };
  }
  @Get("/read")
  @Idempotent()
  read() {
    execCount += 1;
    return { read: true };
  }
}

// Mini-store fidèle au contrat (le vrai MemoryIdempotencyStore est un Service DI,
// couvert par IdempotencyStore.test.ts + le banc admin live). Ici on isole le SEAM.
function makeStore(): IIdempotencyStore {
  const m = new Map<string, { fp: string; resp?: IdempotentResponse }>();
  return {
    begin(key, fp) {
      const e = m.get(key);
      if (!e) {
        m.set(key, { fp });
        return { state: "fresh" };
      }
      if (e.fp !== fp) return { state: "mismatch" };
      if (e.resp) return { state: "replayed", response: e.resp };
      return { state: "in-flight" };
    },
    complete(key, resp) {
      const e = m.get(key);
      if (e) e.resp = resp;
    },
    abort(key) {
      m.delete(key);
    },
    get size() {
      return m.size;
    },
  };
}

function makeResolver(opts: {
  action: string;
  method?: string;
  store?: IIdempotencyStore;
}): Resolver {
  const r = Object.create(Resolver.prototype) as Resolver;
  const container = new Container();
  if (opts.store) {
    container.set("idempotencyStore", opts.store);
  }
  const response = {
    statusCode: 200,
    setStatusCode(n: number) {
      this.statusCode = n;
    },
    setHeader() {},
  };
  r.context = {
    type: "http",
    method: opts.method ?? "POST",
    container,
    response,
    request: { headers: {}, queryPost: null },
  } as unknown as ContextType;
  r.route = {
    variables: [],
    name: `IdemCtrl::${opts.action}`,
    actionMeta: computeActionMeta(IdemCtrl, opts.action),
  } as unknown as Route;
  r.variables = [];
  (r as unknown as { queryOverride: unknown }).queryOverride = null;
  r.controller = IdemCtrl as unknown as ControllerConstructor;
  r.actionName = opts.action;
  r.newController = (async () => new IdemCtrl()) as Resolver["newController"];
  // Capture le rendu sans toucher au transport (le vrai returnController appelle send/render).
  r.returnController = (async (x: unknown) =>
    x) as Resolver["returnController"];
  return r;
}

async function caught(p: Promise<unknown>): Promise<{ code?: number } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: number };
  }
}

describe("Resolver — seam @Idempotent userland (callController)", () => {
  beforeEach(() => {
    execCount = 0;
  });

  it("strict mutation without key → 400, action never runs", async () => {
    const r = makeResolver({ action: "create", store: makeStore() });
    const err = await RequestContext.run(
      { requestId: "t", user: { username: "alice" } },
      () => caught(r.callController()),
    );
    expect(err?.code).to.equal(400);
    expect(execCount).to.equal(0);
  });

  it("fresh key → executes once, returns the value", async () => {
    const r = makeResolver({ action: "create", store: makeStore() });
    const out = await RequestContext.run(
      { requestId: "t", user: { username: "alice" }, idempotencyKey: "k1" },
      () => r.callController(),
    );
    expect(execCount).to.equal(1);
    expect(out).to.deep.equal({ created: true, n: 1 });
  });

  it("replayed key (same payload) → memorized response, action NOT re-run", async () => {
    const store = makeStore();
    const call = () =>
      RequestContext.run(
        { requestId: "t", user: { username: "alice" }, idempotencyKey: "k1" },
        () => makeResolver({ action: "create", store }).callController(),
      );
    expect(await call()).to.deep.equal({ created: true, n: 1 });
    const replay = await call();
    expect(execCount).to.equal(1); // PAS de 2e exécution
    expect(replay).to.deep.equal({ created: true, n: 1 }); // réponse mémorisée
  });

  it("same key + different payload → 422, action not re-run", async () => {
    const store = makeStore();
    await RequestContext.run(
      {
        requestId: "t",
        user: { username: "alice" },
        idempotencyKey: "k1",
        body: { a: 1 },
      },
      () => makeResolver({ action: "create", store }).callController(),
    );
    expect(execCount).to.equal(1);
    const err = await RequestContext.run(
      {
        requestId: "t",
        user: { username: "alice" },
        idempotencyKey: "k1",
        body: { a: 2 },
      },
      () => caught(makeResolver({ action: "create", store }).callController()),
    );
    expect(err?.code).to.equal(422);
    expect(execCount).to.equal(1);
  });

  it("scopes the cache by identity — Bob's same key does NOT replay Alice's", async () => {
    const store = makeStore();
    await RequestContext.run(
      { requestId: "t", user: { username: "alice" }, idempotencyKey: "k1" },
      () => makeResolver({ action: "create", store }).callController(),
    );
    const bob = await RequestContext.run(
      { requestId: "t", user: { username: "bob" }, idempotencyKey: "k1" },
      () => makeResolver({ action: "create", store }).callController(),
    );
    // Bob exécute sa PROPRE mutation (anti-IDOR sur le cache).
    expect(execCount).to.equal(2);
    expect(bob).to.deep.equal({ created: true, n: 2 });
  });

  it("soft mode without key → executes (no 400)", async () => {
    const r = makeResolver({ action: "soft", store: makeStore() });
    const out = await RequestContext.run(
      { requestId: "t", user: { username: "alice" } },
      () => r.callController(),
    );
    expect(execCount).to.equal(1);
    expect(out).to.deep.equal({ ok: true });
  });

  it("GET decorated @Idempotent → no-op (executes, never gated)", async () => {
    const r = makeResolver({
      action: "read",
      method: "GET",
      store: makeStore(),
    });
    const out = await RequestContext.run(
      { requestId: "t", user: { username: "alice" } },
      () => r.callController(),
    );
    expect(execCount).to.equal(1);
    expect(out).to.deep.equal({ read: true });
  });

  it("no store registered → executes (degrade, no dedup)", async () => {
    const call = () =>
      RequestContext.run(
        { requestId: "t", user: { username: "alice" }, idempotencyKey: "k1" },
        () => makeResolver({ action: "create" }).callController(),
      );
    await call();
    await call();
    expect(execCount).to.equal(2); // pas de dédup sans store
  });
});
