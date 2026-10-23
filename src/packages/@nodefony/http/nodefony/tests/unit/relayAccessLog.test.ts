/// <reference types="node" />
import { expect } from "vitest";
import HttpContext from "../../src/context/http/HttpContext.js";

// Ligne d'accès d'une requête RELAYÉE par le proxy inverse : le relais écrit
// la réponse BRUTE, le contexte garde son 200 par défaut — la ligne doit dire
// le statut de l'amont ; un montage `accessLog: "errors"` (relais de Vite)
// n'écrit que les échecs.

interface IProbe {
  ctx: HttpContext;
  logged: number[];
}

function makeCtx(
  relay: "all" | "errors" | null,
  upstreamStatus: number,
): IProbe {
  const ctx = Object.create(HttpContext.prototype) as HttpContext;
  const logged: number[] = [];
  const response = {
    statusCode: 200,
    response: { statusCode: upstreamStatus },
  };
  Object.assign(ctx, {
    relayAccessLog: relay,
    response,
    error: null,
    httpKernel: {
      getRequestLogger: () => ({
        renderHttp: (c: { response: { statusCode: number } }) => {
          logged.push(c.response.statusCode);
          return { text: "x", severity: "INFO", msgid: "req" };
        },
        renderWebsocket: () => ({ text: "", severity: "INFO", msgid: "req" }),
      }),
    },
    log: () => undefined,
  });
  return { ctx, logged };
}

describe("HttpContext.logRequest — requête relayée", () => {
  it("accessLog errors : une réussite de l'amont n'écrit rien", () => {
    const { ctx, logged } = makeCtx("errors", 200);
    ctx.logRequest();
    expect(logged).toEqual([]);
    const notModified = makeCtx("errors", 304);
    notModified.ctx.logRequest();
    expect(notModified.logged).toEqual([]);
  });

  it("accessLog errors : un échec de l'amont est écrit, avec SON statut", () => {
    const { ctx, logged } = makeCtx("errors", 404);
    ctx.logRequest();
    expect(logged).toEqual([404]);
  });

  it("accessLog all : tout est écrit, avec le statut de l'amont (pas le 200 du contexte)", () => {
    const { ctx, logged } = makeCtx("all", 304);
    ctx.logRequest();
    expect(logged).toEqual([304]);
  });

  it("requête servie par l'application : la réponse brute n'est pas lue", () => {
    const { ctx, logged } = makeCtx(null, 500);
    ctx.logRequest();
    expect(logged).toEqual([200]);
  });
});
