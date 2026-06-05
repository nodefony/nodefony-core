/// <reference types="node" />
/**
 * P2.9 — `@Body({ stream:true })` : briques framework (décorateur + résolution
 * du paramètre + détection mémoïsée sur la route). Testé en isolation (pas de
 * serveur). Les décorateurs sont appliqués **manuellement** (fonction appelée
 * directement, pas la syntaxe `@`) → robuste vis-à-vis du transpileur de test.
 */
import { expect } from "chai";
import "reflect-metadata";
import {
  Body,
  resolveParamArg,
  routeExpectsBodyStream,
  PARAM_ARGS_METADATA,
} from "../../decorators/routerDecorators";
import type { ParamMeta } from "../../decorators/routerDecorators";

class Ctrl {
  upload(_body: unknown) {
    return _body;
  }
  classic(_body: unknown) {
    return _body;
  }
  field(_name: unknown) {
    return _name;
  }
}
// Application manuelle des décorateurs de paramètre.
Body({ stream: true })(Ctrl.prototype, "upload", 0);
Body()(Ctrl.prototype, "classic", 0);
Body("name")(Ctrl.prototype, "field", 0);

type RouteLike = {
  controller?: { prototype: object } | null;
  classMethod?: string;
  bodyStream?: boolean;
};

describe("P2.9 — @Body({ stream }) (briques framework)", () => {
  it("routeExpectsBodyStream = true pour une action @Body({stream:true})", () => {
    const route: RouteLike = { controller: Ctrl, classMethod: "upload" };
    expect(routeExpectsBodyStream(route)).to.equal(true);
    expect(route.bodyStream, "mémoïsé sur la route").to.equal(true);
  });

  it("routeExpectsBodyStream = false pour @Body() classique", () => {
    const route: RouteLike = { controller: Ctrl, classMethod: "classic" };
    expect(routeExpectsBodyStream(route)).to.equal(false);
    expect(route.bodyStream).to.equal(false);
  });

  it("routeExpectsBodyStream = false pour @Body('field')", () => {
    const route: RouteLike = { controller: Ctrl, classMethod: "field" };
    expect(routeExpectsBodyStream(route)).to.equal(false);
  });

  it("mémo : si bodyStream déjà résolu, ne relit pas Reflect", () => {
    // bodyStream=true posé à la main alors que l'action n'a pas de stream →
    // le helper doit RENVOYER le cache sans recalculer (preuve du memo).
    const route: RouteLike = {
      controller: Ctrl,
      classMethod: "classic",
      bodyStream: true,
    };
    expect(routeExpectsBodyStream(route)).to.equal(true);
  });

  it("route sans controller/classMethod → false (pas de crash)", () => {
    expect(routeExpectsBodyStream({})).to.equal(false);
  });

  it("resolveParamArg body+stream → flux brut (ctx.request.request)", () => {
    const fakeReadable = {
      pipe() {},
      read() {},
    } as unknown as NodeJS.ReadableStream;
    const ctx = {
      paramsMap: {},
      request: { request: fakeReadable, queryPost: { a: 1 } },
      getRequestCookies() {},
    };
    const meta: ParamMeta = { source: "body", index: 0, stream: true };
    expect(resolveParamArg(meta, ctx)).to.equal(fakeReadable);
  });

  it("resolveParamArg body SANS stream → queryPost inchangé", () => {
    const ctx = {
      paramsMap: {},
      request: { request: {}, queryPost: { a: 1 } },
      getRequestCookies() {},
    };
    const meta: ParamMeta = { source: "body", index: 0 };
    expect(resolveParamArg(meta, ctx)).to.deep.equal({ a: 1 });
  });

  it("@Body({stream}) pose bien stream=true dans le ParamMeta (Reflect)", () => {
    const metas = (Reflect.getMetadata(
      PARAM_ARGS_METADATA,
      Ctrl.prototype,
      "upload",
    ) ?? []) as ParamMeta[];
    const bodyMeta = metas.find((m) => m.source === "body");
    expect(bodyMeta?.stream).to.equal(true);
    const classicMetas = (Reflect.getMetadata(
      PARAM_ARGS_METADATA,
      Ctrl.prototype,
      "classic",
    ) ?? []) as ParamMeta[];
    expect(classicMetas.find((m) => m.source === "body")?.stream).to.not.equal(
      true,
    );
  });
});
