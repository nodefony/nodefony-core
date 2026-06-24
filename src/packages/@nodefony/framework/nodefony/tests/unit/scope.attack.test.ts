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

// ─────────────────────────────────────────────────────────────────────────────
// RED-TEAM — scope DI `@Scope("singleton")` (matrice d'attaque, méthode 2 passes)
//
// MENACE (surface §4.4 « Scopes DI ») : un controller singleton est UNE instance
// partagée par TOUTES les requêtes. Si le framework grave un état per-requête sur
// l'instance (`#context`, `#route`, `#query`, …), la requête d'un attaquant lit
// l'identité / la session / la route d'une AUTRE requête → FUITE INTER-UTILISATEUR
// (escalade verticale silencieuse, le pire cas).
//
// INVARIANT à prouver : « singleton = stateless ; contexte via ALS uniquement ».
// Chaque getter (`context`/`session`/`route`/`query`/`queryGet`) doit retrouver LA
// requête EN COURS via l'ALS `RequestContext`, jamais une concurrente, même quand
// l'instance a été créée dans le contexte d'un PREMIER utilisateur.
//
// Anti-faux-vert : toutes les attaques tapent la MÊME instance singleton partagée
// (asserté) — sinon 2 instances distinctes isoleraient trivialement.
// ─────────────────────────────────────────────────────────────────────────────

interface Sess {
  id: string;
}

function makeCtx(tag: string, session?: Sess) {
  const container = new Container();
  container.set("template", { render: async () => "" });
  const route = { name: `route-${tag}` } as unknown as Route;
  const ctx = {
    container,
    notificationsCenter: new Event(),
    request: {
      url: new URL(`http://127.0.0.1/${tag}`),
      query: { q: tag },
      queryGet: { g: tag },
      queryFile: [],
      queryPost: {},
      headers: {},
    },
    method: "GET",
    session: session ?? null,
    resolver: { route },
    router: null as unknown,
    setContextJson() {},
    send: () => Promise.resolve({}),
  };
  return { ctx: ctx as unknown as ContextType, route };
}

// Router réel via le pattern proxy (cf scope.test.ts) — getSingletonController
// utilise un champ TS `private` lazy (`== null` guard) exprès pour ce pattern.
function makeRouter(): Router {
  return Object.create(Router.prototype) as Router;
}

const fakeInjector = {
  instantiate: (Ctor: new (c: ContextType) => Controller, c: ContextType) =>
    new Ctor(c),
} as unknown as Injector;

@Scope("singleton")
class VictimSingleton extends Controller {
  constructor(context: ContextType) {
    super("victim-singleton", context);
  }
  index() {
    return "ok";
  }
}

class PerRequestCtrl extends Controller {
  constructor(context: ContextType) {
    super("per-request", context);
  }
  index() {
    return "ok";
  }
}

function makeResolver(
  ctor: ControllerConstructor,
  tag: string,
  router: Router | null,
  session?: Sess,
) {
  const { ctx, route } = makeCtx(tag, session);
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

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const inRun = <T>(ctx: ContextType, fn: () => T): T =>
  RequestContext.run(
    { requestId: ctx.request?.url.pathname ?? "r", context: ctx },
    fn,
  );

describe("RED-TEAM — singleton controller inter-user leak", () => {
  it("A1 — first-arrival context does NOT freeze identity for later users", async () => {
    const router = makeRouter();
    // Alice (admin) est la PREMIÈRE à toucher la route → crée le singleton.
    const alice = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "alice",
      router,
    );
    const bob = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "bob",
      router,
    );

    const instance = await alice.r.newController();
    // ATTAQUE significative : Bob tape EXACTEMENT la même instance partagée.
    expect(await bob.r.newController()).to.equal(instance);

    // Hors de toute bulle ALS : aucun résidu du créateur (Alice).
    expect(instance.context).to.equal(undefined);
    expect(instance.session).to.equal(null);

    // Bob lit SON contexte, jamais celui d'Alice (le créateur).
    inRun(bob.ctx, () => {
      expect(instance.context).to.equal(bob.ctx);
      expect((instance.session as Sess | null)?.id ?? null).to.equal(null);
      expect(instance.query).to.deep.equal({ q: "bob" });
    });
    // Contrôle positif : Alice voit bien Alice.
    inRun(alice.ctx, () => {
      expect(instance.context).to.equal(alice.ctx);
      expect(instance.query).to.deep.equal({ q: "alice" });
    });
  });

  it("A2 — truly concurrent interleaved requests stay isolated", async () => {
    const router = makeRouter();
    const alice = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "alice",
      router,
    );
    const bob = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "bob",
      router,
    );
    const instance = await alice.r.newController();
    expect(await bob.r.newController()).to.equal(instance);

    const aliceEntered = deferred();
    const bobEntered = deferred();

    const aliceRun = inRun(alice.ctx, async () => {
      expect(instance.context).to.equal(alice.ctx);
      aliceEntered.resolve(); // signale Bob qu'Alice est "en vol"
      await bobEntered.promise; // Bob s'exécute pendant qu'Alice attend
      // REPRISE d'Alice après le passage de Bob : DOIT toujours voir Alice.
      expect(instance.context).to.equal(alice.ctx);
      expect(instance.query).to.deep.equal({ q: "alice" });
    });

    const bobRun = inRun(bob.ctx, async () => {
      await aliceEntered.promise; // entre APRÈS Alice (entrelacement réel)
      expect(instance.context).to.equal(bob.ctx); // Bob voit Bob, pas Alice
      expect(instance.query).to.deep.equal({ q: "bob" });
      bobEntered.resolve();
    });

    await Promise.all([aliceRun, bobRun]);
  });

  it("A3 — route never bleeds across requests (no action confusion)", async () => {
    const router = makeRouter();
    const alice = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "alice",
      router,
    );
    const bob = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "bob",
      router,
    );

    // Alice exécute une action complète (chemin réel executeAction).
    const { result } = await alice.r.executeAction();
    expect(result).to.equal("ok");
    const instance = await alice.r.newController();
    expect(await bob.r.newController()).to.equal(instance);

    // Hors ALS : aucune route gravée sur l'instance (setRoute skippé).
    expect(instance.route).to.equal(null);
    // Chaque requête voit SA route via context.resolver.route.
    inRun(alice.ctx, () => expect(instance.route).to.equal(alice.route));
    inRun(bob.ctx, () => expect(instance.route).to.equal(bob.route));
  });

  it("A4 — session never bleeds (admin session not visible to user)", async () => {
    const router = makeRouter();
    const adminSess: Sess = { id: "sess-admin" };
    const userSess: Sess = { id: "sess-user" };
    const alice = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "alice",
      router,
      adminSess,
    );
    const bob = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "bob",
      router,
      userSess,
    );
    const instance = await alice.r.newController();
    expect(await bob.r.newController()).to.equal(instance);

    inRun(alice.ctx, () =>
      expect((instance.session as Sess).id).to.equal("sess-admin"),
    );
    inRun(bob.ctx, () =>
      expect((instance.session as Sess).id).to.equal("sess-user"),
    );
    // Hors bulle : pas de session résiduelle.
    expect(instance.session).to.equal(null);
  });

  it("A5 — query/queryGet (WS-RPC params) never bleed", async () => {
    const router = makeRouter();
    const alice = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "alice",
      router,
    );
    const bob = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "bob",
      router,
    );
    const instance = await alice.r.newController();
    expect(await bob.r.newController()).to.equal(instance);

    inRun(alice.ctx, () => {
      expect(instance.query).to.deep.equal({ q: "alice" });
      expect(instance.queryGet).to.deep.equal({ g: "alice" });
    });
    inRun(bob.ctx, () => {
      expect(instance.query).to.deep.equal({ q: "bob" });
      expect(instance.queryGet).to.deep.equal({ g: "bob" });
    });
  });

  it("A6 (passe 2) — executeAction does NOT freeze queryOverride on a singleton", async () => {
    const router = makeRouter();
    const alice = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "alice",
      router,
    );
    // Un pont WS-RPC pose une query d'override sur le Resolver d'Alice.
    (
      alice.r as unknown as { queryOverride: Record<string, unknown> | null }
    ).queryOverride = {
      spliced: "alice-rpc",
    };
    await alice.r.executeAction();
    const instance = await alice.r.newController();

    // Le singleton ne doit PAS porter l'override gravé (sinon Bob le lirait).
    const bob = makeResolver(
      VictimSingleton as unknown as ControllerConstructor,
      "bob",
      router,
    );
    expect(await bob.r.newController()).to.equal(instance);
    inRun(bob.ctx, () => {
      expect(instance.query).to.deep.equal({ q: "bob" });
      expect(instance.query).to.not.have.property("spliced");
    });
  });

  it("CONTRÔLE — per-request controllers are isolated by fresh instantiation", async () => {
    const router = makeRouter();
    const a = makeResolver(
      PerRequestCtrl as unknown as ControllerConstructor,
      "alice",
      router,
    );
    const b = makeResolver(
      PerRequestCtrl as unknown as ControllerConstructor,
      "bob",
      router,
    );
    const ca = await a.r.newController();
    const cb = await b.r.newController();
    // Per-request : DEUX instances distinctes, chacune liée à sa requête.
    expect(ca).to.not.equal(cb);
    expect(ca.query).to.deep.equal({ q: "alice" });
    expect(cb.query).to.deep.equal({ q: "bob" });
  });
});
