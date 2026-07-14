import { expect } from "chai";
import { Pdu } from "nodefony";
import Router from "../../service/router.js";
import Route from "../../src/Route.js";
import type { ContextType } from "@nodefony/http";

/**
 * TESTS DE L'INDEX DE ROUTES (fast path étape 4) — complément du banc
 * routing-nonregression.test.ts (qui fige le contrat OBSERVABLE de resolve).
 *
 * Ici on cible les frontières PROPRES À L'INDEX :
 *   1. classification littérale vs dynamique (metachar regex → dynamique,
 *      comportement regex legacy intégralement préservé) ;
 *   2. lookup case-insensitive (les patterns sont compilés flag `i`) ;
 *   3. path racine `/` (normalisé en clé vide par setPattern) ;
 *   4. merge ordonné littérales ∪ dynamiques (positions entrelacées) ;
 *   5. garde-fou contre le swap DIRECT de la table (splice/push sans passer
 *      par l'API Router — pattern d'isolation des bancs de tests).
 */

interface FakeResponse {
  headers: Record<string, unknown>;
  setHeaders(h: Record<string, unknown>): void;
}

function makeCtx(
  pathname: string,
  method = "GET",
  domain = "localhost",
): ContextType & { response: FakeResponse } {
  const response: FakeResponse = {
    headers: {},
    setHeaders(h) {
      Object.assign(this.headers, h);
    },
  };
  return {
    request: { url: new URL(`http://${domain}${pathname}`) },
    method,
    domain,
    response,
  } as unknown as ContextType & { response: FakeResponse };
}

function makeRouter(): Router {
  const p = Object.create(Router.prototype) as Router;
  p.routes = Router.routes;
  // Le proxy n'a pas de syslog (pas de Module) → on substitue `log` par un stub
  // CONFORME au contrat `Service.log` (retourne un vrai Pdu, jamais consommé par
  // `resolve`) : muet, mais pas menteur sur la signature.
  p.log = (pci, severity, msgid, msg) =>
    new Pdu(pci, severity, "router", msgid, msg);
  return p;
}

let saved: Route[] = [];
beforeEach(() => {
  saved = Router.routes.splice(0);
});
afterEach(() => {
  Router.routes.splice(0);
  Router.routes.push(...saved);
});

describe("Routing index — classification littérale/dynamique", () => {
  it("path avec metachar regex (+) classé dynamique → matching regex legacy préservé", () => {
    // `^\/m+x$/i` : `+` NON échappé par compile() (qui n'échappe que / et .)
    // → matche /mmx (quantificateur) et PAS la string littérale /m+x.
    // Si l'index classait ce path en littéral, les deux comportements
    // s'inverseraient — ce test verrouille la frontière de classification.
    Router.createRoute("meta", { path: "/m+x" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/mmx")).route?.name).to.equal("meta");
    expect(router.resolve(makeCtx("/m+x")).resolve).to.equal(false);
  });

  it("path avec point (échappé par compile) reste littéral exact", () => {
    Router.createRoute("dotted", { path: "/files/app.json" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/files/app.json")).route?.name).to.equal(
      "dotted",
    );
    // `.` échappé → PAS un joker regex
    expect(router.resolve(makeCtx("/files/appxjson")).resolve).to.equal(false);
  });
});

describe("Routing index — casse et racine", () => {
  it("route déclarée en MixedCase servie en lowercase et UPPERCASE (flag i)", () => {
    Router.createRoute("cased", { path: "/CaSe/PaTh" });
    const router = makeRouter();
    expect(router.resolve(makeCtx("/case/path")).route?.name).to.equal("cased");
    expect(router.resolve(makeCtx("/CASE/PATH")).route?.name).to.equal("cased");
  });

  it("path racine / (normalisé clé vide) matche la requête /", () => {
    Router.createRoute("root", { path: "/" });
    expect(makeRouter().resolve(makeCtx("/")).route?.name).to.equal("root");
  });
});

describe("Routing index — merge ordonné littérales ∪ dynamiques", () => {
  it("littérale(pos0) + dynamique(pos1) + littérale(pos2) même path : l'ordre strict du scan est émulé", () => {
    Router.createRoute("lit-get", {
      path: "/x",
      requirements: { methods: ["GET"] },
    });
    Router.createRoute("dyn", { path: "/{p}" });
    Router.createRoute("lit-post", {
      path: "/x",
      requirements: { methods: ["POST"] },
    });
    const router = makeRouter();
    // GET /x → la littérale pos0 gagne (avant la dynamique pos1)
    expect(router.resolve(makeCtx("/x", "GET")).route?.name).to.equal(
      "lit-get",
    );
    // POST /x → pos0 jette 405 (continue), pos1 dynamique matche AVANT la
    // littérale POST pos2 — ordre d'insertion, pas de préférence littérale.
    expect(router.resolve(makeCtx("/x", "POST")).route?.name).to.equal("dyn");
  });
});

describe("Routing index — garde-fou mutations directes de la table", () => {
  it("swap splice/push à longueur égale (autres objets Route) → réindexé au resolve suivant", () => {
    Router.createRoute("a", { path: "/swap/a" });
    Router.createRoute("b", { path: "/swap/b" });
    const router = makeRouter();
    // construit l'index sur la table {a, b}
    expect(router.resolve(makeCtx("/swap/a")).route?.name).to.equal("a");
    // swap DIRECT (sans API Router) vers {c, d} — même longueur, objets ≠
    const replacement = [
      new Route("c", { path: "/swap/c" }),
      new Route("d", { path: "/swap/d" }),
    ];
    Router.routes.splice(0);
    Router.routes.push(...replacement);
    expect(router.resolve(makeCtx("/swap/c")).route?.name).to.equal("c");
    expect(router.resolve(makeCtx("/swap/a")).resolve).to.equal(false);
  });
});
