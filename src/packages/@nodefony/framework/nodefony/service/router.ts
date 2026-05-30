import {
  Service,
  Module,
  Container,
  Event,
  //inject,
  injectable,
} from "nodefony";
import Route, { RouteOptions } from "../src/Route";
import { ContextType, HttpError, isDomainAllowed } from "@nodefony/http";
import Resolver from "../src/Resolver";
import Controller from "../src/Controller";

type RouteRequirementMethods = string | string[] | undefined;

function collectSupportedMethods(route: Route): Set<string> {
  const set = new Set<string>();
  const m = route.requirements?.methods as RouteRequirementMethods;
  if (typeof m === "string") {
    m.split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .forEach((x) => set.add(x));
  } else if (Array.isArray(m)) {
    m.map((s) => String(s).toUpperCase()).forEach((x) => set.add(x));
  }
  return set;
}
export type TypeController<T> = new (...args: any[]) => T;

const routes: Route[] = [];
//const controllers: Record<string, TypeController<Controller>> = {};
const serviceName: string = "router";

@injectable()
class Router extends Service {
  //static controllers = controllers;
  static routes = routes;
  routes: Route[] = Router.routes;
  constructor(
    module: Module,
    //@inject("HttpKernel") private httpKernel: HttpKernel
  ) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.router,
    );
  }

  resolve(context: ContextType): Resolver {
    const resolver = new Resolver(context);
    // L5a perf : pathname normalisé UNE fois (constant pour la requête) — évite
    // que chaque Route.match du scan O(N) recalcule URL.pathname + regex + alloc.
    const cleanPath = Route.cleanPathname(context);
    // Pass 1 : match path + method
    for (let i = 0; i < routes.length; i++) {
      try {
        if (resolver.match(routes[i], context, cleanPath)) {
          this.log(`Match route : ${routes[i].name}`, "DEBUG");
          resolver.exception = undefined;
          return resolver;
        }
      } catch (e) {
        this.log(`Match route exception : ${routes[i].name} ${e}`, "DEBUG");
        resolver.exception = e as Error;
        continue;
      }
    }
    // Pass 2 : if no method-match but path matches another route → RFC 9110 §15.5.6 (405 + Allow)
    // RFC 9110 §15.5.6 is an HTTP rule — does NOT apply to WebSocket. For WS, preserve the
    // original exception (typically 1002 Protocol Error from Route.matchRequirements).
    if (
      context.method !== "WEBSOCKET" &&
      context.request?.url &&
      (!resolver.exception || resolver.exception.code !== 405)
    ) {
      // Réutilise le pathname déjà normalisé (cleanPath) — défini ici car le
      // garde `context.request?.url` ci-dessus implique une URL présente.
      const path = (cleanPath ?? "") || "/";
      const allowed = new Set<string>();
      for (const route of routes) {
        // Une route restreinte à un autre vhost (@Domain) ne SERT pas cette
        // requête → invisible pour le calcul du Allow (sinon un 403 domaine
        // serait masqué par un 405 trompeur). Cf domain-routing.test.ts.
        const servesDomain =
          !route.hostRegexp ||
          isDomainAllowed(route.hostRegexp, context.domain);
        if (route.pattern && route.pattern.test(path) && servesDomain) {
          const m = collectSupportedMethods(route);
          m.forEach((x) => allowed.add(x));
        }
      }
      if (allowed.size > 0) {
        const allowHeader = Array.from(allowed).join(", ");
        const err = new HttpError(
          `Method ${context.method} Not Allowed`,
          405,
          context,
        );
        (err as any).allow = allowHeader;
        (err as any).type = "method";
        context.response?.setHeaders({ Allow: allowHeader });
        throw err;
      }
    }
    if (resolver.exception) {
      switch (resolver.exception.code) {
        case 405:
          context.response?.setHeaders({
            Allow: (resolver.exception as any).allow,
          });
          break;
      }
      throw resolver.exception;
    }
    return resolver;
  }

  resolveController(contex: ContextType, name: string): Resolver {
    try {
      const resolver = new Resolver(contex);
      resolver.parsePathernController(name);
      return resolver;
    } catch (e) {
      throw e;
    }
  }

  matchRoutes(path: string): RegExpExecArray[] {
    let result = [];
    for (const route of routes) {
      let res = route.pattern?.exec(path);
      if (res) {
        result.push(res);
      }
    }
    return result;
  }

  getRoutes(name: string) {
    if (name) {
      return routes.find((route) => route.name === name);
    }
    return routes;
  }

  setRoute() {}

  removeRoutes(name: string) {
    if (name) {
      const index = routes.findIndex((route) => route.name === name);
      if (index !== -1) {
        routes.splice(index, 1);
      } else {
        throw new Error(`Route ${name} not found.`);
      }
    } else {
      routes.length = 0;
    }
  }

  static createRoute(name: string, obj: RouteOptions): Route {
    const routenew = new Route(name, obj);
    routes.push(routenew);
    return routenew;
  }
  static setController(
    myconstructor: TypeController<Controller>,
    module: Module,
  ): TypeController<Controller> {
    Object.defineProperty(myconstructor.prototype, "module", {
      value: module,
      writable: false,
    });
    if (Module.controllers[myconstructor.name]) {
      module.log(
        new Error(`Controller already exist ${myconstructor.name}`),
        "WARNING",
      );
    }
    // Propage le module sur les routes déjà créées par les décorateurs
    // `@route` + `@controller` (qui s'exécutent à l'import — donc avant ce
    // setController appelé à `onBoot`). Le log est fait par l'appelant
    // (décorateur `@controllers`) pour que le msgid soit `MODULE <name>` —
    // appeler `module.log()` depuis ce contexte static perd parfois la chaîne
    // d'override Module.log → Service.log.
    for (const r of routes) {
      if (r.controller === myconstructor) {
        r.module = { name: module.name };
      }
    }
    return (Module.controllers[myconstructor.name] = myconstructor);
  }

  /**
   * Retourne les routes enregistrées pour un controller donné — utilisé par
   * le décorateur `@controllers` pour logger chaque route depuis le module
   * propriétaire (msgid `MODULE <name>` au lieu de `KERNEL`).
   */
  static getRoutesForController(
    myconstructor: TypeController<Controller>,
  ): Route[] {
    return routes.filter((r) => r.controller === myconstructor);
  }
}

export default Router;
