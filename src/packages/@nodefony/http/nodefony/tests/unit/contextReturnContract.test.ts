/// <reference types="node" />
/**
 * Contrat de retour des contextes (#505) — pendant de
 * `httpKernelReturnContract.test.ts` côté `Context`, `HttpContext` et
 * `WebsocketContext`.
 *
 * - `_runAfterResponse` : `undefined` sans hook, une promesse qui ne rejette
 *   jamais sinon ;
 * - `HttpContext.handle` : rend ce que rend l'action, sans l'envelopper dans
 *   une promesse ; 404 levé en synchrone ;
 * - `WebsocketContext` : une action qui lève en SYNCHRONE garde les deux
 *   chemins d'erreur d'avant — au handshake, la socket est fermée avec son
 *   code (RFC 6455) ; sur un message, l'erreur est rendue à l'appelant sans
 *   passer par le `catch` qui fermerait en 1011.
 *
 * Montage minimal : `Object.create(X.prototype)` + doublures.
 */
import { expect, vi } from "vitest";
import Context from "../../src/context/Context.js";
import HttpContext from "../../src/context/http/HttpContext.js";
import WebsocketContext from "../../src/context/websocket/WebsocketContext.js";
import HttpResponse from "../../src/context/http/Response.js";
import HttpError from "../../src/errors/httpError.js";

type Loose = Record<string, unknown>;

function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function make<T extends object>(proto: T, fields: Loose): T & Loose {
  return Object.assign(Object.create(proto) as T & Loose, fields);
}

describe("Context._runAfterResponse — rien à attendre sans hook", () => {
  function makeContext(fns: unknown[] | null): Context & Loose {
    return make(Context.prototype, {
      _afterResponseFns: fns,
      _afterResponseFired: false,
      log: vi.fn(),
    });
  }

  it("aucun hook → undefined", () => {
    expect(makeContext(null)._runAfterResponse()).to.equal(undefined);
    expect(makeContext([])._runAfterResponse()).to.equal(undefined);
  });

  it("hooks → promesse ; ils tournent une seule fois, dans l'ordre", async () => {
    const order: number[] = [];
    const context = makeContext([
      () => {
        order.push(1);
      },
      async () => {
        order.push(2);
      },
    ]);
    const out = context._runAfterResponse();
    expect(isThenable(out)).to.equal(true);
    await out;
    expect(order).to.deep.equal([1, 2]);
    expect(context._runAfterResponse()).to.equal(undefined);
    expect(order).to.deep.equal([1, 2]);
  });

  it("un hook qui lève → journalisé, les suivants tournent, la promesse TIENT", async () => {
    const seen: string[] = [];
    const context = makeContext([
      () => {
        throw new Error("sync");
      },
      () => Promise.reject(new Error("async")),
      () => {
        seen.push("dernier");
      },
    ]);
    await context._runAfterResponse();
    expect(context.log).toHaveBeenCalledTimes(2);
    expect(seen).to.deep.equal(["dernier"]);
  });
});

describe("HttpContext.handle — rend ce que rend l'action", () => {
  function makeHttp(resolver: unknown, extra: Loose = {}): HttpContext & Loose {
    return make(HttpContext.prototype, {
      isRedirect: false,
      kernel: null,
      router: null,
      resolver,
      setTimeout: vi.fn(),
      fire: vi.fn(),
      setMetaData: vi.fn(),
      ...extra,
    });
  }

  it("action synchrone → sa valeur, pas une promesse", () => {
    const rendered = { body: "ok" };
    const context = makeHttp({ resolve: true, callController: () => rendered });
    expect(context.handle()).to.equal(rendered);
  });

  it("action asynchrone → sa promesse, telle quelle", () => {
    const pending = Promise.resolve("ok");
    const context = makeHttp({ resolve: true, callController: () => pending });
    expect(context.handle()).to.equal(pending);
  });

  it("aucune route → HttpError 404 levée en SYNCHRONE", () => {
    const context = makeHttp({ resolve: false });
    let caught: unknown;
    try {
      void context.handle();
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(HttpError);
    expect((caught as HttpError).code).to.equal(404);
  });

  it("redirection posée → le contexte, une fois l'envoi fait ; l'action n'est pas appelée", async () => {
    const callController = vi.fn();
    const context = makeHttp(
      { resolve: true, callController },
      { isRedirect: true, send: () => Promise.resolve(undefined) },
    );
    expect(await context.handle()).to.equal(context);
    expect(callController).not.toHaveBeenCalled();
  });
});

describe("HttpContext.send — l'API d'envoi, synchrone dans le cas nominal", () => {
  function makeSending(extra: Loose = {}): HttpContext & Loose {
    const nodeResponse = { writableEnded: false };
    const response = {
      response: nodeResponse,
      encoding: "utf8",
      statusCode: 200,
      isHeaderSent: () => false,
      setBody: vi.fn(),
      send: vi.fn(() => {
        nodeResponse.writableEnded = true;
        return response;
      }),
      end: vi.fn(() => nodeResponse),
    };
    return make(HttpContext.prototype, {
      finished: false,
      sended: false,
      isRedirect: false,
      session: null,
      _timingEnabled: false,
      response,
      listenerCount: () => 0,
      writeHead: vi.fn(),
      log: vi.fn(),
      ...extra,
    });
  }

  it("ni session, ni hook, réponse unique → la réponse, pas une promesse", () => {
    const context = makeSending();
    const out = context.send("corps");
    expect(isThenable(out)).to.equal(false);
    expect(out).to.equal(context.response);
    expect(context.sended).to.equal(true);
  });

  it("session ouverte → promesse (écriture du store), la réponse part après", async () => {
    const context = makeSending({
      session: {},
      saveSession: () => Promise.resolve(null),
    });
    const out = context.send("corps");
    expect(isThenable(out)).to.equal(true);
    expect(await out).to.equal(context.response);
    expect(context.sended).to.equal(true);
  });

  it("réponse déjà partie → `Response Already sended` levée en SYNCHRONE", () => {
    const context = makeSending({ sended: true });
    expect(() => context.send("corps")).to.throw("Response Already sended");
  });

  it("close() sur un contexte déjà démonté → la réponse, sans relire le contexte libéré", () => {
    // Vécu : sur un chemin qui attend, le démontage (écouteur `close` de la
    // réponse Node) libérait le contexte AVANT `close()`, qui lisait alors
    // `listenerCount` sur un centre de notifications nul — une exception par
    // requête, avalée en DEBUG par `onError`.
    const context = makeSending({
      finished: true,
      listenerCount: () => {
        throw new Error("notificationsCenter not initialized");
      },
    });
    expect(context.close()).to.equal(context.response);
  });
});

describe("HttpResponse.send — réponse unique terminée d'un seul appel", () => {
  it("rend la réponse elle-même, en synchrone, après `end(corps)`", () => {
    const end = vi.fn();
    const response = make(HttpResponse.prototype, {
      context: { isRedirect: false },
      flushing: false,
      setBody: vi.fn(),
      response: { writableEnded: false, end },
    });
    // `payload` est un accesseur sur des champs `#` : masqué sur l'instance.
    Object.defineProperty(response, "payload", { value: "corps" });
    Object.defineProperty(response, "payloadEncoding", { value: "utf8" });
    const out = response.send("corps");
    expect(out).to.equal(response);
    expect(end).toHaveBeenCalledOnce();
  });

  it("réponse Node absente → levée en SYNCHRONE", () => {
    const response = make(HttpResponse.prototype, {
      context: { isRedirect: false },
      response: null,
    });
    expect(() => response.end()).to.throw("response not found");
  });
});

describe("WebsocketContext — une action qui lève en SYNCHRONE", () => {
  function makeWs(failure: Error, extra: Loose = {}): WebsocketContext & Loose {
    return make(WebsocketContext.prototype, {
      rejected: false,
      requestEnded: true,
      kernel: undefined,
      response: null,
      resolver: {
        resolve: true,
        route: {},
        match: () => undefined,
        callController: () => {
          throw failure;
        },
      },
      fireAsync: vi.fn(() => Promise.resolve([])),
      setMetaData: vi.fn(),
      saveSession: () => Promise.resolve(null),
      logMessageContent: vi.fn(),
      close: vi.fn(),
      reject: vi.fn(),
      ...extra,
    });
  }

  it("handshake : la socket est FERMÉE avec le code de l'erreur, puis l'erreur rejetée", async () => {
    const error = new HttpError("interdit", 403);
    const context = makeWs(error);
    let caught: unknown;
    await context.handle().catch((e: unknown) => {
      caught = e;
    });
    expect(caught).to.equal(error);
    expect(context.close).toHaveBeenCalledWith(403, error.message);
  });

  it("message : l'erreur est RENDUE (promesse rompue), jamais fermée en 1011", async () => {
    const error = new Error("action");
    const context = makeWs(error);
    const out = context.handleMessage("coucou", false);
    let caught: unknown;
    await out.catch((e: unknown) => {
      caught = e;
    });
    expect(caught).to.equal(error);
    expect(context.reject).not.toHaveBeenCalled();
  });
});
