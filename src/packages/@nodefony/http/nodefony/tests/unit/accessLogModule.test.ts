/// <reference types="node" />
import { expect } from "vitest";
import HttpContext from "../../src/context/http/HttpContext.js";
import WebsocketContext from "../../src/context/websocket/WebsocketContext.js";

// La ligne d'accès est signée par le module qui a RÉPONDU (`GET /` → l'app),
// pas par le noyau qui l'écrit ; un contrôleur peut imposer le sien pour sa
// requête (`context.logModule`) ; sans route, le journal du noyau signe.

function makeCtx<T extends object>(
  proto: T,
  routeModule: string | null,
  logModule: string | null,
): { ctx: T; signed: (string | undefined)[] } {
  const ctx = Object.create(proto) as T;
  const signed: (string | undefined)[] = [];
  const entry = { text: "x", severity: "INFO", msgid: "req" };
  Object.assign(ctx, {
    relayAccessLog: null,
    logModule,
    requestId: "r",
    response: { statusCode: 200 },
    error: null,
    resolver:
      routeModule === null
        ? null
        : { route: { name: "r", module: { name: routeModule } } },
    httpKernel: {
      getRequestLogger: () => ({
        renderHttp: () => entry,
        renderWebsocket: () => entry,
      }),
    },
    log: (
      _pci: unknown,
      _sev?: string,
      _msgid?: string,
      _msg?: string,
      moduleName?: string,
    ) => {
      signed.push(moduleName);
      return {};
    },
  });
  return { ctx, signed };
}

describe("ligne d'accès — module signataire", () => {
  it("HTTP : le module de la route signe", () => {
    const { ctx, signed } = makeCtx(HttpContext.prototype, "app", null);
    (ctx as HttpContext).logRequest();
    expect(signed).toEqual(["app"]);
  });

  it("HTTP : le module posé par le contrôleur prime sur celui de la route", () => {
    const { ctx, signed } = makeCtx(HttpContext.prototype, "app", "billing");
    (ctx as HttpContext).logRequest();
    expect(signed).toEqual(["billing"]);
  });

  it("HTTP : sans route, rien d'imposé (le journal du noyau signe)", () => {
    const { ctx, signed } = makeCtx(HttpContext.prototype, null, null);
    (ctx as HttpContext).logRequest();
    expect(signed).toEqual([undefined]);
  });

  it("WebSocket : même règle", () => {
    const route = makeCtx(WebsocketContext.prototype, "studio", null);
    (route.ctx as WebsocketContext).logRequest();
    const forced = makeCtx(WebsocketContext.prototype, "studio", "chat");
    (forced.ctx as WebsocketContext).logRequest();
    expect([...route.signed, ...forced.signed]).toEqual(["studio", "chat"]);
  });
});
