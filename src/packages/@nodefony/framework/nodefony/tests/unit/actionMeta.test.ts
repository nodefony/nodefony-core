/// <reference types="node" />
import { expect } from "chai";
import "reflect-metadata";
import {
  computeActionMeta,
  resolveActionMeta,
  HttpCode,
  Header,
  Redirect,
  Param,
  UseSession,
  type RouteActionMeta,
} from "../../decorators/routerDecorators.js";

// P5 — snapshot figé des metadata d'action sur la route (memo 1er hit, pattern
// frère de routeExpectsBodyStream). On teste la FONCTION PURE (compute) et le
// MEMO (resolve) sans pipeline HTTP — mêmes décorateurs que le runtime.

class DecoratedCtrl {
  @HttpCode(201)
  @Header("X-A", "1")
  @Header("X-B", "2")
  @Redirect("/next", 301)
  full(@Param("id") _id?: string) {}

  bare() {}

  @UseSession({ readOnly: true })
  withSession() {}
}

describe("routerDecorators — computeActionMeta()", () => {
  it("snapshots @HttpCode/@Header/@Redirect/params of a decorated action", () => {
    const meta = computeActionMeta(DecoratedCtrl, "full");
    expect(meta.httpCode).to.equal(201);
    // Décorateurs TS = bottom-up : @Header le plus PROCHE de la méthode
    // s'exécute en premier → ordre d'insertion X-B puis X-A (même objet que
    // lisait l'ancien Object.entries par requête — comportement inchangé).
    expect(meta.headerEntries).to.deep.equal([
      ["X-B", "2"],
      ["X-A", "1"],
    ]);
    expect(meta.redirectMeta).to.deep.equal({ url: "/next", statusCode: 301 });
    expect(meta.paramsMeta).to.have.lengthOf(1);
    expect(meta.paramsMeta?.[0]).to.include({ source: "param", key: "id" });
  });

  it("returns all-null snapshot for an undecorated action", () => {
    const meta = computeActionMeta(DecoratedCtrl, "bare");
    expect(meta).to.deep.equal({
      paramsMeta: null,
      redirectMeta: null,
      httpCode: null,
      headerEntries: null,
      sessionIntent: null,
      security: null,
    } satisfies RouteActionMeta);
  });

  it("captures the @UseSession intent", () => {
    const meta = computeActionMeta(DecoratedCtrl, "withSession");
    expect(meta.sessionIntent).to.deep.equal({ readOnly: true });
  });

  it("returns the empty snapshot when ctor or method is missing", () => {
    expect(computeActionMeta(null, "full").httpCode).to.equal(null);
    expect(computeActionMeta(DecoratedCtrl, undefined).httpCode).to.equal(null);
  });
});

describe("routerDecorators — resolveActionMeta() (memo)", () => {
  it("memoizes on route.actionMeta — same reference on 2nd call", () => {
    const route = { controller: DecoratedCtrl, classMethod: "full" } as {
      controller: typeof DecoratedCtrl;
      classMethod: string;
      actionMeta?: RouteActionMeta;
    };
    const first = resolveActionMeta(route);
    expect(route.actionMeta).to.equal(first);
    expect(resolveActionMeta(route)).to.equal(first);
    expect(first.httpCode).to.equal(201);
  });

  it("memoizes the empty snapshot for a route without controller", () => {
    const route: { actionMeta?: RouteActionMeta } = {};
    const meta = resolveActionMeta(route);
    expect(meta.paramsMeta).to.equal(null);
    expect(resolveActionMeta(route)).to.equal(meta);
  });
});
