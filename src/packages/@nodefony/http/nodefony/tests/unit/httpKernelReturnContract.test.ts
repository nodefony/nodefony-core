/// <reference types="node" />
/**
 * Contrat de retour des étapes du pipeline HTTP (#505).
 *
 * Chaque étape rend sa VALEUR quand rien n'est attendu, une PROMESSE seulement
 * quand elle attend réellement — et ses erreurs suivent la même règle :
 * exception synchrone d'une étape synchrone, rejet d'une étape asynchrone. Les
 * appelants traitent les deux formes ; ce fichier fige laquelle chaque étape
 * rend, parce qu'une étape redevenue `async` par mégarde passe tous les autres
 * tests (le résultat final est le même) et ne se voit qu'au compteur de
 * Promises.
 *
 * Montage minimal : `Object.create(HttpKernel.prototype)` + doublures, sans
 * serveur (patron de `httpScopeOrphan.test.ts`).
 */
import { expect, vi } from "vitest";
import { Container } from "nodefony";
import HttpKernel from "../../service/http-kernel.js";
import HttpError from "../../src/errors/httpError.js";

type Loose = Record<string, unknown>;

function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function makeKernel(extra: Loose = {}): Loose {
  const kernel = Object.create(HttpKernel.prototype) as Loose;
  kernel.log = vi.fn();
  kernel.options = { http: { headers: null }, https: { headers: null } };
  kernel.kernel = undefined;
  kernel.firewall = undefined;
  kernel.sessionService = null;
  kernel.profiler = null;
  kernel.listenerCount = () => 0;
  kernel.router = { resolve: () => ({ resolve: true, exception: null }) };
  Object.assign(kernel, extra);
  return kernel;
}

function call(kernel: Loose, name: string, ...args: unknown[]): unknown {
  const fn = (HttpKernel.prototype as unknown as Loose)[name] as (
    ...a: unknown[]
  ) => unknown;
  return fn.call(kernel, ...args);
}

function makeContext(extra: Loose = {}): Loose {
  return {
    scheme: "http",
    url: "/x",
    secure: false,
    isControlledAccess: false,
    resolver: { resolve: true, exception: null },
    sessionIntent: null,
    security: null,
    response: { setHeaders: vi.fn() },
    hasSession: () => false,
    phaseStart: vi.fn(),
    phaseEnd: vi.fn(),
    ...extra,
  };
}

describe("HttpKernel.onHttpRequest — ne lève ni ne rejette jamais", () => {
  it("dispatch synchrone servi (sonde, 429) → undefined", () => {
    const kernel = makeKernel({ dispatchHttpRequest: () => undefined });
    expect(call(kernel, "onHttpRequest", {}, {}, "http")).to.equal(undefined);
  });

  it("dispatch qui LÈVE en synchrone → undefined, aucune exception", () => {
    const kernel = makeKernel({
      dispatchHttpRequest: () => {
        throw new Error("boum");
      },
    });
    expect(() => call(kernel, "onHttpRequest", {}, {}, "http")).to.not.throw();
    expect(call(kernel, "onHttpRequest", {}, {}, "http")).to.equal(undefined);
  });

  it("dispatch qui REJETTE → promesse tenue (undefined), jamais rompue", async () => {
    const kernel = makeKernel({
      dispatchHttpRequest: () => Promise.reject(new Error("boum")),
    });
    const out = call(kernel, "onHttpRequest", {}, {}, "http");
    expect(isThenable(out)).to.equal(true);
    expect(await out).to.equal(undefined);
  });

  it("dispatch asynchrone tenu → promesse de undefined", async () => {
    const kernel = makeKernel({
      dispatchHttpRequest: () => Promise.resolve("ctx"),
    });
    const out = call(kernel, "onHttpRequest", {}, {}, "http");
    expect(isThenable(out)).to.equal(true);
    expect(await out).to.equal(undefined);
  });
});

describe("HttpKernel.prepareFrontController — synchrone", () => {
  it("route trouvée → le résolveur, pas une promesse, posé sur le contexte", () => {
    const resolver = { resolve: true, exception: null };
    const kernel = makeKernel();
    const context = makeContext({ resolver });
    const out = call(kernel, "prepareFrontController", context);
    expect(out).to.equal(resolver);
    expect(context.resolver).to.equal(resolver);
  });

  it("aucune route → HttpError 404 levée en SYNCHRONE", () => {
    const kernel = makeKernel();
    const context = makeContext({
      resolver: { resolve: false, exception: null },
    });
    let caught: unknown;
    try {
      call(kernel, "prepareFrontController", context);
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(HttpError);
    expect((caught as HttpError).code).to.equal(404);
  });

  it("exception du résolveur (405) → levée telle quelle en SYNCHRONE", () => {
    const exception = new Error("405");
    const kernel = makeKernel();
    const context = makeContext({ resolver: { resolve: false, exception } });
    expect(() => call(kernel, "prepareFrontController", context)).to.throw(
      exception,
    );
  });
});

describe("HttpKernel.startSession — null synchrone sans session à ouvrir", () => {
  it("sans service de session → null", () => {
    const kernel = makeKernel({ sessionService: null });
    expect(call(kernel, "startSession", makeContext())).to.equal(null);
  });

  it("ni intent ni cookie → null, le store n'est pas interrogé", () => {
    const start = vi.fn(() => Promise.resolve({}));
    const kernel = makeKernel({ sessionService: { start } });
    expect(call(kernel, "startSession", makeContext())).to.equal(null);
    expect(start).not.toHaveBeenCalled();
  });

  it("zone sans registre → null même avec un cookie entrant", () => {
    const start = vi.fn(() => Promise.resolve({}));
    const kernel = makeKernel({ sessionService: { start } });
    const context = makeContext({
      hasSession: () => true,
      security: { stateless: true, name: "api" },
    });
    expect(call(kernel, "startSession", context)).to.equal(null);
    expect(start).not.toHaveBeenCalled();
  });

  it("intent de route → la promesse du store", () => {
    const session = { id: "s" };
    const pending = Promise.resolve(session);
    const kernel = makeKernel({ sessionService: { start: () => pending } });
    const context = makeContext({ sessionIntent: { readOnly: false } });
    expect(call(kernel, "startSession", context)).to.equal(pending);
  });
});

describe("HttpKernel.onRequestEnd — synchrone tant qu'aucune garde n'attend", () => {
  it("cas nominal → le contexte lui-même, pas une promesse", () => {
    const kernel = makeKernel();
    const context = makeContext();
    expect(call(kernel, "onRequestEnd", context)).to.equal(context);
  });

  it("erreur reçue → levée en SYNCHRONE", () => {
    const kernel = makeKernel();
    const error = new Error("amont");
    expect(() => call(kernel, "onRequestEnd", makeContext(), error)).to.throw(
      error,
    );
  });

  it("route introuvable → 404 levé en SYNCHRONE (pas un rejet)", () => {
    const kernel = makeKernel();
    const context = makeContext({
      resolver: { resolve: false, exception: null },
    });
    expect(() => call(kernel, "onRequestEnd", context)).to.throw(HttpError);
  });

  it("écouteur `beforeResolve` → promesse du contexte", async () => {
    const kernel = makeKernel({
      listenerCount: (name: string) => (name === "beforeResolve" ? 1 : 0),
      fireAsync: vi.fn(() => Promise.resolve([])),
    });
    const context = makeContext();
    const out = call(kernel, "onRequestEnd", context);
    expect(isThenable(out)).to.equal(true);
    expect(await out).to.equal(context);
  });

  it("session à ouvrir → promesse du contexte", async () => {
    const kernel = makeKernel({
      sessionService: { start: () => Promise.resolve({}) },
    });
    const context = makeContext({ sessionIntent: { readOnly: false } });
    const out = call(kernel, "onRequestEnd", context);
    expect(isThenable(out)).to.equal(true);
    expect(await out).to.equal(context);
  });

  it("zone protégée → promesse ; un refus du pare-feu la ROMPT", async () => {
    const refusal = new Error("401");
    const kernel = makeKernel({
      firewall: {
        isSecure: () => true,
        enforceCsrf: () => undefined,
        handleSecurity: () => Promise.reject(refusal),
      },
      listenerCount: () => 0,
      fireAsync: vi.fn(() => Promise.resolve([])),
    });
    const out = call(kernel, "onRequestEnd", makeContext());
    expect(isThenable(out)).to.equal(true);
    let caught: unknown;
    await (out as Promise<unknown>).catch((e: unknown) => {
      caught = e;
    });
    expect(caught).to.equal(refusal);
  });
});

describe("HttpKernel.teardownHttp — ne lève jamais, libère TOUJOURS le scope", () => {
  function setup(extra: Loose = {}): {
    kernel: Loose;
    context: Loose;
    container: Container;
    scope: unknown;
  } {
    const container = new Container();
    container.addScope("request");
    const scope = container.enterScope("request");
    const kernel = makeKernel({ container });
    const context: Loose = {
      finished: false,
      waitAsync: false,
      sended: true,
      logRequest: vi.fn(),
      logPhasesVerbose: vi.fn(),
      _runAfterResponse: () => undefined,
      listenerCount: () => 0,
      fireAsync: vi.fn(() => Promise.resolve([])),
      clean: vi.fn(),
      ...extra,
    };
    return { kernel, context, container, scope };
  }

  it("sans hook → undefined en synchrone, scope libéré, contexte nettoyé", () => {
    const { kernel, context, container, scope } = setup();
    expect(call(kernel, "teardownHttp", context, scope)).to.equal(undefined);
    expect(container.scopeCount("request")).to.equal(0);
    expect(context.finished).to.equal(true);
    expect(context.clean).toHaveBeenCalledOnce();
  });

  it("déjà fini → undefined, rien n'est rejoué", () => {
    const { kernel, context, container, scope } = setup({ finished: true });
    expect(call(kernel, "teardownHttp", context, scope)).to.equal(undefined);
    expect(context.logRequest).not.toHaveBeenCalled();
    expect(container.scopeCount("request")).to.equal(1);
  });

  it("hook `onAfterResponse` → promesse ; scope libéré APRÈS le hook", async () => {
    let release!: () => void;
    const after = new Promise<void>((r) => {
      release = r;
    });
    const { kernel, context, container, scope } = setup({
      _runAfterResponse: () => after,
    });
    const out = call(kernel, "teardownHttp", context, scope);
    expect(isThenable(out)).to.equal(true);
    expect(container.scopeCount("request")).to.equal(1);
    release();
    await out;
    expect(container.scopeCount("request")).to.equal(0);
  });

  it("écouteur `onFinish` → promesse ; le hook est tiré", async () => {
    const { kernel, context, container, scope } = setup({
      listenerCount: (name: string) => (name === "onFinish" ? 1 : 0),
    });
    const out = call(kernel, "teardownHttp", context, scope);
    expect(isThenable(out)).to.equal(true);
    await out;
    expect(context.fireAsync).toHaveBeenCalledWith("onFinish", context);
    expect(container.scopeCount("request")).to.equal(0);
  });

  it("étape synchrone qui lève → undefined, erreur journalisée, scope libéré", () => {
    const { kernel, context, container, scope } = setup({
      logRequest: () => {
        throw new Error("journal");
      },
    });
    expect(call(kernel, "teardownHttp", context, scope)).to.equal(undefined);
    expect(kernel.log).toHaveBeenCalledOnce();
    expect(container.scopeCount("request")).to.equal(0);
  });

  it("hook qui rejette → promesse TENUE, erreur journalisée, scope libéré", async () => {
    const { kernel, context, container, scope } = setup({
      _runAfterResponse: () => Promise.reject(new Error("hook")),
    });
    const out = call(kernel, "teardownHttp", context, scope);
    expect(await out).to.equal(undefined);
    expect(kernel.log).toHaveBeenCalledOnce();
    expect(container.scopeCount("request")).to.equal(0);
  });
});

describe("HttpKernel.handleHttp — le contexte servi, sans promesse quand rien n'attend", () => {
  function makeServing(serve: () => unknown): Loose {
    const context = { id: "ctx" };
    return makeKernel({
      createHttpContext: () => context,
      serveHttpContext: serve,
      onError: vi.fn(() => Promise.resolve("rendu d'erreur")),
      container: { leaveScope: vi.fn() },
      _context: context,
    });
  }

  it("pipeline synchrone → le contexte, pas une promesse", () => {
    const kernel = makeServing(() => "servi");
    expect(call(kernel, "handleHttp", {}, {}, {}, "http")).to.equal("servi");
    expect(kernel.onError).not.toHaveBeenCalled();
  });

  it("étape qui lève en synchrone → promesse d'`onError`", async () => {
    const error = new Error("sync");
    const kernel = makeServing(() => {
      throw error;
    });
    const out = call(kernel, "handleHttp", {}, {}, {}, "http");
    expect(isThenable(out)).to.equal(true);
    expect(await out).to.equal("rendu d'erreur");
    expect(kernel.onError).toHaveBeenCalledWith(error, kernel._context);
  });

  it("étape qui rejette → promesse d'`onError`", async () => {
    const error = new Error("async");
    const kernel = makeServing(() => Promise.reject(error));
    expect(await call(kernel, "handleHttp", {}, {}, {}, "http")).to.equal(
      "rendu d'erreur",
    );
    expect(kernel.onError).toHaveBeenCalledWith(error, kernel._context);
  });

  it("contexte impossible à construire → scope libéré, puis `onError`", async () => {
    const kernel = makeServing(() => "servi");
    kernel.createHttpContext = () => {
      throw new Error("ctor");
    };
    await call(kernel, "handleHttp", "scope", {}, {}, "http");
    expect(
      (kernel.container as { leaveScope: unknown }).leaveScope,
    ).toHaveBeenCalledWith("scope");
  });
});
