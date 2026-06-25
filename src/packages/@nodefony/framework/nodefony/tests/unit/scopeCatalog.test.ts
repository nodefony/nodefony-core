/// <reference types="node" />
import { expect } from "chai";
import "reflect-metadata";
import {
  RequireScope,
  IsGranted,
  extractActionScopes,
} from "../../decorators/routerDecorators.js";
import { collectDeclaredApiScopes } from "../../src/scopeCatalog.js";
import Router from "../../service/router.js";

// P6.8 — découverte des scopes déclarés (`@RequireScope`) : la brique de lecture
// (extractActionScopes, pure) + l'agrégation par API (collectDeclaredApiScopes, qui
// scanne Router.routes). Source du catalogue du formulaire « créer une clé API ».

describe("extractActionScopes — scopes @RequireScope d'une action", () => {
  @RequireScope("orders")
  class OrdersCtrl {
    @RequireScope("orders:read")
    list() {}

    @RequireScope(["orders:write", "orders:admin"])
    create() {}

    @IsGranted("ROLE_USER") // un rôle, PAS un scope → jamais remonté ici
    plain() {}
  }

  class Bare {
    noop() {}
  }

  it("fusionne scope méthode + scope classe, dédupliqués", () => {
    expect(extractActionScopes(OrdersCtrl, "list").sort()).to.deep.equal([
      "orders",
      "orders:read",
    ]);
  });

  it("aplati un tableau de scopes (OR) en liste plate", () => {
    expect(extractActionScopes(OrdersCtrl, "create").sort()).to.deep.equal([
      "orders",
      "orders:admin",
      "orders:write",
    ]);
  });

  it("action sans @RequireScope méthode → hérite le scope de classe seul", () => {
    expect(extractActionScopes(OrdersCtrl, "plain")).to.deep.equal(["orders"]);
  });

  it("classe sans aucun scope → []", () => {
    expect(extractActionScopes(Bare, "noop")).to.deep.equal([]);
  });
});

describe("collectDeclaredApiScopes — agrégation par API (scan Router.routes)", () => {
  @RequireScope("orders:read")
  class OrdersCtrl {
    @RequireScope("orders:write")
    create() {}
  }

  @RequireScope("billing:read")
  class BillingCtrl {
    read() {}
  }

  // Router.routes est un registre statique — on l'isole le temps du test.
  let saved: (typeof Router.routes)[number][];
  beforeEach(() => {
    saved = [...Router.routes];
    Router.routes.length = 0;
  });
  afterEach(() => {
    Router.routes.length = 0;
    Router.routes.push(...saved);
  });

  const fakeRoute = (controller: unknown, classMethod: string) =>
    ({ controller, classMethod }) as unknown as (typeof Router.routes)[number];

  it("regroupe par préfixe d'API, APIs et scopes triés", () => {
    Router.routes.push(
      fakeRoute(OrdersCtrl, "create"),
      fakeRoute(BillingCtrl, "read"),
    );
    expect(collectDeclaredApiScopes()).to.deep.equal([
      { api: "billing", scopes: ["billing:read"] },
      { api: "orders", scopes: ["orders:read", "orders:write"] },
    ]);
  });

  it("ignore les routes sans controller/action et celles sans scope", () => {
    class Bare {
      noop() {}
    }
    Router.routes.push(
      fakeRoute(Bare, "noop"),
      fakeRoute(undefined, "x"),
      fakeRoute(OrdersCtrl, "create"),
    );
    expect(collectDeclaredApiScopes()).to.deep.equal([
      { api: "orders", scopes: ["orders:read", "orders:write"] },
    ]);
  });

  it("catalogue vide quand aucune route ne déclare de scope", () => {
    expect(collectDeclaredApiScopes()).to.deep.equal([]);
  });
});
