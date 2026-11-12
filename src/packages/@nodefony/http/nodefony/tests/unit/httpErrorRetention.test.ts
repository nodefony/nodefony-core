/// <reference types="node" />
//
// ─── Une erreur de requête ne retient pas sa requête (#695, trouvé par D10) ──
//
// `HttpError` LIT le contexte à sa construction (URL, contrôleur, action,
// réponse) et n'en garde aucune référence : elle survit souvent à sa requête —
// un abonné du canal `nodefony.http.request` qui garde le message
// (`message.error`), un journal différé, la cause d'une autre erreur — et
// retenait sinon le contexte ENTIER, sa réponse et sa requête.
//
// Débrancher : rétablir `this.context = context` (ou la réponse, la requête)
// dans le constructeur fait tomber le premier cas.
//
import { expect } from "vitest";
import HttpError from "../../src/errors/httpError.js";
import HttpContext from "../../src/context/http/HttpContext";

/** Un contexte minimal : ce que le constructeur de `HttpError` lit. */
function bareContext(): HttpContext {
  const ctx = Object.create(HttpContext.prototype) as HttpContext;
  Object.assign(ctx, {
    url: "/introuvable",
    response: { statusCode: 200, statusMessage: "OK", body: null },
    request: { url: "/introuvable" },
    resolver: { controller: { name: "UsersController" }, actionName: "show" },
  });
  return ctx;
}

/** Toutes les valeurs atteignables en un pas depuis l'erreur. */
function ownValues(err: HttpError): unknown[] {
  return Reflect.ownKeys(err).map((key) => Reflect.get(err, key));
}

describe("HttpError — lit sa requête, ne la garde pas", () => {
  it("aucune référence au contexte, à sa réponse ni à sa requête", () => {
    const ctx = bareContext();
    const err = new HttpError("Not Found", 404, ctx);
    const values = ownValues(err);
    expect(values).not.to.include(ctx);
    expect(values).not.to.include(ctx.response);
    expect(values).not.to.include(ctx.request);
  });

  it("garde ce qu'elle a lu : URL, contrôleur, action, réponse, code", () => {
    const err = new HttpError("Not Found", 404, bareContext());
    expect(err.url).to.equal("/introuvable");
    expect(err.controller).to.equal("UsersController");
    expect(err.action).to.equal("show");
    expect(err.jsonResponse).to.equal("404 OK");
    expect(err.code).to.equal(404);
  });

  it("toString détaillé quand l'erreur est née d'une requête", () => {
    const text = new HttpError("Not Found", 404, bareContext()).toString();
    expect(text).to.contain("/introuvable");
    expect(text).to.contain("UsersController");
  });
});
