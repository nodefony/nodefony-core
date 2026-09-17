/// <reference types="node" />
/**
 * Unit — le dump plat `framework/routes` RESTREINT par `?q=`.
 *
 * C'est l'endpoint que sert `nodefony inspect routes <cible>`. Son argument
 * était annoncé par l'aide de la commande et jeté en silence : la commande
 * rendait les centaines de routes de l'application. Ce banc éprouve les deux
 * moitiés de la réparation — le filtre balaye bien tous les champs annoncés, et
 * l'absence de motif rend TOUJOURS le dump entier (une recherche facultative ne
 * doit jamais se transformer en page vide).
 *
 * Routes créées sur le Router statique → nettoyage par préfixe en `afterEach`,
 * même technique que `PlaygroundAdminApi.test`.
 */
import { expect } from "chai";
import "reflect-metadata";
import Router from "../../service/router.js";
import type Route from "../../src/Route.js";
import { createFrameworkAdminApi } from "../../src/FrameworkAdminApi.js";
import type { IAdminEndpoint, IAdminRequest } from "nodefony";
import type { IAdminBroker } from "../../interfaces/IAdminBroker";

class AuthCtrl {
  login() {}
}
class BillingCtrl {
  invoices() {}
}

type RouteCtor = NonNullable<Route["controller"]>;

/** Broker minimal — l'endpoint `routes` ne lit que le Router. */
const broker = {
  list: () => [],
  routes: () => [],
} as unknown as IAdminBroker;

/** Requête admin sans query : le dump entier. */
const sansFiltre = {
  params: {},
  query: {},
  body: null,
  roles: [],
} as unknown as IAdminRequest;

/** Requête admin portant un motif de recherche. */
const avecFiltre = (q: string): IAdminRequest =>
  ({
    params: {},
    query: { q },
    body: null,
    roles: [],
  }) as unknown as IAdminRequest;

function poseRoute(
  name: string,
  opts: {
    path: string;
    classMethod: string;
    ctor: unknown;
    methods?: string[];
    module?: string;
  },
): void {
  const r = Router.createRoute(name, {
    path: opts.path,
    constructor: opts.ctor as RouteCtor,
    classMethod: opts.classMethod,
    requirements: {
      methods: (opts.methods ?? ["GET"]) as NonNullable<Route["method"]>[],
    },
  });
  if (opts.module) r.module = { name: opts.module };
}

function nettoie(): void {
  for (let i = Router.routes.length - 1; i >= 0; i--) {
    if (Router.routes[i].name.startsWith("rf.")) Router.routes.splice(i, 1);
  }
}

/** L'endpoint plat du dump, tel que la commande `inspect` l'appelle. */
function endpointRoutes(): IAdminEndpoint {
  return createFrameworkAdminApi(broker)
    .adminEndpoints()
    .find((e) => e.path === "routes") as IAdminEndpoint;
}

async function dump(request: IAdminRequest): Promise<{ name: string }[]> {
  return (await endpointRoutes().handler(request)) as { name: string }[];
}

/** Les routes POSÉES par ce banc, les autres appartenant à l'application. */
const aNous = (rows: { name: string }[]): string[] =>
  rows.map((r) => r.name).filter((n) => n.startsWith("rf."));

describe("framework/routes — le dump plat est restreint par ?q=", () => {
  beforeEach(() => {
    poseRoute("rf.login", {
      path: "/nodefony/security/api/auth/login",
      classMethod: "login",
      ctor: AuthCtrl,
      methods: ["POST"],
      module: "security",
    });
    poseRoute("rf.invoices", {
      path: "/billing/invoices",
      classMethod: "invoices",
      ctor: BillingCtrl,
      module: "billing",
    });
  });
  afterEach(nettoie);

  it("rend le dump ENTIER quand aucune cible n'est donnée", async () => {
    expect(aNous(await dump(sansFiltre))).to.have.members([
      "rf.login",
      "rf.invoices",
    ]);
  });

  it("ne garde que les routes dont le CHEMIN porte le motif", async () => {
    const noms = aNous(await dump(avecFiltre("auth")));
    expect(noms).to.deep.equal(["rf.login"]);
  });

  it("cherche aussi dans le nom, le controller, l'action, le module et les méthodes", async () => {
    // Un champ par assertion : si le prédicat cesse d'en balayer un, on sait
    // LEQUEL — un test qui les groupe rendrait le même rouge pour six causes.
    expect(aNous(await dump(avecFiltre("rf.invoices")))).to.deep.equal([
      "rf.invoices",
    ]);
    expect(aNous(await dump(avecFiltre("BillingCtrl")))).to.deep.equal([
      "rf.invoices",
    ]);
    expect(aNous(await dump(avecFiltre("login")))).to.deep.equal(["rf.login"]);
    expect(aNous(await dump(avecFiltre("billing")))).to.deep.equal([
      "rf.invoices",
    ]);
    expect(aNous(await dump(avecFiltre("POST")))).to.deep.equal(["rf.login"]);
  });

  it("ignore la casse du motif", async () => {
    expect(aNous(await dump(avecFiltre("AUTH")))).to.deep.equal(["rf.login"]);
  });

  it("rend une liste VIDE quand rien ne correspond — jamais le dump entier", async () => {
    const rows = await dump(avecFiltre("zzz-aucune-route-ne-porte-ceci"));
    expect(rows).to.deep.equal([]);
  });
});
