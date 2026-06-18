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
  Csp,
  CsrfProtect,
  CsrfExempt,
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

  @Csp({ "frame-src": ["https://youtube.com"], "img-src": ["https://cdn.x"] })
  embed() {}

  @CsrfProtect()
  protectedMutation() {}

  @CsrfExempt()
  exemptWebhook() {}
}

// @CsrfProtect de CLASSE → toutes les actions protégées (même non décorées).
@CsrfProtect()
class CsrfClassCtrl {
  anyAction() {}
}

// Contrôleur avec @Csp de CLASSE — fusionné additivement avec celui de méthode.
@Csp({ "frame-src": ["https://base.example"] })
class CspClassCtrl {
  @Csp({
    "frame-src": ["https://method.example"],
    "media-src": ["https://m.x"],
  })
  withMethod() {}

  inherited() {}
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
      cspDirectives: null,
      csrfProtect: false,
      csrfExempt: false,
    } satisfies RouteActionMeta);
  });

  it("captures the @UseSession intent", () => {
    const meta = computeActionMeta(DecoratedCtrl, "withSession");
    expect(meta.sessionIntent).to.deep.equal({ readOnly: true });
  });

  it("captures @Csp directives on a method", () => {
    const meta = computeActionMeta(DecoratedCtrl, "embed");
    expect(meta.cspDirectives).to.deep.equal({
      "frame-src": ["https://youtube.com"],
      "img-src": ["https://cdn.x"],
    });
  });

  it("returns null cspDirectives for an undecorated action", () => {
    expect(computeActionMeta(DecoratedCtrl, "bare").cspDirectives).to.equal(
      null,
    );
  });

  it("merges class + method @Csp additively (sources concatenated)", () => {
    const meta = computeActionMeta(CspClassCtrl, "withMethod");
    expect(meta.cspDirectives).to.deep.equal({
      "frame-src": ["https://base.example", "https://method.example"],
      "media-src": ["https://m.x"],
    });
  });

  it("inherits the class @Csp on an otherwise bare action", () => {
    const meta = computeActionMeta(CspClassCtrl, "inherited");
    expect(meta.cspDirectives).to.deep.equal({
      "frame-src": ["https://base.example"],
    });
  });

  it("captures @CsrfProtect / @CsrfExempt method markers", () => {
    expect(
      computeActionMeta(DecoratedCtrl, "protectedMutation").csrfProtect,
    ).to.equal(true);
    expect(
      computeActionMeta(DecoratedCtrl, "exemptWebhook").csrfExempt,
    ).to.equal(true);
    // mutuellement indépendants + faux par défaut
    const bare = computeActionMeta(DecoratedCtrl, "bare");
    expect(bare.csrfProtect).to.equal(false);
    expect(bare.csrfExempt).to.equal(false);
  });

  it("inherits class-level @CsrfProtect on a bare action", () => {
    expect(computeActionMeta(CsrfClassCtrl, "anyAction").csrfProtect).to.equal(
      true,
    );
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
