//
// ─── @GrpcService et GrpcController : routes, garde au démarrage, méta (#695) ───
//
// ADR-0026 D1. Une route littérale du Router par méthode du contrat ; les
// gardes lues sur la MÉTHODE DU CONTRAT ; les décorateurs sans effet en gRPC
// refusés au démarrage, en nommant méthode et décorateur.
//
// Débrancher (chacun fait tomber au moins un cas) :
//   - `GrpcController.assertScope` : la boucle qui fige `route.actionMeta` ;
//   - `inertDecorators` : une ligne ;
//   - `GrpcService` : le `["POST", "GET"]` de NO_SIDE_EFFECTS ;
//   - `claimGrpcService` : le refus du second point d'entrée.
//
import "reflect-metadata";
import { expect } from "vitest";
import { fileURLToPath } from "node:url";
import { create, createFileRegistry } from "@bufbuild/protobuf";
import type { DescService } from "@bufbuild/protobuf";
import { FileDescriptorProtoSchema } from "@bufbuild/protobuf/wkt";
import { GrpcEndpoint } from "@nodefony/http/grpc";
import type { ContextType } from "@nodefony/http";
import { BootConfigurationError, Kernel, Module, Pdu } from "nodefony";
import Router from "../../service/router.js";
import type Route from "../../src/Route.js";
import {
  Body,
  computeActionMeta,
  controllers,
  Csp,
  Header,
  HttpCode,
  Idempotent,
  IsGranted,
  Redirect,
  Scope,
  UseSession,
} from "../../decorators/routerDecorators.js";
import { GrpcController, GrpcService } from "../../grpc/index.js";
import { declareGrpcService } from "../../grpc/declarations.js";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  FixtureService,
  SayResponseSchema,
  type SayRequest,
} from "../fixtures/grpc/gen/nodefony/fwtest/v1/fixture_pb.js";

type SayInit = MessageInitShape<typeof SayResponseSchema>;

const MODULE_PATH = fileURLToPath(
  new URL("../../../index.ts", import.meta.url),
);
const PREFIX = "/nodefony.fwtest.v1.FixtureService";

// ─── Le contrôleur du contrat-fixture (typé, servi par @GrpcService) ─────────
//
// `@IsGranted` de CLASSE posé AU-DESSUS de `@GrpcService` : appliqué APRÈS lui.
// Une méta figée au montage des routes le manquerait ; figée au démarrage, non.
@IsGranted("ROLE_CLASS")
@GrpcService(FixtureService)
class FixtureController extends GrpcController {
  constructor(context: ContextType) {
    super("FixtureController", context);
  }

  @IsGranted("ROLE_SAY")
  say(request: SayRequest): SayInit {
    return { sentence: request.sentence };
  }

  ping(request: SayRequest): SayInit {
    return { sentence: request.sentence };
  }

  async *watch(request: SayRequest): AsyncIterable<SayInit> {
    yield { sentence: request.sentence };
  }

  async collect(requests: AsyncIterable<SayRequest>): Promise<SayInit> {
    let sentence = "";
    for await (const r of requests) sentence += r.sentence;
    return { sentence };
  }

  async *converse(requests: AsyncIterable<SayRequest>): AsyncIterable<SayInit> {
    for await (const r of requests) yield { sentence: r.sentence };
  }
}

// ─── Décor : un service par cas de refus (un contrat n'a qu'un point d'entrée) ─

let serial = 0;
/** Un service neuf, au nom unique, dont les méthodes sont nommées `names`. */
function makeService(names: string[]): DescService {
  serial += 1;
  const svc = `Refusal${serial}Service`;
  const file = create(FileDescriptorProtoSchema, {
    name: `refusal_${serial}.proto`,
    package: "nodefony.fwtest.v1",
    syntax: "proto3",
    messageType: [{ name: "Msg" }],
    service: [
      {
        name: svc,
        method: names.map((name) => ({
          name,
          inputType: ".nodefony.fwtest.v1.Msg",
          outputType: ".nodefony.fwtest.v1.Msg",
        })),
      },
    ],
  });
  const service = createFileRegistry(file, () => undefined).getService(
    `nodefony.fwtest.v1.${svc}`,
  );
  if (service === undefined) throw new Error("service introuvable");
  return service;
}

/** Déclare `ctor` comme point d'entrée de `service`, sans monter de route. */
function declare(ctor: object, names: string[] = ["Say"]): void {
  declareGrpcService(ctor, { service: makeService(names), routes: [] });
}

/** Le refus levé par `assertScope`, ou `null`. */
function refusal(ctor: { assertScope(): void }): Error | null {
  try {
    ctor.assertScope();
    return null;
  } catch (e) {
    expect(BootConfigurationError.is(e), "BootConfigurationError").to.equal(
      true,
    );
    return e instanceof Error ? e : null;
  }
}

function routeOf(localName: string): Route {
  const route = Router.getRoutesForController(FixtureController).find(
    (r) => r.name === `FixtureController::${localName}`,
  );
  if (route === undefined) throw new Error(`route ${localName} absente`);
  return route;
}

function makeRouter(): Router {
  const p = Object.create(Router.prototype) as Router;
  p.routes = Router.routes;
  p.log = (pci, severity, msgid, msg) =>
    new Pdu(pci, severity, "router", msgid, msg);
  return p;
}

interface FakeResponse {
  headers: Record<string, unknown>;
  setHeaders(h: Record<string, unknown>): void;
}
function makeCtx(
  pathname: string,
  method: string,
): ContextType & { response: FakeResponse } {
  const response: FakeResponse = {
    headers: {},
    setHeaders(h) {
      Object.assign(this.headers, h);
    },
  };
  return {
    request: { url: new URL(`http://localhost${pathname}`) },
    method,
    domain: "localhost",
    response,
  } as unknown as ContextType & { response: FakeResponse };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("@GrpcService — une route littérale par méthode du contrat", () => {
  it("cinq routes, à la racine, POST /<paquet.Service>/<Méthode>, action de base `serveGrpc`", () => {
    const routes = Router.getRoutesForController(FixtureController);
    expect(routes.map((r) => r.name).sort()).to.deep.equal(
      [
        "FixtureController::collect",
        "FixtureController::converse",
        "FixtureController::ping",
        "FixtureController::say",
        "FixtureController::watch",
      ].sort(),
    );
    for (const r of routes) expect(r.classMethod).to.equal("serveGrpc");
    const router = makeRouter();
    expect(
      router.resolve(makeCtx(`${PREFIX}/Say`, "POST")).route?.name,
    ).to.equal("FixtureController::say");
    expect(
      router.resolve(makeCtx(`${PREFIX}/Converse`, "POST")).route?.name,
    ).to.equal("FixtureController::converse");
  });

  it("GET refusé (405, Allow: POST) sur une méthode sans NO_SIDE_EFFECTS", () => {
    const ctx = makeCtx(`${PREFIX}/Say`, "GET");
    expect(() => makeRouter().resolve(ctx)).to.throw(/Not Allowed/);
    expect(ctx.response.headers.Allow).to.equal("POST");
  });

  it("GET servi sur la méthode NO_SIDE_EFFECTS (le GET de Connect), POST aussi", () => {
    const router = makeRouter();
    expect(
      router.resolve(makeCtx(`${PREFIX}/Ping`, "GET")).route?.name,
    ).to.equal("FixtureController::ping");
    expect(
      router.resolve(makeCtx(`${PREFIX}/Ping`, "POST")).route?.name,
    ).to.equal("FixtureController::ping");
  });

  it("le Router ignore la casse (c'est l'adaptateur qui la refuse, en 12) — aucun préfixe de contrôleur", () => {
    expect(
      makeRouter().resolve(
        makeCtx("/nodefony.fwtest.v1.fixtureservice/say", "POST"),
      ).route?.name,
    ).to.equal("FixtureController::say");
  });

  it("un second point d'entrée pour le même contrat est refusé, en le nommant", () => {
    let caught: unknown = null;
    try {
      @GrpcService(FixtureService)
      class SecondController extends FixtureController {}
      void SecondController;
    } catch (e) {
      caught = e;
    }
    expect(BootConfigurationError.is(caught)).to.equal(true);
    expect(String(caught)).to.match(
      /nodefony\.fwtest\.v1\.FixtureService.*déjà servi par « FixtureController »/,
    );
  });
});

describe("GrpcController.assertScope — méta lue sur la méthode du contrat", () => {
  beforeAll(() => {
    FixtureController.assertScope();
  });

  it("la garde de la MÉTHODE du contrat est sur sa route (pas celle de `serveGrpc`)", () => {
    const anyOf = routeOf("say").actionMeta?.security?.clauses.flatMap(
      (c) => c.anyOf,
    );
    expect(anyOf).to.include("ROLE_SAY");
    // Témoin : l'action de base, elle, ne la porte pas.
    const base = computeActionMeta(FixtureController, "serveGrpc");
    expect(base.security?.clauses.flatMap((c) => c.anyOf) ?? []).to.not.include(
      "ROLE_SAY",
    );
  });

  it("la garde de CLASSE posée au-dessus de @GrpcService vaut pour toutes les méthodes", () => {
    for (const name of ["say", "ping", "watch", "collect", "converse"]) {
      const anyOf = routeOf(name).actionMeta?.security?.clauses.flatMap(
        (c) => c.anyOf,
      );
      expect(anyOf, name).to.include("ROLE_CLASS");
    }
  });

  it("le corps reste en flux : `bodyStream` figé sur chaque route et sur sa méta", () => {
    for (const name of ["say", "ping", "watch", "collect", "converse"]) {
      expect(routeOf(name).bodyStream, name).to.equal(true);
      expect(routeOf(name).actionMeta?.bodyStream, name).to.equal(true);
    }
  });

  it("le point d'entrée de transport est posé sur le prototype : singleton → cible partagée", () => {
    const endpoint: unknown = Reflect.get(
      FixtureController.prototype,
      "grpcEndpoint",
    );
    expect(endpoint).to.be.instanceOf(GrpcEndpoint);
    expect(endpoint instanceof GrpcEndpoint && endpoint.perCall).to.equal(
      false,
    );
  });

  it('@Scope("request") → une cible par appel', () => {
    @Scope("request")
    class PerCallController extends GrpcController {
      constructor(context: ContextType) {
        super("PerCallController", context);
      }
      say(): object {
        return {};
      }
    }
    declare(PerCallController);
    PerCallController.assertScope();
    const endpoint: unknown = Reflect.get(
      PerCallController.prototype,
      "grpcEndpoint",
    );
    expect(endpoint instanceof GrpcEndpoint && endpoint.perCall).to.equal(true);
  });
});

describe("GrpcController.assertScope — refus au démarrage (S-grpc-18)", () => {
  it("CONTRÔLE POSITIF : une classe saine démarre", () => {
    class Healthy extends GrpcController {
      constructor(context: ContextType) {
        super("Healthy", context);
      }
      @IsGranted("ROLE_X")
      say(): object {
        return {};
      }
    }
    declare(Healthy);
    expect(refusal(Healthy)).to.equal(null);
  });

  it("sans @GrpcService", () => {
    class Bare extends GrpcController {
      constructor(context: ContextType) {
        super("Bare", context);
      }
    }
    expect(refusal(Bare)?.message).to.match(/« Bare » sans @GrpcService/);
  });

  it("méthode du contrat absente de la classe", () => {
    class Missing extends GrpcController {
      constructor(context: ContextType) {
        super("Missing", context);
      }
      say(): object {
        return {};
      }
    }
    declare(Missing, ["Say", "Other"]);
    expect(refusal(Missing)?.message).to.match(
      /méthode « other » : absente de la classe/,
    );
  });

  it("nom réservé par Controller (`render`) ou par GrpcController (`serveGrpc`)", () => {
    class Clash extends GrpcController {
      constructor(context: ContextType) {
        super("Clash", context);
      }
    }
    declare(Clash, ["Render"]);
    expect(refusal(Clash)?.message).to.match(
      /méthode « render » : ce nom est réservé par Controller/,
    );
    class Clash2 extends GrpcController {
      constructor(context: ContextType) {
        super("Clash2", context);
      }
    }
    declare(Clash2, ["ServeGrpc"]);
    expect(refusal(Clash2)?.message).to.match(
      /méthode « serveGrpc » : ce nom est réservé par GrpcController/,
    );
  });

  // Un décorateur par cas : le refus nomme la méthode ET le décorateur.
  const cases: Array<[string, RegExp, (ctor: { prototype: object }) => void]> =
    [
      [
        "@UseSession",
        /« say » : @UseSession/,
        (c) => decorate(c, UseSession()),
      ],
      [
        "@Csp",
        /« say » : @Csp/,
        (c) => decorate(c, Csp({ "img-src": ["'self'"] })),
      ],
      [
        "@Idempotent",
        /« say » : @Idempotent/,
        (c) => decorate(c, Idempotent()),
      ],
      ["@HttpCode", /« say » : @HttpCode/, (c) => decorate(c, HttpCode(201))],
      ["@Header", /« say » : @Header/, (c) => decorate(c, Header("x-a", "b"))],
      ["@Redirect", /« say » : @Redirect/, (c) => decorate(c, Redirect("/x"))],
      [
        "@Body (paramètre)",
        /« say » : @Body\/@Param\/@Query/,
        (c) => Body()(c.prototype, "say", 0),
      ],
    ];
  for (const [label, expected, apply] of cases) {
    it(`${label} sur une méthode du contrat`, () => {
      class Decorated extends GrpcController {
        constructor(context: ContextType) {
          super("Decorated", context);
        }
        say(): object {
          return {};
        }
      }
      apply(Decorated);
      declare(Decorated);
      expect(refusal(Decorated)?.message).to.match(expected);
    });
  }

  it("@UseSession posé sur la CLASSE vaut pour chaque méthode — refusé aussi", () => {
    @UseSession()
    class ClassSession extends GrpcController {
      constructor(context: ContextType) {
        super("ClassSession", context);
      }
      say(): object {
        return {};
      }
    }
    declare(ClassSession);
    expect(refusal(ClassSession)?.message).to.match(/« say » : @UseSession/);
  });

  it("la garde ARRÊTE le démarrage d'un module qui déclare la classe par @controllers", async () => {
    class BootRefused extends GrpcController {
      constructor(context: ContextType) {
        super("BootRefused", context);
      }
      @UseSession()
      say(): object {
        return {};
      }
    }
    declare(BootRefused);
    @controllers([BootRefused])
    class GrpcModule extends Module {
      static override critical = false;
      constructor(kernel: Kernel) {
        super("@nodefony/fw-grpc", kernel, MODULE_PATH, {});
      }
    }
    const k = new Kernel("development", null, { log: { active: false } });
    await k.addModule(GrpcModule);
    let caught: unknown = null;
    await k.fireLifecycle("onBoot", k).catch((e: unknown) => (caught = e));
    expect(BootConfigurationError.is(caught), "démarrage interrompu").to.equal(
      true,
    );
    expect(String(caught)).to.match(/« say » : @UseSession/);
  });
});

describe("GrpcController.serveGrpc — hors enregistrement", () => {
  it("une classe jamais enregistrée par le routeur refuse de servir, en le disant", () => {
    class Unregistered extends GrpcController {
      constructor(context: ContextType) {
        super("Unregistered", context);
      }
    }
    const instance = Object.create(Unregistered.prototype) as Unregistered;
    expect(() => instance.serveGrpc()).to.throw(/non enregistré/);
  });
});

/** Applique un décorateur de méthode à `say`. */
function decorate(
  ctor: { prototype: object },
  decorator: (
    target: object,
    key: string,
    descriptor: PropertyDescriptor,
  ) => unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, "say");
  if (descriptor === undefined) throw new Error("say absente");
  decorator(ctor.prototype, "say", descriptor);
}
