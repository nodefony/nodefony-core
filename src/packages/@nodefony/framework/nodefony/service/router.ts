import {
  Service,
  Module,
  Container,
  Event,
  inject,
  injectable,
} from "nodefony";
import Route, { RouteOptions } from "../src/Route";
import { HttpKernel, Context } from "@nodefony/http";
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

    // this.kernel?.once("onReady", () => {
    //   console.log(routes);
    //   const myRoute: Route = routes[0];
    //   if (myRoute) {
    //     if (myRoute.controller && myRoute.classMethod) {
    //       const inst = new myRoute.controller(module);
    //       const methodKey = myRoute.classMethod as keyof typeof inst;
    //       if (typeof inst[methodKey] === "function") {
    //         (inst[methodKey] as Function)();
    //       }
    //       console.log("################################");
    //       this.matchRoutes("/base/add/ddddd");
    //       console.log("################################");
    //       this.matchRoutes("/base/ele/sboob/kdskdkd/add");
    //       console.log("################################");
    //       this.matchRoutes("/base/add/");
    //       console.log("################################");
    //       this.matchRoutes("/base/ele/sboob/kdskdkd/mymethos/add");
    //       console.log("################################");
    //     }
    //   }
    // });
  }

  resolve(context: Context): Resolver {
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
      throw resolver;
    }
    return resolver;
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
    name?: string
  ): TypeController<Controller> {
    return (controllers[name || myconstructor.name] = myconstructor);
  }
}

export default Router;
