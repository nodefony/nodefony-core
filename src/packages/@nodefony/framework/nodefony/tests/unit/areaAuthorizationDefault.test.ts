/// <reference types="node" />
import { expect } from "chai";
import { Container, RequestContext } from "nodefony";
import Controller from "../../src/Controller.js";
import Resolver from "../../src/Resolver.js";
import type Route from "../../src/Route.js";
import type { ControllerConstructor } from "../../src/Route.js";
import type { ContextType } from "@nodefony/http";
import type {
  RouteActionMeta,
  SecurityRequirement,
} from "../../decorators/routerDecorators.js";

// Le FILET DE ZONE : une route qu'aucune garde ne couvre hérite du rôle exigé
// par sa zone du firewall. Sans lui, la zone du plan d'administration n'exige
// qu'une SESSION — donc tout compte authentifié, y compris un simple
// utilisateur de l'application, lit l'état du serveur.
//
// Ce qui est verrouillé ici, ce sont surtout les DISPENSES : la règle serait
// fausse sans elles (un `@IsGranted("ROLE_SUPERVISOR")` deviendrait
// inatteignable, et les points d'entrée `me` / `sessions/mine` du plan
// d'administration disparaîtraient pour leur propre propriétaire).
//
// Harnais : proxy `Object.create(prototype)` + champs injectés, comme
// `securityEnforcement.test.ts` — le vrai constructeur exige name+context+DI.

const ROLE_GARDE: SecurityRequirement = {
  clauses: [{ anyOf: ["ROLE_SUPERVISOR"] }],
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
    csrfProtect: false,
    csrfExempt: false,
    idempotent: null,
  };
}

class StubCtrl extends Controller {
  override setRoute(route: Route): Route {
    return route;
  }
  ping(): string {
    return "pong";
  }
}

/** Zone du firewall, réduite à ce que le Resolver en lit. */
interface ZoneStub {
  security: boolean;
  roles: readonly string[] | null;
}

function zone(roles: readonly string[] | null, security = true): ZoneStub {
  return { security, roles };
}

function makeResolver(opts: {
  /** Garde de l'ACTION (`@IsGranted`) — `null` = route non gardée. */
  security?: SecurityRequirement | null;
  /** Zone du firewall posée sur le contexte — `null` = hors zone. */
  area?: ZoneStub | null;
  /** La route décide seule de son autorisation (pont du plan d'administration). */
  selfGuarded?: boolean;
  /** La route court-circuite le firewall (elle EST le mécanisme d'auth). */
  bypassFirewall?: boolean;
  /** Les attributs que l'identité de la requête porte. */
  accorde?: readonly string[];
  /** Collecte les attributs soumis au jury (pour prouver CE qui est demandé). */
  demandes?: string[];
  /** Transport de la requête — `"WEBSOCKET"` pour jouer une socket. */
  method?: string;
  /** Invocation par message (pont WS-RPC) plutôt qu'ouverture de connexion. */
  messageInvocation?: boolean;
}): Resolver {
  const r = Object.create(Resolver.prototype) as Resolver;
  const container = new Container();
  const accorde = opts.accorde ?? [];
  container.set("authorization", {
    decide: async (_token: unknown, attr: string) => {
      opts.demandes?.push(attr);
      return accorde.includes(attr);
    },
  });
  r.context = {
    container,
    response: undefined,
    kernel: undefined,
    security: opts.area ?? null,
    method: opts.method ?? "GET",
  } as unknown as ContextType;
  r.route = {
    variables: [],
    selfGuarded: opts.selfGuarded ?? false,
    actionMeta: metaWith(opts.security ?? null),
  } as unknown as Route;
  r.variables = [];
  (r as unknown as { queryOverride: unknown }).queryOverride = null;
  r.bypassFirewall = opts.bypassFirewall ?? false;
  r.messageInvocation = opts.messageInvocation ?? false;
  r.controller = StubCtrl as unknown as ControllerConstructor;
  r.actionName = "ping";
  r.newController = async () => Object.create(StubCtrl.prototype) as StubCtrl;
  return r;
}

/** Exécute l'action sous une identité, et rend l'erreur éventuelle. */
async function joue(r: Resolver): Promise<{ code?: number } | null> {
  return RequestContext.run({ requestId: "t", token: {} }, async () => {
    try {
      await r.executeAction();
      return null;
    } catch (e) {
      return e as { code?: number };
    }
  });
}

describe("Resolver — rôle par défaut hérité de la zone du firewall", () => {
  it("route NON gardée dans une zone à rôle : un compte sans le rôle est refusé (403)", async () => {
    const r = makeResolver({
      area: zone(["ROLE_NODEFONY_ADMIN"]),
      accorde: ["ROLE_USER"],
    });
    const err = await joue(r);
    expect(err?.code).to.equal(403);
  });

  it("route NON gardée dans une zone à rôle : le porteur du rôle passe", async () => {
    const r = makeResolver({
      area: zone(["ROLE_NODEFONY_ADMIN"]),
      accorde: ["ROLE_NODEFONY_ADMIN"],
    });
    expect(await joue(r)).to.equal(null);
  });

  it("le rôle demandé est bien celui de la ZONE (pas un autre)", async () => {
    const demandes: string[] = [];
    const r = makeResolver({
      area: zone(["ROLE_NODEFONY_ADMIN"]),
      accorde: ["ROLE_NODEFONY_ADMIN"],
      demandes,
    });
    await joue(r);
    expect(demandes).to.deep.equal(["ROLE_NODEFONY_ADMIN"]);
  });

  it("plusieurs rôles de zone = OU : le second suffit", async () => {
    const r = makeResolver({
      area: zone(["ROLE_NODEFONY_ADMIN", "ROLE_SUPERVISOR"]),
      accorde: ["ROLE_SUPERVISOR"],
    });
    expect(await joue(r)).to.equal(null);
  });

  // NON-RÉGRESSION — c'est la totalité des zones existantes d'une application :
  // elles n'exigent qu'une identité, et rien ne doit changer pour elles.
  it("zone SANS rôle : aucun jury n'est consulté, l'action s'exécute", async () => {
    const demandes: string[] = [];
    const r = makeResolver({ area: zone(null), demandes });
    expect(await joue(r)).to.equal(null);
    expect(demandes).to.deep.equal([]);
  });

  it("hors zone : rien ne s'applique", async () => {
    const r = makeResolver({ area: null });
    expect(await joue(r)).to.equal(null);
  });

  it("zone publique explicite (security=false) : rien ne s'applique", async () => {
    const r = makeResolver({ area: zone(["ROLE_NODEFONY_ADMIN"], false) });
    expect(await joue(r)).to.equal(null);
  });

  describe("les trois dispenses — sans elles la règle serait fausse", () => {
    // Vécu : `/nodefony/studio/api/stats` est gardée ROLE_SUPERVISOR parce que
    // la supervision est le métier de l'exploitant, pas de l'administrateur de
    // la plateforme. Si la zone écrasait cette garde, la page deviendrait
    // inatteignable pour qui elle a été écrite.
    it("garde d'action : c'est ELLE qui décide, la zone ne s'ajoute pas", async () => {
      const demandes: string[] = [];
      const r = makeResolver({
        security: ROLE_GARDE,
        area: zone(["ROLE_NODEFONY_ADMIN"]),
        accorde: ["ROLE_SUPERVISOR"],
        demandes,
      });
      expect(await joue(r)).to.equal(null);
      expect(demandes).to.deep.equal(["ROLE_SUPERVISOR"]);
    });

    // Les routes du pont d'administration résolvent leur rôle PAR POINT
    // D'ENTRÉE (`executeAdmin`). Le rôle de zone les écraserait toutes avec le
    // même, et `me` / `sessions/mine` — déclarés accessibles à leur
    // propriétaire — disparaîtraient pour un compte non administrateur.
    it("route qui décide seule (selfGuarded) : la zone ne s'applique pas", async () => {
      const demandes: string[] = [];
      const r = makeResolver({
        area: zone(["ROLE_NODEFONY_ADMIN"]),
        selfGuarded: true,
        accorde: [],
        demandes,
      });
      expect(await joue(r)).to.equal(null);
      expect(demandes).to.deep.equal([]);
    });

    // Le flux de connexion vit dans la zone qu'il sert : exiger un rôle pour
    // s'y connecter serait un verrou dont la clé est à l'intérieur.
    it("route qui court-circuite le firewall : la zone ne s'applique pas", async () => {
      const r = makeResolver({
        area: zone(["ROLE_NODEFONY_ADMIN"]),
        bypassFirewall: true,
        accorde: [],
      });
      expect(await joue(r)).to.equal(null);
    });
  });

  // La quatrième dispense, et de loin la plus risquée : elle porte sur le
  // TRANSPORT, pas sur une déclaration de route. Mal posée, elle ouvrirait un
  // contournement — il suffirait de passer par une socket pour échapper au
  // rôle. Les deux moitiés sont donc verrouillées ensemble.
  describe("WebSocket — le tuyau s'ouvre, les frames restent gardées", () => {
    it("ouverture de connexion : la zone ne s'applique pas (sinon 0 socket)", async () => {
      const demandes: string[] = [];
      const r = makeResolver({
        area: zone(["ROLE_NODEFONY_ADMIN"]),
        method: "WEBSOCKET",
        messageInvocation: false,
        accorde: [],
        demandes,
      });
      expect(await joue(r)).to.equal(null);
      expect(demandes).to.deep.equal([]);
    });

    // L'invariant du projet : `api.request {path}` n'accorde JAMAIS plus que
    // `GET {path}`. Si ce test tombe, la dispense d'ouverture est devenue un
    // contournement — on échapperait au rôle en passant par une socket.
    it("invocation par frame : la zone s'applique — un compte sans rôle est refusé", async () => {
      const r = makeResolver({
        area: zone(["ROLE_NODEFONY_ADMIN"]),
        method: "WEBSOCKET",
        messageInvocation: true,
        accorde: ["ROLE_USER"],
      });
      const err = await joue(r);
      expect(
        err?.code,
        "une frame n'accorde jamais plus que la requête HTTP équivalente",
      ).to.equal(403);
    });

    it("invocation par frame : le porteur du rôle passe (la garde n'est pas aveugle)", async () => {
      const r = makeResolver({
        area: zone(["ROLE_NODEFONY_ADMIN"]),
        method: "WEBSOCKET",
        messageInvocation: true,
        accorde: ["ROLE_NODEFONY_ADMIN"],
      });
      expect(await joue(r)).to.equal(null);
    });
  });

  it("l'exigence est mémoïsée PAR ZONE et gelée (0 alloc par requête)", async () => {
    const z = zone(["ROLE_NODEFONY_ADMIN"]);
    const lire = (r: Resolver): SecurityRequirement | null =>
      (
        r as unknown as { _areaSecurity(): SecurityRequirement | null }
      )._areaSecurity();
    const a = lire(makeResolver({ area: z }));
    const b = lire(makeResolver({ area: z }));
    expect(a).to.equal(b); // même référence → fabriquée une seule fois
    expect(Object.isFrozen(a)).to.equal(true);
    expect(Object.isFrozen(a?.clauses)).to.equal(true);
    // Une AUTRE zone a sa propre exigence.
    const autre = lire(makeResolver({ area: zone(["ROLE_NODEFONY_ADMIN"]) }));
    expect(autre).to.not.equal(a);
  });
});
