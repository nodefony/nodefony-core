/// <reference types="node" />
import { expect } from "chai";
import { Container, RequestContext } from "nodefony";
import Resolver from "../../src/Resolver.js";
import type Route from "../../src/Route.js";
import type { ControllerConstructor } from "../../src/Route.js";
import type { ContextType } from "@nodefony/http";
import {
  IsGranted,
  type RouteActionMeta,
  type SecurityRequirement,
} from "../../decorators/routerDecorators.js";

// P6 J7 — enforcement de l'autorisation dans le Resolver (AVANT newController).
// On teste via le contrat PUBLIC `executeAction` : un DENY/fail-closed throw 403
// avant tout controller ; un GRANT laisse l'action s'exécuter. Proxy
// `Object.create(prototype)` + champs injectés (pattern Resolver.test.ts).

const ROLE_CLAUSE: SecurityRequirement = {
  clauses: [{ anyOf: ["ROLE_ADMIN"] }],
};

function metaWith(security: SecurityRequirement | null): RouteActionMeta {
  return {
    paramsMeta: null,
    redirectMeta: null,
    httpCode: null,
    headerEntries: null,
    sessionIntent: null,
    security,
    cspDirectives: null,
  };
}

class StubCtrl {
  setRoute(): this {
    return this;
  }
  ping(): string {
    return "pong";
  }
}

function makeResolver(opts: {
  security: SecurityRequirement | null;
  decide?: (
    token: unknown,
    attr: string,
    subject?: unknown,
  ) => Promise<boolean>;
  variables?: { names: string[]; values: unknown[] };
}): Resolver {
  const r = Object.create(Resolver.prototype) as Resolver;
  const container = new Container();
  if (opts.decide) {
    container.set("authorization", { decide: opts.decide });
  }
  r.context = {
    container,
    response: undefined,
  } as unknown as ContextType;
  r.route = {
    variables: opts.variables?.names ?? [],
    actionMeta: metaWith(opts.security),
  } as unknown as Route;
  r.variables = opts.variables?.values ?? [];
  (r as unknown as { queryOverride: unknown }).queryOverride = null;
  r.controller = StubCtrl as unknown as ControllerConstructor;
  r.actionName = "ping";
  // newController stubbé : le GRANT exécute l'action sans DI réel.
  r.newController = (async () => new StubCtrl()) as Resolver["newController"];
  return r;
}

async function caught(p: Promise<unknown>): Promise<{ code?: number } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: number };
  }
}

describe("Resolver — enforcement @IsGranted (avant newController)", () => {
  it("DENY → 403 (l'action n'est jamais exécutée)", async () => {
    const r = makeResolver({
      security: ROLE_CLAUSE,
      decide: async () => false,
    });
    const err = await RequestContext.run({ requestId: "t", token: {} }, () =>
      caught(r.executeAction()),
    );
    expect(err?.code).to.equal(403);
  });

  it("GRANT → l'action s'exécute (la garde a laissé passer)", async () => {
    const r = makeResolver({ security: ROLE_CLAUSE, decide: async () => true });
    const out = await RequestContext.run({ requestId: "t", token: {} }, () =>
      r.executeAction(),
    );
    expect(out.result).to.equal("pong");
  });

  it("fail-closed : route gardée mais moteur authorization absent → 403", async () => {
    const r = makeResolver({ security: ROLE_CLAUSE }); // pas de decide → pas de service
    const err = await RequestContext.run({ requestId: "t", token: {} }, () =>
      caught(r.executeAction()),
    );
    expect(err?.code).to.equal(403);
  });

  it("fail-closed : route gardée mais aucune identité (token absent) → 403", async () => {
    const r = makeResolver({ security: ROLE_CLAUSE, decide: async () => true });
    // RequestContext sans `token` → fail-closed.
    const err = await RequestContext.run({ requestId: "t" }, () =>
      caught(r.executeAction()),
    );
    expect(err?.code).to.equal(403);
  });

  it("security null (non gardée) → 0 lookup authz, l'action s'exécute", async () => {
    // Pas de service authorization dans le container : si la garde s'exécutait,
    // ce serait un 403 fail-closed. Elle NE doit PAS s'exécuter (security null).
    const r = makeResolver({ security: null });
    const out = await RequestContext.run({ requestId: "t" }, () =>
      r.executeAction(),
    );
    expect(out.result).to.equal("pong");
  });

  it("AND : 2 clauses, la 2ᵉ refuse → 403", async () => {
    const security: SecurityRequirement = {
      clauses: [{ anyOf: ["ROLE_USER"] }, { anyOf: ["ROLE_ADMIN"] }],
    };
    const r = makeResolver({
      security,
      decide: async (_t, attr) => attr === "ROLE_USER", // ROLE_ADMIN refusé
    });
    const err = await RequestContext.run({ requestId: "t", token: {} }, () =>
      caught(r.executeAction()),
    );
    expect(err?.code).to.equal(403);
  });

  it("OR : anyOf=[A,B], seul B accordé → passe", async () => {
    const security: SecurityRequirement = {
      clauses: [{ anyOf: ["ROLE_A", "ROLE_B"] }],
    };
    const r = makeResolver({
      security,
      decide: async (_t, attr) => attr === "ROLE_B",
    });
    const out = await RequestContext.run({ requestId: "t", token: {} }, () =>
      r.executeAction(),
    );
    expect(out.result).to.equal("pong");
  });

  it("subject : le paramètre de route nommé est passé au voter", async () => {
    let seen: unknown;
    const security: SecurityRequirement = {
      clauses: [{ anyOf: ["doc.edit"], subjectParam: "id" }],
    };
    const r = makeResolver({
      security,
      decide: async (_t, _attr, subject) => {
        seen = subject;
        return true;
      },
      variables: { names: ["id"], values: ["42"] },
    });
    await RequestContext.run({ requestId: "t", token: {} }, () =>
      r.executeAction(),
    );
    expect(seen).to.equal("42");
  });

  // PONT forward : Controller.forward → callController(reload) → route=null →
  // la garde s'évalue via computeActionMeta (chemin froid, PAS le memo de route).
  // Défense en profondeur : un forward vers une action gardée re-vérifie l'autz.
  it("pont forward (route=null) : la garde s'évalue via computeActionMeta", async () => {
    class ForwardCtrl {
      setRoute(): this {
        return this;
      }
      @IsGranted("ROLE_ADMIN")
      ping(): string {
        return "pong";
      }
    }
    const r = Object.create(Resolver.prototype) as Resolver;
    const container = new Container();
    container.set("authorization", { decide: async () => false }); // refuse
    r.context = {
      container,
      response: undefined,
    } as unknown as ContextType;
    r.route = null; // forward : pas de route mémoïsée → computeActionMeta
    r.variables = [];
    (r as unknown as { queryOverride: unknown }).queryOverride = null;
    r.controller = ForwardCtrl as unknown as ControllerConstructor;
    r.actionName = "ping";
    r.newController = (async () =>
      new ForwardCtrl()) as Resolver["newController"];
    const err = await RequestContext.run({ requestId: "t", token: {} }, () =>
      caught(r.executeAction()),
    );
    expect(err?.code).to.equal(403); // garde appliquée même sans route mémoïsée
  });
});
