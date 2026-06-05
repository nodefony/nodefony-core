import { expect } from "chai";
import "reflect-metadata";
import {
  Param,
  Body,
  Query,
  Headers,
  Cookie,
  Session,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  buildParamArgs,
  resolveParamArg,
  PARAM_ARGS_METADATA,
  type ParamMeta,
  type IParamArgContext,
} from "../../decorators/routerDecorators.js";

/**
 * Lit les métadonnées de paramètres posées sur une méthode de contrôleur.
 */
function metasOf(target: object, propertyKey: string): ParamMeta[] {
  return Reflect.getMetadata(PARAM_ARGS_METADATA, target, propertyKey) || [];
}

// ─── 1. Métadonnées posées par les décorateurs ───────────────────────────────

describe("Parameter decorators — métadonnées posées", () => {
  it("pose source + key + index pour chaque décorateur", () => {
    class Ctrl {
      action(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Param("id") _p: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Query("q") _q: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Body() _b: unknown,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Headers("Content-Type") _h: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Cookie("sid") _c: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Session("user") _s: unknown,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Req() _req: unknown,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Res() _res: unknown,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @UploadedFile() _f: unknown,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @UploadedFiles() _fs: unknown,
      ) {
        return null;
      }
    }
    const metas = metasOf(Ctrl.prototype, "action");
    const at = (i: number) => metas.find((m) => m.index === i);

    expect(at(0)).to.include({ source: "param", key: "id", index: 0 });
    expect(at(1)).to.include({ source: "query", key: "q", index: 1 });
    expect(at(2)).to.include({ source: "body", index: 2 });
    expect(at(2)?.key).to.equal(undefined);
    expect(at(3)).to.include({ source: "headers", key: "Content-Type" });
    expect(at(4)).to.include({ source: "cookie", key: "sid" });
    expect(at(5)).to.include({ source: "session", key: "user" });
    expect(at(6)).to.include({ source: "req", index: 6 });
    expect(at(7)).to.include({ source: "res", index: 7 });
    expect(at(8)).to.include({ source: "file", index: 8 });
    expect(at(9)).to.include({ source: "files", index: 9 });
  });

  it("plusieurs décorateurs sur la MÊME méthode s'accumulent (pas d'écrasement)", () => {
    class Ctrl {
      action(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Query("a") _a: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        @Query("b") _b: string,
      ) {
        return null;
      }
    }
    const metas = metasOf(Ctrl.prototype, "action");
    expect(metas).to.have.lengthOf(2);
    expect(metas.map((m) => m.key).sort()).to.deep.equal(["a", "b"]);
  });
});

// ─── 2. Résolution pure (buildParamArgs / resolveParamArg) ────────────────────

/** Faux contexte de requête couvrant toutes les sources. */
function fakeCtx(over: Partial<IParamArgContext> = {}): IParamArgContext {
  return {
    paramsMap: { id: "42", slug: "hello" },
    request: {
      queryGet: { q: "search", page: "2" },
      queryPost: { name: "john" },
      queryFile: ["FILE_A", "FILE_B"],
      headers: { "content-type": "application/json", host: "localhost" },
    },
    response: { __res: true },
    session: { get: (k: string) => ({ user: "alice", role: "admin" })[k] },
    getRequestCookies: (name?: string) =>
      name === undefined
        ? { sid: "abc", theme: "dark" }
        : (({ sid: "abc", theme: "dark" } as Record<string, string>)[name] ??
          null),
    ...over,
  };
}

describe("resolveParamArg — résolution par source", () => {
  const ctx = fakeCtx();
  const r = (meta: Omit<ParamMeta, "index">) =>
    resolveParamArg({ ...meta, index: 0 }, ctx);

  it("param avec clé → variable de route", () => {
    expect(r({ source: "param", key: "id" })).to.equal("42");
  });
  it("param sans clé → map complète", () => {
    expect(r({ source: "param" })).to.deep.equal({ id: "42", slug: "hello" });
  });
  it("query avec clé / sans clé", () => {
    expect(r({ source: "query", key: "q" })).to.equal("search");
    expect(r({ source: "query" })).to.deep.equal({ q: "search", page: "2" });
  });
  it("body avec clé / sans clé", () => {
    expect(r({ source: "body", key: "name" })).to.equal("john");
    expect(r({ source: "body" })).to.deep.equal({ name: "john" });
  });
  it("headers — lookup insensible à la casse (Node lowercase)", () => {
    expect(r({ source: "headers", key: "Content-Type" })).to.equal(
      "application/json",
    );
    expect(r({ source: "headers", key: "HOST" })).to.equal("localhost");
  });
  it("headers sans clé → objet complet", () => {
    expect(r({ source: "headers" })).to.deep.equal({
      "content-type": "application/json",
      host: "localhost",
    });
  });
  it("cookie délègue à getRequestCookies (clé / sans clé)", () => {
    expect(r({ source: "cookie", key: "sid" })).to.equal("abc");
    expect(r({ source: "cookie" })).to.deep.equal({
      sid: "abc",
      theme: "dark",
    });
  });
  it("session — get(key) / objet session complet", () => {
    expect(r({ source: "session", key: "user" })).to.equal("alice");
    expect(r({ source: "session" })).to.equal(ctx.session);
  });
  it("req → request, res → response", () => {
    expect(r({ source: "req" })).to.equal(ctx.request);
    expect(r({ source: "res" })).to.equal(ctx.response);
  });
  it("file → premier fichier, files → tableau complet", () => {
    expect(r({ source: "file" })).to.equal("FILE_A");
    expect(r({ source: "files" })).to.deep.equal(["FILE_A", "FILE_B"]);
  });
});

describe("resolveParamArg — robustesse (contexte partiel / WS)", () => {
  it("request absent → query/body/headers/file = undefined, pas de throw", () => {
    const ctx = fakeCtx({ request: null });
    expect(resolveParamArg({ source: "query", key: "q", index: 0 }, ctx)).to.be
      .undefined;
    expect(resolveParamArg({ source: "body", index: 0 }, ctx)).to.be.undefined;
    expect(resolveParamArg({ source: "headers", key: "x", index: 0 }, ctx)).to
      .be.undefined;
    expect(resolveParamArg({ source: "file", index: 0 }, ctx)).to.be.undefined;
    expect(resolveParamArg({ source: "files", index: 0 }, ctx)).to.be.undefined;
  });
  it("session null → session avec clé = undefined, sans clé = null", () => {
    const ctx = fakeCtx({ session: null });
    expect(resolveParamArg({ source: "session", key: "user", index: 0 }, ctx))
      .to.be.undefined;
    expect(resolveParamArg({ source: "session", index: 0 }, ctx)).to.equal(
      null,
    );
  });
});

describe("buildParamArgs — placement positionnel", () => {
  it("place chaque valeur à son index, trous = undefined", () => {
    const metas: ParamMeta[] = [
      { source: "param", key: "id", index: 0 },
      { source: "query", key: "q", index: 2 },
    ];
    const args = buildParamArgs(metas, fakeCtx());
    expect(args[0]).to.equal("42");
    expect(args[1]).to.be.undefined; // trou
    expect(args[2]).to.equal("search");
    expect(args).to.have.lengthOf(3);
  });

  it("metas vides → tableau vide", () => {
    expect(buildParamArgs([], fakeCtx())).to.deep.equal([]);
  });
});
