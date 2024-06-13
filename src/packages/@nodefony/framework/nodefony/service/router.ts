import {
  Service,
  Module,
  Container,
  Event,
  inject,
  injectable,
} from "nodefony";
import Route, { RouteOptions } from "../src/Route";
import { HttpKernel, Context, ContextType } from "@nodefony/http";
import Resolver from "../src/Resolver";
import Controller from "../src/Controller";
export type TypeController<T> = new (...args: any[]) => T;

const routes: Route[] = [];
const controllers: Record<string, TypeController<Controller>> = {};
const serviceName: string = "router";

@injectable()
class Router extends Service {
  static controllers = controllers;
  static routes = routes;
  routes: Route[] = Router.routes;
  constructor(
    module: Module,
    @inject("HttpKernel") private httpKernel: HttpKernel
  ) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.router
    );
  }

  resolve(context: ContextType): Resolver {
    const resolver = new Resolver(context);
    for (let i = 0; i < routes.length; i++) {
      try {
        if (resolver.match(routes[i], context)) {
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
    if (resolver.exception) {
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
        //console.log(` ${route.name} ${route.path} => Match : ${path}`);
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
    module: Module
  ): TypeController<Controller> {
    //myconstructor.prototype.module = module;
    //console.log(module);
    Object.defineProperty(myconstructor.prototype, "module", {
      value: module,
      writable: false,
    });
    return (controllers[myconstructor.name] = myconstructor);
  }
}

export default Router;
