/// <reference types="node" />
/**
 * Unit tests — PlaygroundAdminApi (data plane du Playground Studio).
 *
 * Vérifie la sérialisation form-ready des routes (transports, params décorés,
 * gardes) et le gating de composition (`createFrameworkAdminApi` n'inclut
 * `playground/routes` que sur opt-in dev). Routes créées sur le Router statique
 * → cleanup par préfixe en afterEach (même technique qu'AdminBroker.test).
 */
import { expect } from "chai";
import "reflect-metadata";
import Router from "../../service/router.js";
import type Route from "../../src/Route.js";
import AdminApiController from "../../controller/AdminApiController.js";
import { buildPlaygroundSnapshot } from "../../src/PlaygroundAdminApi.js";
import { createFrameworkAdminApi } from "../../src/FrameworkAdminApi.js";
import {
  Get,
  Post,
  Body,
  Query,
  Param,
  Idempotent,
  IsGranted,
  CurrentUser,
} from "../../decorators/routerDecorators.js";

// Controller de démo — mêmes décorateurs que le runtime (saveur duplex).
class PlaygroundDemoCtrl {
  @Post("/")
  @Idempotent()
  @IsGranted("ROLE_USER")
  create(@Body() _body?: unknown, @CurrentUser() _user?: unknown) {}

  @Get("/")
  list(@Query("q") _q?: string) {}

  @Get("/")
  show(@Param("id") _id?: string) {}
}

type RouteCtor = NonNullable<Route["controller"]>;

function makeRoute(
  name: string,
  opts: {
    path: string;
    classMethod: string;
    methods: string[];
    ctor?: unknown;
    module?: string;
  },
): Route {
  const r = Router.createRoute(name, {
    path: opts.path,
    constructor: (opts.ctor ?? PlaygroundDemoCtrl) as RouteCtor,
    classMethod: opts.classMethod,
    requirements: { methods: opts.methods as NonNullable<Route["method"]>[] },
  });
  if (opts.module) r.module = { name: opts.module };
  return r;
}

function cleanupRoutes(): void {
  for (let i = Router.routes.length - 1; i >= 0; i--) {
    if (Router.routes[i].name.startsWith("pg.")) Router.routes.splice(i, 1);
  }
}

describe("PlaygroundAdminApi — buildPlaygroundSnapshot()", () => {
  afterEach(cleanupRoutes);

  it("serializes a duplex action: transports, decorated params, guards", () => {
    makeRoute("pg.create", {
      path: "/api/items",
      classMethod: "create",
      methods: ["POST", "WEBSOCKET"],
      module: "demo",
    });
    const { controllers } = buildPlaygroundSnapshot();
    const ctrl = controllers.find((c) => c.name === "PlaygroundDemoCtrl");
    expect(ctrl, "controller group").to.exist;
    expect(ctrl!.module).to.equal("demo");
    const action = ctrl!.actions.find((a) => a.route === "pg.create");
    expect(action, "action").to.exist;
    expect(action!.methods).to.deep.equal(["POST", "WEBSOCKET"]);
    expect(action!.duplex).to.be.true;
    expect(action!.path).to.equal("/api/items");
    expect(action!.action).to.equal("create");
    // Params décorés — source + clé + position (formulaire auto Studio).
    expect(action!.params).to.deep.equal([
      { source: "body", key: null, index: 0, stream: false },
      { source: "user", key: null, index: 1, stream: false },
    ]);
    // Gardes — badges Studio.
    expect(action!.guards.idempotent).to.deep.equal({ required: true });
    expect(action!.guards.security).to.not.be.null;
    expect(action!.guards.security!.clauses[0].anyOf).to.deep.equal([
      "ROLE_USER",
    ]);
    expect(action!.guards.csrfProtect).to.be.false;
    expect(action!.guards.bypassFirewall).to.be.false;
  });

  it("serializes a plain GET: no duplex, query param, no guards", () => {
    makeRoute("pg.list", {
      path: "/api/items",
      classMethod: "list",
      methods: ["GET"],
    });
    const { controllers } = buildPlaygroundSnapshot();
    const action = controllers
      .find((c) => c.name === "PlaygroundDemoCtrl")!
      .actions.find((a) => a.route === "pg.list")!;
    expect(action.duplex).to.be.false;
    expect(action.params).to.deep.equal([
      { source: "query", key: "q", index: 0, stream: false },
    ]);
    expect(action.guards.security).to.be.null;
    expect(action.guards.idempotent).to.be.null;
    expect(action.guards.scopes).to.deep.equal([]);
  });

  it("captures path variables ({id}) for the form", () => {
    makeRoute("pg.show", {
      path: "/api/items/{id}",
      classMethod: "show",
      methods: ["GET"],
    });
    const { controllers } = buildPlaygroundSnapshot();
    const action = controllers
      .find((c) => c.name === "PlaygroundDemoCtrl")!
      .actions.find((a) => a.route === "pg.show")!;
    expect(action.variables).to.deep.equal(["id"]);
    expect(action.params).to.deep.equal([
      { source: "param", key: "id", index: 0, stream: false },
    ]);
  });

  it("excludes AdminApiController (data plane bridge) and controller-less routes", () => {
    makeRoute("pg.admin", {
      path: "/nodefony/x/api/y",
      classMethod: "dispatch",
      methods: ["GET"],
      ctor: AdminApiController,
    });
    Router.createRoute("pg.bare", { path: "/bare" }); // sans controller
    const { controllers } = buildPlaygroundSnapshot();
    const names = controllers.map((c) => c.name);
    expect(names).to.not.include("AdminApiController");
    const all = controllers.flatMap((c) => c.actions.map((a) => a.route));
    expect(all).to.not.include("pg.admin");
    expect(all).to.not.include("pg.bare");
  });

  it("sorts actions by path inside a controller", () => {
    makeRoute("pg.show", {
      path: "/api/items/{id}",
      classMethod: "show",
      methods: ["GET"],
    });
    makeRoute("pg.create", {
      path: "/api/items",
      classMethod: "create",
      methods: ["POST"],
    });
    const { controllers } = buildPlaygroundSnapshot();
    const paths = controllers
      .find((c) => c.name === "PlaygroundDemoCtrl")!
      .actions.map((a) => a.path);
    expect(paths).to.deep.equal(["/api/items", "/api/items/{id}"]);
  });
});

describe("createFrameworkAdminApi — playground gating", () => {
  it("includes playground/routes only when opted in (dev)", () => {
    const withPg = createFrameworkAdminApi(undefined, { playground: true });
    const paths = withPg.adminEndpoints().map((e) => e.path);
    expect(paths).to.include("playground/routes");

    const without = createFrameworkAdminApi(undefined);
    expect(without.adminEndpoints().map((e) => e.path)).to.not.include(
      "playground/routes",
    );

    const explicitOff = createFrameworkAdminApi(undefined, {
      playground: false,
    });
    expect(explicitOff.adminEndpoints().map((e) => e.path)).to.not.include(
      "playground/routes",
    );
  });
});
