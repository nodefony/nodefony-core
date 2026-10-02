/**
 * Deux mises en forme d'un `Context` en arguments décorés, une seule règle.
 *
 * Le Resolver garde la sienne EN LIGNE (`Resolver._buildParamArgs`) : la
 * déléguer à `buildContextParamArgs` coûtait un appel de plus (~4 ns mesurés)
 * sur chaque requête à paramètres décorés. Les actions `@RealtimeAction`
 * appellent `buildContextParamArgs`. Deux copies divergent en silence — ce test
 * exige qu'elles rendent les MÊMES arguments, source par source.
 */
import { describe, it, expect } from "vitest";
import "reflect-metadata";
import { RequestContext } from "nodefony";
import Resolver from "../../src/Resolver.js";
import {
  buildContextParamArgs,
  type IParamArgSource,
  type ParamMeta,
} from "../../decorators/routerDecorators.js";

const cookies = { sid: "abc" };
const request = {
  queryGet: { q: "url" },
  queryPost: { title: "corps" },
  queryFile: [{ name: "f" }],
  headers: { "x-trace": "t1" },
  request: { stream: true },
};
const response = { kind: "response" };
const session = { get: (k: string) => (k === "lang" ? "fr" : undefined) };
const context = {
  request,
  response,
  session,
  getRequestCookies: (name?: string) =>
    name === undefined ? cookies : cookies[name as keyof typeof cookies],
};

/** Chaque source, avec et sans clé, à un index distinct. */
const metas: ParamMeta[] = [
  { source: "param", key: "id", index: 0 },
  { source: "param", index: 1 },
  { source: "query", key: "q", index: 2 },
  { source: "query", index: 3 },
  { source: "body", key: "title", index: 4 },
  { source: "body", index: 5 },
  { source: "headers", key: "X-Trace", index: 6 },
  { source: "cookie", key: "sid", index: 7 },
  { source: "cookie", index: 8 },
  { source: "session", key: "lang", index: 9 },
  { source: "session", index: 10 },
  { source: "req", index: 11 },
  { source: "res", index: 12 },
  { source: "file", index: 13 },
  { source: "files", index: 14 },
  { source: "user", index: 15 },
  { source: "body", stream: true, index: 16 },
];

type ResolverDouble = {
  context: unknown;
  route: { variables: string[] };
  variables: unknown[];
  queryOverride: Record<string, unknown> | null;
  _buildParamArgs(m: readonly ParamMeta[]): unknown[];
};

function makeResolver(
  queryOverride: Record<string, unknown> | null,
): ResolverDouble {
  const r = Object.create(Resolver.prototype) as ResolverDouble;
  r.context = context;
  r.route = { variables: ["id"] };
  r.variables = ["42"];
  r.queryOverride = queryOverride;
  return r;
}

const viaContext = (queryOverride?: Record<string, unknown>): unknown[] =>
  buildContextParamArgs(
    metas,
    context as unknown as IParamArgSource,
    { id: "42" },
    queryOverride,
  );

describe("buildContextParamArgs ≡ Resolver._buildParamArgs", () => {
  it("rend les mêmes arguments pour chaque source (requête HTTP)", () => {
    RequestContext.run(
      { requestId: "t", user: { identifier: "alice" } },
      () => {
        const fromResolver = makeResolver(null)._buildParamArgs(metas);
        const fromContext = viaContext();
        expect(fromContext).to.have.length(metas.length);
        expect(fromContext).to.deep.equal(fromResolver);
        // Mêmes OBJETS, pas seulement des copies égales.
        expect(fromContext[11]).to.equal(fromResolver[11]);
        expect(fromContext[15]).to.deep.equal({ identifier: "alice" });
      },
    );
  });

  it("rend les mêmes arguments sous le pont WS (query et corps de l'ALS)", () => {
    RequestContext.run(
      { requestId: "t", body: { title: "ws" }, user: { identifier: "bob" } },
      () => {
        const override = { q: "invoquée" };
        const fromResolver = makeResolver(override)._buildParamArgs(metas);
        const fromContext = viaContext(override);
        expect(fromContext).to.deep.equal(fromResolver);
        expect(fromContext[2]).to.equal("invoquée");
        expect(fromContext[4]).to.equal("ws");
      },
    );
  });
});
