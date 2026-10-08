//
// ─── Contrôleurs singletons par défaut (#506) ────────────────────────────────
//
// Un contrôleur est construit UNE fois par classe, puis partagé par toutes les
// requêtes. Ce fichier éprouve ce qui rend ce défaut sûr :
//
//  1. le défaut lui-même, et l'option explicite `@Scope("request")` ;
//  2. le filet de développement : une écriture sur `this` d'un singleton lève,
//     en nommant le contrôleur, le champ et le remède ;
//  3. les accesseurs d'état par requête (`this.query = …`) refusés sur un
//     singleton, dans TOUS les environnements ;
//  4. la dépendance captive refusée par `Router.setController`, chemin que
//     prennent aussi les contrôleurs internes enregistrés sans `@controllers` ;
//  5. le pont `api.request` : deux appels concurrents sur la MÊME connexion
//     lisent chacun LEUR route et LEUR query ;
//  6. `streamFile` : un écouteur de flux déclenché hors de la bulle ALS
//     retrouve quand même le contexte de SA requête.
//
// Débrancher, un par un : (2) l'appel du filet dans `Resolver._createController` ;
// (3) la garde des accesseurs de `Controller` ; (4) l'appel de
// `Injector.assertNoCaptiveDependency` dans `Router.setController` ; (5) la
// lecture du résolveur d'appel (`RequestContext` clé `resolver`) dans les
// accesseurs `route`/`query`/`queryGet` ; (6) la capture du contexte en tête
// de `streamFile`.
//
import { expect } from "vitest";
import { fileURLToPath } from "node:url";
import { PassThrough, type Readable } from "node:stream";
import {
  BootConfigurationError,
  Container,
  Event,
  Module,
  RequestContext,
  Service,
  inject,
  injectable,
} from "nodefony";
import type { Injector, Scope as DIScope } from "nodefony";
import type { ContextType, HttpResponse } from "@nodefony/http";
import Controller from "../../src/Controller.js";
import Resolver from "../../src/Resolver.js";
import Router from "../../service/router.js";
import { Scope } from "../../decorators/routerDecorators.js";
import type Route from "../../src/Route.js";
import type { ControllerConstructor } from "../../src/Route.js";

const HERE = fileURLToPath(import.meta.url);

/**
 * Contexte factice : le conteneur sert aussi de conteneur du kernel, pour que
 * le constructeur d'un singleton (lié au kernel) y trouve `template`.
 */
function makeCtx(tag: string, environment = "development") {
  const container = new Container();
  container.set("template", { render: async () => "" });
  const route = { name: `route-${tag}` } as unknown as Route;
  const ctx = {
    container,
    notificationsCenter: new Event(),
    kernel: {
      environment,
      container,
      notificationsCenter: new Event(),
    },
    phaseStart() {},
    phaseEnd() {},
    request: {
      url: new URL(`http://127.0.0.1/${tag}`),
      query: { q: tag },
      queryGet: { q: tag },
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

function makeRouter(): Router {
  return Object.create(Router.prototype) as Router;
}

const fakeInjector = {
  instantiate: (Ctor: new (c: ContextType) => Controller, c: ContextType) =>
    new Ctor(c),
} as unknown as Injector;

/**
 * Base des contrôleurs de ce fichier : le constructeur que déclare tout
 * contrôleur réel — l'injecteur lui passe le contexte, il transmet son nom.
 */
class TestController extends Controller {
  constructor(context: ContextType) {
    super(new.target.name, context);
  }
}

function makeResolver(
  ctor: ControllerConstructor,
  ctx: ContextType,
  route: Route,
  action = "index",
) {
  const r = Object.create(Resolver.prototype) as Resolver;
  r.context = ctx;
  r.injector = fakeInjector;
  r.controller = ctor;
  r.actionName = action;
  r.route = route;
  r.variables = [];
  return r;
}

/** Résout puis exécute une fois l'action d'une classe, dans un environnement. */
async function runOnce(
  ctor: ControllerConstructor,
  environment: string,
): Promise<unknown> {
  const { ctx, route } = makeCtx("run", environment);
  (ctx as unknown as { router: Router }).router = makeRouter();
  const r = makeResolver(ctor, ctx, route);
  const { result } = await RequestContext.run(
    { requestId: "run", context: ctx },
    () => r.executeAction(),
  );
  return result;
}

/** Rejet d'une promesse, ou `null` si elle tient. */
function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

describe("Contrôleurs — portée par défaut (#506)", () => {
  it("un contrôleur sans décorateur est un singleton", () => {
    class Plain extends Controller {}
    expect(Controller.scope).to.equal("singleton");
    expect(Plain.scope).to.equal("singleton");
  });

  it('@Scope("request") redonne une instance par requête, sur cette classe seulement', () => {
    class Plain extends Controller {}
    @Scope("request")
    class PerRequest extends Controller {}
    expect(PerRequest.scope).to.equal("request");
    expect(Plain.scope).to.equal("singleton");
    expect(Controller.scope).to.equal("singleton");
  });
});

describe("Contrôleur singleton — filet de développement", () => {
  class Counter extends TestController {
    count = 0;
    index() {
      this.count++;
      return this.count;
    }
  }

  it("en développement, une écriture sur this lève en nommant le contrôleur, le champ et le remède", async () => {
    const err = await rejectionOf(runOnce(Counter, "development"));
    expect(err).to.be.instanceOf(TypeError);
    const message = (err as Error).message;
    expect(message).to.include("Counter");
    expect(message).to.include("count");
    expect(message).to.include('@Scope("request")');
  });

  it("hors développement, le filet ne tourne pas (aucun coût en production)", async () => {
    class ProdCounter extends TestController {
      count = 0;
      index() {
        this.count++;
        return this.count;
      }
    }
    expect(await runOnce(ProdCounter, "production")).to.equal(1);
  });

  it("initialize() pose l'état de DÉMARRAGE avant le filet : il reste lisible", async () => {
    class Booted extends TestController {
      table: Map<string, string> | null = null;
      async initialize(): Promise<this> {
        this.table = new Map([["k", "v"]]);
        return this;
      }
      index() {
        return this.table?.get("k");
      }
    }
    expect(await runOnce(Booted, "development")).to.equal("v");
  });

  it("un contrôleur par requête garde le droit d'écrire sur this", async () => {
    @Scope("request")
    class PerRequestCounter extends TestController {
      count = 0;
      index() {
        this.count++;
        return this.count;
      }
    }
    expect(await runOnce(PerRequestCounter, "development")).to.equal(1);
  });
});

describe("Contrôleur singleton — accesseurs d'état par requête", () => {
  for (const environment of ["development", "production"]) {
    it(`${environment} : this.query = … lève sur un singleton (l'état fuirait vers la requête suivante)`, async () => {
      class QueryWriter extends TestController {
        index() {
          this.query = { injected: true };
          return "jamais";
        }
      }
      const err = await rejectionOf(runOnce(QueryWriter, environment));
      expect(err).to.be.instanceOf(TypeError);
      const message = (err as Error).message;
      expect(message).to.include("QueryWriter");
      expect(message).to.include("query");
      expect(message).to.include('@Scope("request")');
    });
  }

  it("setRoute() lève sur un singleton", async () => {
    class RouteWriter extends TestController {
      index() {
        this.setRoute(null);
        return "jamais";
      }
    }
    const err = await rejectionOf(runOnce(RouteWriter, "production"));
    expect(err).to.be.instanceOf(TypeError);
    expect((err as Error).message).to.include("RouteWriter");
  });

  it("un contrôleur par requête garde ses accesseurs inscriptibles", async () => {
    @Scope("request")
    class PerRequestWriter extends TestController {
      index() {
        this.query = { injected: true };
        return this.query;
      }
    }
    expect(await runOnce(PerRequestWriter, "production")).to.deep.equal({
      injected: true,
    });
  });
});

// ── (4) dépendance captive — Router.setController ────────────────────────────
class DirectTenant extends Service {
  constructor(scope: DIScope) {
    super("directTenant", scope, false);
  }
}
injectable({ name: "SingletonDefaultTenant", scope: "request" })(DirectTenant);

/** Singleton PAR DÉFAUT, qui réclame un service de portée request. */
class DirectCaptive extends Controller {
  constructor(
    context: ContextType,
    readonly tenant: DirectTenant,
  ) {
    super("DirectCaptive", context);
  }
}
inject("SingletonDefaultTenant")(DirectCaptive, undefined, 1);

/** Même dépendance, portée par requête déclarée : légitime. */
class DirectPerRequest extends Controller {
  constructor(
    context: ContextType,
    readonly tenant: DirectTenant,
  ) {
    super("DirectPerRequest", context);
  }
}
Scope("request")(DirectPerRequest);
inject("SingletonDefaultTenant")(DirectPerRequest, undefined, 1);

describe("Router.setController — dépendance captive refusée", () => {
  const fakeModule = {
    name: "@nodefony/fw-direct",
    log() {},
  } as unknown as Module;

  it("refuse un singleton qui injecte un service de portée request, en le nommant", () => {
    expect(() => Router.setController(DirectCaptive, fakeModule)).to.throw(
      BootConfigurationError,
      /DirectCaptive/,
    );
  });

  it("CONTRÔLE POSITIF : le même besoin, en portée request, est enregistré", () => {
    try {
      expect(Router.setController(DirectPerRequest, fakeModule)).to.equal(
        DirectPerRequest,
      );
    } finally {
      delete Module.controllers["@nodefony/fw-direct:DirectPerRequest"];
    }
  });
});

// ── (5) pont api.request — un résolveur PAR APPEL ────────────────────────────
describe("Contrôleur singleton — pont api.request", () => {
  class Probe extends TestController {
    async whoami() {
      // Franchir un `await` : les deux appels s'entrelacent vraiment.
      await new Promise((r) => setTimeout(r, 5));
      return {
        route: this.route?.name ?? null,
        q: (this.query as Record<string, unknown> | undefined)?.q ?? null,
        qg: (this.queryGet as Record<string, unknown> | undefined)?.q ?? null,
      };
    }
  }

  it("deux appels concurrents sur la MÊME connexion lisent chacun leur route et leur query", async () => {
    // La connexion a SA route (celle du hub) et SA query (celle du handshake) :
    // un singleton qui les lirait répondrait à côté.
    const { ctx } = makeCtx("connexion");
    (ctx as unknown as { router: Router }).router = makeRouter();
    const invoke = async (name: string, q: string) => {
      const r = makeResolver(
        Probe,
        ctx,
        { name } as unknown as Route,
        "whoami",
      );
      r.queryOverride = { q };
      const { result } = await RequestContext.run(
        { requestId: name, context: ctx, resolver: r },
        () => r.executeActionGuarded(undefined, true),
      );
      return result as Promise<unknown>;
    };
    const [a, b] = await Promise.all([
      invoke("route-a", "qa"),
      invoke("route-b", "qb"),
    ]);
    expect(a).to.deep.equal({ route: "route-a", q: "qa", qg: "qa" });
    expect(b).to.deep.equal({ route: "route-b", q: "qb", qg: "qb" });
  });

  it("un api.request ne remplace pas le contrôleur de la connexion : le hub n'est pas réinstancié au message suivant", async () => {
    let hubBuilt = 0;
    @Scope("request")
    class Hub extends TestController {
      constructor(context: ContextType) {
        super(context);
        hubBuilt += 1;
      }
      frame() {
        return "frame";
      }
    }
    const { ctx } = makeCtx("socket");
    (ctx as unknown as { router: Router }).router = makeRouter();
    const hubRoute = { name: "hub" } as unknown as Route;
    const frame = () =>
      RequestContext.run({ requestId: "frame", context: ctx }, () =>
        makeResolver(Hub, ctx, hubRoute, "frame").executeAction(),
      );

    await frame(); // handshake : le hub de la connexion
    const hub = ctx.container?.get("controller");
    expect(hubBuilt).to.equal(1);

    // Le pont invoque une AUTRE classe (singleton) sur la même connexion.
    const call = makeResolver(
      Probe,
      ctx,
      { name: "route-api" } as unknown as Route,
      "whoami",
    );
    call.messageInvocation = true;
    await RequestContext.run(
      { requestId: "api", context: ctx, resolver: call },
      async () => (await call.executeActionGuarded(undefined, true)).result,
    );
    expect(ctx.container?.get("controller")).to.equal(hub);

    await frame(); // frame suivante : même hub, aucune reconstruction
    expect(hubBuilt).to.equal(1);
  });

  // Un `forward()` crée un résolveur neuf, qui n'est PAS une invocation par
  // message : il posait sa cible sur le pointeur de la connexion, et la frame
  // suivante reconstruisait le contrôleur de la connexion (DI + initialize()),
  // perdant tout état posé sur l'instance (#574).
  // Débrancher : réécrire le pointeur sans condition dans `_pinController`.
  it("un forward sur une connexion WebSocket ne remplace pas son contrôleur", async () => {
    let hubBuilt = 0;
    @Scope("request")
    class Hub extends TestController {
      constructor(context: ContextType) {
        super(context);
        hubBuilt += 1;
      }
      frame() {
        return "frame";
      }
    }
    const { ctx } = makeCtx("socket-forward");
    (ctx as unknown as { method: string }).method = "WEBSOCKET";
    (ctx as unknown as { router: Router }).router = makeRouter();
    const hubRoute = { name: "hub" } as unknown as Route;
    const frame = () =>
      RequestContext.run({ requestId: "frame", context: ctx }, () =>
        makeResolver(Hub, ctx, hubRoute, "frame").executeAction(),
      );

    await frame(); // handshake : le hub de la connexion
    const hub = ctx.container?.get("controller");
    expect(hubBuilt).to.equal(1);

    // Ce que fait `Controller.forward()` : un résolveur neuf, rechargé.
    const forwarded = makeResolver(
      Probe,
      ctx,
      { name: "route-forward" } as unknown as Route,
      "whoami",
    );
    await RequestContext.run(
      { requestId: "forward", context: ctx, resolver: forwarded },
      async () =>
        (await forwarded.executeActionGuarded(undefined, true)).result,
    );
    expect(ctx.container?.get("controller")).to.equal(hub);

    await frame(); // frame suivante : même hub, aucune reconstruction
    expect(hubBuilt).to.equal(1);
  });

  it("hors du pont, la route et la query restent celles du contexte", async () => {
    const { ctx } = makeCtx("http");
    (ctx as unknown as { router: Router }).router = makeRouter();
    const r = makeResolver(
      Probe,
      ctx,
      { name: "route-http" } as unknown as Route,
      "whoami",
    );
    const { result } = await RequestContext.run(
      { requestId: "http", context: ctx },
      () => r.executeAction(),
    );
    expect(await (result as Promise<unknown>)).to.deep.equal({
      route: "route-http",
      q: "http",
      qg: "http",
    });
  });
});

// ── (6) streamFile — écouteurs hors bulle ALS ────────────────────────────────
describe("Contrôleur singleton — streamFile", () => {
  class Streamer extends Controller {}

  it("une réponse fermée en plein flux, HORS de la bulle ALS, termine quand même le contexte de la requête", async () => {
    const calls = { end: 0 };
    // Réponse qui ne lit rien : la contre-pression met le flux en pause avant
    // sa fin, et c'est la fermeture de la réponse qui doit le terminer.
    const raw = new PassThrough({ highWaterMark: 1 });
    (raw as unknown as { removeHeader: () => void }).removeHeader = () => {};
    const response = {
      response: raw,
      statusCode: 200,
      setFileMimeType() {},
    };
    const { ctx } = makeCtx("stream", "production");
    const live = ctx as unknown as Record<string, unknown>;
    live.response = response as unknown as HttpResponse;
    live.finished = false;
    live.writeHead = () => {};
    live.end = () => {
      calls.end++;
    };

    const c = new Streamer("streamer", ctx);
    let source: Readable | null = null;
    raw.once("pipe", (src: Readable) => (source = src));
    const done = RequestContext.run({ requestId: "stream", context: ctx }, () =>
      c.streamFile(HERE, {}, { highWaterMark: 16 }),
    );
    // Attendre que la lecture anticipée ait REMPLI son tampon : aucune lecture
    // n'est plus alors en vol. Sans cette attente, `fs.ReadStream` retarde sa
    // fermeture jusqu'au retour de la lecture en cours — lancée DANS la bulle
    // — et le chemin fautif n'est jamais exercé (vu : test vert sur le code
    // fautif). Borne en TEMPS, pas en tours : mille `setImmediate` durent
    // quelques millisecondes, moins qu'une lecture disque sur un exécuteur de
    // CI chargé (vu : tampon vide à l'assertion, sur ubuntu).
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const s = source as Readable | null;
      if (s !== null && s.readableLength >= s.readableHighWaterMark) break;
      await new Promise((r) => setTimeout(r, 1));
    }
    const filled = source as Readable | null;
    expect(filled?.readableLength).to.be.at.least(16);
    // Ici, plus aucune bulle ALS : le client raccroche.
    expect(RequestContext.get()).to.equal(undefined);
    raw.emit("close");
    await done;
    expect(calls.end).to.equal(1);
  });
});
