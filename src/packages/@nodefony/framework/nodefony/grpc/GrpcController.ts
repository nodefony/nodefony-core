import { HttpContext } from "@nodefony/http";
import { GrpcEndpoint, markGrpcRoute } from "@nodefony/http/grpc";
import { BootConfigurationError } from "nodefony";
import Controller from "../src/Controller";
import {
  computeActionMeta,
  getReservedActionNames,
} from "../decorators/routerDecorators";
import type { RouteActionMeta } from "../decorators/routerDecorators";
import { grpcDeclarationOf } from "./declarations";

/**
 * Nom de l'action de base, celle que toute route gRPC exécute : elle remet la
 * requête à l'adaptateur. Les gardes, elles, se lisent sur la méthode du
 * contrat.
 *
 * @internal
 */
export const GRPC_ACTION = "serveGrpc";

/**
 * Ce que chaque décorateur sans effet en gRPC laisse dans la méta d'action —
 * un refus au démarrage le nomme (ADR-0026 D1, point 5 ; S-grpc-18).
 */
function inertDecorators(meta: RouteActionMeta): string[] {
  const found: string[] = [];
  if (meta.paramsMeta !== null) found.push("@Body/@Param/@Query… (paramètres)");
  if (meta.schema !== null) found.push("schéma de route");
  if (meta.sessionIntent !== null) found.push("@UseSession");
  if (meta.cspDirectives !== null) found.push("@Csp");
  if (meta.idempotent !== null) found.push("@Idempotent");
  if (meta.httpCode !== null) found.push("@HttpCode");
  if (meta.headerEntries !== null) found.push("@Header");
  if (meta.redirectMeta !== null) found.push("@Redirect");
  return found;
}

/**
 * Classe de base d'un point d'entrée gRPC (ADR-0026 D1), jumelle de
 * `RealtimeController` : marquée par `@GrpcService(Contrat)`, déclarée par
 * `@controllers([...])`. Chaque méthode du contrat est une méthode de la
 * classe, appelée par l'adaptateur Connect avec `(request, HandlerContext)` ;
 * la logique métier vit dans un service injecté.
 *
 * Singleton par défaut : aucune instance par appel, l'adaptateur lie les
 * méthodes une fois. `@Scope("request")` donne une instance par appel.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export abstract class GrpcController extends Controller {
  /**
   * Le point d'entrée de transport, posé au démarrage sur le prototype de la
   * classe déclarée (`assertScope`) : une lecture de prototype par appel.
   */
  declare private readonly grpcEndpoint: GrpcEndpoint | undefined;

  /**
   * Vérifie la déclaration gRPC de la classe et fige ses routes — au
   * démarrage (`Router.setController`), jamais à la première requête.
   *
   * Refuse : une classe sans `@GrpcService` ; une méthode du contrat absente
   * de la classe ou dont le nom est réservé par le framework ; un décorateur
   * sans effet en gRPC sur une méthode du contrat (ou sur la classe) — le
   * refus nomme la méthode et le décorateur.
   *
   * Fige ensuite, sur chaque route, la méta d'action lue sur la MÉTHODE DU
   * CONTRAT (l'action exécutée reste celle de la base) et le corps laissé en
   * flux : les gardes valent quel que soit l'ordre des décorateurs de classe.
   *
   * @throws BootConfigurationError sur une déclaration refusée.
   */
  static override assertScope(): void {
    const declaration = grpcDeclarationOf(this);
    if (declaration === undefined) {
      throw new BootConfigurationError(
        `Contrôleur gRPC « ${this.name} » sans @GrpcService(Contrat) : ` +
          "rien ne dit quel service il sert. Poser @GrpcService sur la classe.",
      );
    }
    const typeName = declaration.service.typeName;
    const reserved = getReservedActionNames();
    const metas = new Map<string, RouteActionMeta>();
    for (const method of declaration.service.methods) {
      const name = method.localName;
      const where = `Service gRPC ${typeName} (« ${this.name} »), méthode « ${name} »`;
      const owner =
        name === GRPC_ACTION || name === "grpcEndpoint"
          ? "GrpcController"
          : reserved.get(name);
      if (owner !== undefined) {
        throw new BootConfigurationError(
          `${where} : ce nom est réservé par ${owner}, dont tout contrôleur ` +
            "hérite. Renommer la méthode dans le contrat.",
        );
      }
      const impl: unknown = Reflect.get(this.prototype, name);
      if (typeof impl !== "function") {
        throw new BootConfigurationError(
          `${where} : absente de la classe. Chaque méthode du contrat ` +
            "s'implémente sur son contrôleur.",
        );
      }
      const meta = computeActionMeta(this, name);
      const inert = inertDecorators(meta);
      if (inert.length !== 0) {
        throw new BootConfigurationError(
          `${where} : ${inert.join(", ")} sans effet sur un appel gRPC ` +
            "(posé sur la méthode ou sur la classe). Les retirer.",
        );
      }
      metas.set(name, meta);
    }
    for (const { route, method } of declaration.routes) {
      const meta = metas.get(method.localName);
      if (meta === undefined) continue;
      route.actionMeta = { ...meta, bodyStream: true };
      route.bodyStream = true;
      markGrpcRoute(route);
    }
    Object.defineProperty(this.prototype, "grpcEndpoint", {
      value: new GrpcEndpoint(declaration.service, {
        perCall: this.scope !== "singleton",
      }),
      configurable: true,
    });
  }

  /**
   * L'action de base de toute route gRPC : remet la requête et la réponse
   * brutes à l'adaptateur, qui appelle la méthode du contrat et écrit la
   * réponse. Synchrone ; ne rend rien.
   *
   * @throws Error quand la classe n'a pas été enregistrée par le routeur, ou
   *   hors d'une requête HTTP.
   */
  serveGrpc(): void {
    const endpoint = this.grpcEndpoint;
    if (endpoint === undefined) {
      throw new Error(
        `Contrôleur gRPC « ${this.constructor.name} » non enregistré : le ` +
          "déclarer par @controllers([...]).",
      );
    }
    const context = this.context;
    if (!(context instanceof HttpContext)) {
      throw new Error("Un appel gRPC n'est servi que sur une requête HTTP.");
    }
    endpoint.serve(context, this);
  }
}
