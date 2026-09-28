/**
 * Contrat de retour du Resolver (#505) : chaque étape rend sa VALEUR quand
 * rien n'est attendu, une PROMESSE seulement quand elle attend (création
 * asynchrone, garde d'autorisation, action asynchrone) ; une étape synchrone
 * lève en synchrone.
 *
 * Ce que ces cas fixent, c'est la FORME du retour — le résultat final est le
 * même dans les deux cas, donc une étape redevenue `async` passe tous les
 * autres tests et ne se voit qu'au compteur de Promises. Le cache singleton du
 * Router a son fichier (`singletonCache.test.ts`).
 *
 * Montage : `Object.create(Resolver.prototype)` + doublures (patron de
 * `resolverIdempotency.test.ts`) ; le contrôleur est créé par proxy prototype,
 * son vrai constructeur exigeant nom, contexte et DI.
 */
import { expect, vi } from "vitest";
import { Container } from "nodefony";
import Controller from "../../src/Controller.js";
import Resolver from "../../src/Resolver.js";
import type Route from "../../src/Route.js";
import type { ControllerConstructor } from "../../src/Route.js";
import type { ContextType } from "@nodefony/http";
import {
  computeActionMeta,
  Get,
  IsGranted,
  Redirect,
  Scope,
} from "../../decorators/routerDecorators.js";

const actionError = new Error("action");

class Ctrl extends Controller {
  override setRoute(route: Route): Route {
    return route;
  }
  @Get("/sync")
  syncAction() {
    return "texte";
  }
  @Get("/async")
  async asyncAction() {
    return "texte";
  }
  @Get("/boom")
  boom() {
    throw actionError;
  }
  @Get("/redirect")
  @Redirect("/ailleurs")
  redirected() {
    return undefined;
  }
  @Get("/guarded")
  @IsGranted("ROLE_ADMIN")
  guarded() {
    return "secret";
  }
}

@Scope("request")
class SyncInitCtrl extends Controller {
  override setRoute(route: Route): Route {
    return route;
  }
  initialize(): void {}
}

@Scope("request")
class AsyncInitCtrl extends Controller {
  override setRoute(route: Route): Route {
    return route;
  }
  async initialize(): Promise<void> {}
}

type Loose = Record<string, unknown>;
type Doubled = Resolver & {
  context: ContextType & Loose;
};

const SENT = { sent: true };

function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function makeResolver(
  action: string,
  opts: {
    controller?: typeof Controller;
    router?: unknown;
    pinned?: boolean;
  } = {},
): Doubled {
  const ctrl = opts.controller ?? Ctrl;
  const r = Object.create(Resolver.prototype) as Doubled;
  const container = new Container();
  r.context = {
    type: "http",
    method: "GET",
    container,
    router: opts.router,
    kernel: undefined,
    security: null,
    response: { setStatusCode() {}, setHeader() {} },
    request: { headers: {}, queryPost: null },
    send: vi.fn(() => SENT),
    redirect: vi.fn(),
    phaseStart: vi.fn(),
    phaseEnd: vi.fn(),
  } as unknown as ContextType & Loose;
  r.route = {
    variables: [],
    name: `Ctrl::${action}`,
    actionMeta: computeActionMeta(ctrl, action),
  } as unknown as Route;
  r.variables = [];
  r.queryOverride = null;
  r.methodOverride = null;
  r.messageInvocation = false;
  r.bypassFirewall = false;
  r.controller = ctrl as unknown as ControllerConstructor;
  r.actionName = action;
  r.injector = {
    instantiate: () => Object.create(ctrl.prototype) as Controller,
  } as unknown as Resolver["injector"];
  if (opts.pinned) {
    container.set("controller", Object.create(ctrl.prototype));
  }
  return r;
}

describe("Resolver.newController — l'instance, sans promesse quand rien n'attend", () => {
  it("singleton déjà en cache → l'INSTANCE du cache, posée sur le container", () => {
    const cached = Object.create(Ctrl.prototype) as Controller;
    const router = { getSingletonController: () => cached };
    const r = makeResolver("syncAction", { router });
    const out = r.newController();
    expect(out).to.equal(cached);
    expect(r.context.container?.get("controller")).to.equal(cached);
  });

  it("portée `request`, `initialize()` synchrone → instance synchrone", () => {
    const r = makeResolver("syncAction", { controller: SyncInitCtrl });
    const out = r.newController();
    expect(isThenable(out)).to.equal(false);
    expect(out).to.be.instanceOf(SyncInitCtrl);
  });

  it("portée `request`, `initialize()` asynchrone → promesse de l'instance", async () => {
    const r = makeResolver("syncAction", { controller: AsyncInitCtrl });
    const out = r.newController();
    expect(isThenable(out)).to.equal(true);
    expect(await out).to.be.instanceOf(AsyncInitCtrl);
    expect(r.context.container?.get("controller")).to.equal(await out);
  });

  it("route sans controller → levée en SYNCHRONE", () => {
    const r = makeResolver("syncAction");
    r.controller = null;
    expect(() => r.newController()).to.throw("Route Controller not found");
  });
});

describe("Resolver.executeAction — valeur brute, synchrone sans garde", () => {
  it("route non gardée, controller posé → `{ result }` synchrone", () => {
    const r = makeResolver("syncAction", { pinned: true });
    const out = r.executeAction();
    expect(isThenable(out)).to.equal(false);
    expect((out as { result: unknown }).result).to.equal("texte");
  });

  it("action qui lève → levée en SYNCHRONE", () => {
    const r = makeResolver("boom", { pinned: true });
    expect(() => r.executeAction()).to.throw(actionError);
  });

  it("route gardée → promesse ; un refus la ROMPT (403) sans exécuter l'action", async () => {
    const r = makeResolver("guarded", { pinned: true });
    const spy = vi.spyOn(Ctrl.prototype, "guarded");
    const out = r.executeAction();
    expect(isThenable(out)).to.equal(true);
    let caught: unknown;
    await (out as Promise<unknown>).catch((e: unknown) => {
      caught = e;
    });
    expect((caught as { code?: number }).code).to.equal(403);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("Resolver.callController — synchrone de bout en bout quand rien n'attend", () => {
  it("action et rendu synchrones → la valeur de l'envoi, pas une promesse", () => {
    const r = makeResolver("syncAction", { pinned: true });
    expect(r.callController()).to.equal(SENT);
    expect(r.context.send).toHaveBeenCalledWith("texte");
  });

  it("action asynchrone → promesse ; l'envoi suit sa résolution", async () => {
    const r = makeResolver("asyncAction", { pinned: true });
    const out = r.callController();
    expect(isThenable(out)).to.equal(true);
    expect(r.context.send).not.toHaveBeenCalled();
    expect(await out).to.equal(SENT);
    expect(r.context.send).toHaveBeenCalledWith("texte");
  });

  it("`@Redirect` + action synchrone qui rend undefined → redirection SANS suspension", () => {
    const r = makeResolver("redirected", { pinned: true });
    const out = r.callController();
    expect(isThenable(out)).to.equal(false);
    expect(r.context.redirect).toHaveBeenCalledWith("/ailleurs", 302);
  });

  it("action qui lève → levée en SYNCHRONE", () => {
    const r = makeResolver("boom", { pinned: true });
    expect(() => r.callController()).to.throw(actionError);
  });
});

describe("Resolver.returnController — n'attend que ce qui est une promesse", () => {
  it("texte → ce que rend l'envoi, tel quel", () => {
    const r = makeResolver("syncAction");
    expect(r.returnController("texte")).to.equal(SENT);
  });

  it("promesse → promesse du rendu de sa valeur", async () => {
    const r = makeResolver("syncAction");
    const out = r.returnController(Promise.resolve("texte"));
    expect(isThenable(out)).to.equal(true);
    expect(await out).to.equal(SENT);
  });
});
