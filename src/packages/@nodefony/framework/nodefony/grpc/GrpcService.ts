import type { DescService } from "@bufbuild/protobuf";
import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import type { ServiceImpl } from "@connectrpc/connect";
import { BootConfigurationError } from "nodefony";
import Router from "../service/router";
import type { RouteOptions } from "../src/Route";
import { applyDeclaredRouteOptions } from "../decorators/routerDecorators";
import { GRPC_ACTION } from "./GrpcController";
import type { GrpcController } from "./GrpcController";
import { claimGrpcService, declareGrpcService } from "./declarations";
import type { IGrpcRoute } from "./declarations";

/**
 * Une classe qui peut servir le contrat `S` : elle étend `GrpcController` et
 * implémente CHAQUE méthode du contrat avec sa signature générée. Une méthode
 * manquante ou mal typée ne compile pas.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export type GrpcServiceClass<S extends DescService> = new (
  ...args: never[]
) => GrpcController & ServiceImpl<S>;

/**
 * Déclare un contrôleur comme le point d'entrée du service gRPC `service`
 * (le descripteur généré par `buf`, ex. `EchoService` de `echo_pb.ts`).
 *
 * Monte une route littérale du Router par méthode du contrat,
 * `POST /<paquet.Service>/<Méthode>`, plus `GET` pour une méthode déclarée
 * `option idempotency_level = NO_SIDE_EFFECTS` (le GET de Connect). Ces
 * routes passent par tout le pipeline — pare-feu, `@IsGranted`, hôtes
 * virtuels, profileur, liste des routes —, et leurs gardes se lisent sur la
 * méthode du contrat. La classe se déclare ensuite par `@controllers([...])`,
 * comme tout point d'entrée d'un module.
 *
 * Les décorateurs de classe `@Domain` et `@BypassFirewall` se placent SOUS
 * `@GrpcService` (lus au montage des routes, comme sous `@controller`).
 *
 * @param service - le descripteur du service.
 * @returns le décorateur de classe.
 * @throws BootConfigurationError quand une autre classe sert déjà ce contrat.
 *
 * @example
 * \@GrpcService(EchoService)
 * export class EchoController extends GrpcController {
 *   constructor(context: ContextType) {
 *     super("EchoController", context);
 *   }
 *   \@IsGranted("ROLE_ECHO")
 *   say(request: SayRequest) {
 *     return { sentence: request.sentence };
 *   }
 * }
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export function GrpcService<S extends DescService>(service: S) {
  return function <C extends GrpcServiceClass<S>>(ctor: C): C {
    const owner = claimGrpcService(service.typeName, ctor.name);
    if (owner !== null) {
      throw new BootConfigurationError(
        `@GrpcService(${service.typeName}) sur « ${ctor.name} » : ce service ` +
          `est déjà servi par « ${owner} ». Un contrat n'a qu'un point d'entrée.`,
      );
    }
    const routes: IGrpcRoute[] = [];
    for (const method of service.methods) {
      const options: RouteOptions = {
        prefix: `/${service.typeName}`,
        path: `/${method.name}`,
        constructor: ctor,
        className: ctor.name,
        classMethod: GRPC_ACTION,
        method:
          method.idempotency === MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
            ? ["POST", "GET"]
            : "POST",
      };
      applyDeclaredRouteOptions(ctor, options, method.localName);
      const route = Router.createRoute(
        `${ctor.name}::${method.localName}`,
        options,
      );
      routes.push({ route, method });
    }
    declareGrpcService(ctor, { service, routes });
    return ctor;
  };
}
