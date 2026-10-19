/// <reference types="node" />
import { expect } from "vitest";
import "reflect-metadata";
import { Container, RequestContext } from "nodefony";
import Controller from "../../src/Controller.js";
import Resolver from "../../src/Resolver.js";
import type Route from "../../src/Route.js";
import type { ControllerConstructor } from "../../src/Route.js";
import type { ContextType } from "@nodefony/http";
import {
  Anonymous,
  RequireAuthentication,
  computeActionMeta,
  type IAuthenticationRequirement,
  type RouteActionMeta,
  type SecurityRequirement,
} from "../../decorators/routerDecorators.js";

// `@RequireAuthentication` — exigence d'une connexion RÉCENTE et/ou faite avec
// certains moyens (RFC 8176), refusée en 401 « step-up » (RFC 9470). On éprouve
// le décorateur (validation, fusion classe + méthode) puis l'enforcement par le
// contrat PUBLIC `executeAction`, comme `securityEnforcement.test.ts`.

const SEC = 1000;

class StubCtrl extends Controller {
  override setRoute(route: Route): Route {
    return route;
  }
  ping(): string {
    return "pong";
  }
}

function metaWith(
  authentication: IAuthenticationRequirement | null,
  security: SecurityRequirement | null = null,
): RouteActionMeta {
  return {
    paramsMeta: null,
    schema: null,
    bodyStream: false,
    redirectMeta: null,
    httpCode: null,
    headerEntries: null,
    sessionIntent: null,
    security,
    authentication,
    cspDirectives: null,
    csrfProtect: false,
    csrfExempt: false,
    idempotent: null,
  };
}

/** Une session jouette : ce que `authFlow` a retenu à l'ouverture. */
function sessionWith(meta: Record<string, unknown> | null) {
  return meta === null ? null : { getMetaBag: (key: string) => meta[key] };
}

function makeResolver(opts: {
  authentication: IAuthenticationRequirement | null;
  security?: SecurityRequirement | null;
  session: ReturnType<typeof sessionWith>;
  decide?: () => Promise<boolean>;
  environment?: string;
}) {
  const r = Object.create(Resolver.prototype) as Resolver;
  const container = new Container();
  if (opts.decide) container.set("authorization", { decide: opts.decide });
  const headers: Record<string, string> = {};
  r.context = {
    container,
    session: opts.session,
    response: {
      setHeader: (name: string, value: string) => {
        headers[name.toLowerCase()] = value;
      },
    },
    kernel: {
      environment: opts.environment ?? "development",
      modules: { security: {} },
    },
  } as unknown as ContextType;
  r.route = {
    variables: [],
    actionMeta: metaWith(opts.authentication, opts.security ?? null),
  } as unknown as Route;
  r.variables = [];
  (r as unknown as { queryOverride: unknown }).queryOverride = null;
  r.controller = StubCtrl as unknown as ControllerConstructor;
  r.actionName = "ping";
  r.newController = async () => Object.create(StubCtrl.prototype) as StubCtrl;
  return { resolver: r, headers };
}

async function run(r: Resolver) {
  try {
    const out = await RequestContext.run({ requestId: "t", token: {} }, () =>
      r.executeAction(),
    );
    return { out, err: null };
  } catch (e) {
    return { out: null, err: e as { code?: number; message?: string } };
  }
}

const OTP_FRAIS = { maxAge: 60, amr: Object.freeze(["otp"]) };

describe("@RequireAuthentication — le décorateur", () => {
  it("🔴 refuse un maxAge qui n'est pas un entier de secondes > 0", () => {
    expect(() => RequireAuthentication({ maxAge: 0 })).to.throw(TypeError);
    expect(() => RequireAuthentication({ maxAge: 1.5 })).to.throw(TypeError);
    expect(() => RequireAuthentication({ maxAge: -60 })).to.throw(TypeError);
  });

  it("🔴 refuse un moyen vide", () => {
    expect(() => RequireAuthentication({ amr: [""] })).to.throw(TypeError);
  });

  it("une action sans décorateur ne porte aucune exigence (coût nul)", () => {
    class C {
      a() {}
    }
    expect(computeActionMeta(C, "a").authentication).to.equal(null);
  });

  it("classe + méthode fusionnent au plus STRICT : âge le plus court, moyens réunis", () => {
    @RequireAuthentication({ maxAge: 300, amr: ["pwd"] })
    class C {
      @RequireAuthentication({ maxAge: 60, amr: ["otp"] })
      a() {}
      b() {}
    }
    expect(computeActionMeta(C, "a").authentication).to.deep.equal({
      maxAge: 60,
      amr: ["pwd", "otp"],
    });
    // La méthode sans décorateur hérite de la classe telle quelle.
    expect(computeActionMeta(C, "b").authentication).to.deep.equal({
      maxAge: 300,
      amr: ["pwd"],
    });
  });

  it("@Anonymous sur la méthode lève l'exigence de la classe", () => {
    @RequireAuthentication({ maxAge: 60 })
    class C {
      @Anonymous()
      a() {}
    }
    expect(computeActionMeta(C, "a").authentication).to.equal(null);
  });
});

describe("@RequireAuthentication — l'enforcement (Resolver)", () => {
  it("connexion récente AVEC le second facteur → l'action s'exécute", async () => {
    const { resolver } = makeResolver({
      authentication: OTP_FRAIS,
      session: sessionWith({
        authAt: Date.now() - 5 * SEC,
        amr: ["pwd", "otp"],
      }),
    });
    const { out, err } = await run(resolver);
    expect(err).to.equal(null);
    expect(out).to.not.equal(null);
  });

  it("🔴 mot de passe seul quand `otp` est exigé → 401 step-up", async () => {
    const { resolver, headers } = makeResolver({
      authentication: OTP_FRAIS,
      session: sessionWith({ authAt: Date.now(), amr: ["pwd"] }),
    });
    const { err } = await run(resolver);
    expect(err?.code).to.equal(401);
    expect(err?.message).to.match(/n'a pas employé otp/u);
    expect(headers["www-authenticate"]).to.match(
      /error="insufficient_user_authentication"/u,
    );
  });

  it("🔴 connexion plus ancienne que maxAge → 401, et le défi porte max_age", async () => {
    const { resolver, headers } = makeResolver({
      authentication: OTP_FRAIS,
      session: sessionWith({
        authAt: Date.now() - 61 * SEC,
        amr: ["pwd", "otp"],
      }),
    });
    const { err } = await run(resolver);
    expect(err?.code).to.equal(401);
    expect(err?.message).to.match(/plus de 60 s/u);
    expect(headers["www-authenticate"]).to.match(/max_age="60"/u);
  });

  it("🔴 aucune session → 401 : ne pas savoir n'est pas une preuve", async () => {
    const { resolver } = makeResolver({
      authentication: { maxAge: null, amr: [] },
      session: null,
    });
    const { err } = await run(resolver);
    expect(err?.code).to.equal(401);
  });

  it("🔴 une session sans métadonnées d'ouverture est refusée", async () => {
    const { resolver } = makeResolver({
      authentication: { maxAge: null, amr: [] },
      session: sessionWith({}),
    });
    const { err } = await run(resolver);
    expect(err?.code).to.equal(401);
  });

  it("sans maxAge, le défi ne porte pas de max_age", async () => {
    const { resolver, headers } = makeResolver({
      authentication: { maxAge: null, amr: ["otp"] },
      session: sessionWith({ authAt: Date.now(), amr: ["pwd"] }),
    });
    await run(resolver);
    expect(headers["www-authenticate"]).to.not.match(/max_age/u);
  });

  it("🔴 un rôle refusé reste un 403 définitif — on ne redemande pas de connexion", async () => {
    const { resolver, headers } = makeResolver({
      authentication: OTP_FRAIS,
      security: { clauses: [{ anyOf: ["ROLE_ADMIN"] }], hasRoleClause: true },
      decide: async () => false,
      session: sessionWith({ authAt: Date.now(), amr: ["pwd"] }),
    });
    const { err } = await run(resolver);
    expect(err?.code).to.equal(403);
    expect(headers["www-authenticate"]).to.equal(undefined);
  });

  it("en production, le refus ne dit pas sa cause", async () => {
    const { resolver } = makeResolver({
      authentication: OTP_FRAIS,
      session: sessionWith({ authAt: Date.now(), amr: ["pwd"] }),
      environment: "production",
    });
    const { err } = await run(resolver);
    expect(err?.code).to.equal(401);
    expect(err?.message).to.equal("Authentication required");
  });
});
