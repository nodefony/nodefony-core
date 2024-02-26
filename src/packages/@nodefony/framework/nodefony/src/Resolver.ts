import {
  Container,
  Service,
  Event,
  typeOf,
  isPromise,
  Injector,
  inject,
} from "nodefony";
//import Router from "../service/router";
import { Context, HttpError } from "@nodefony/http";
import Route, { ControllerConstructor } from "./Route";
import BlueBird from "bluebird";
//import { ServiceConstructor } from "nodefony";

class Resolver extends Service {
  injector: Injector;
  controller: ControllerConstructor | null = null;
  actionName?: string;
  action?: Function;
  context: Context;
  route: Route | null = null;
  resolve: boolean = false;
  exception?: HttpError | Error | null;
  constructor(context: Context) {
    super(
      "RESOLVER",
      context.container as Container,
      context.notificationsCenter as Event
    );
    this.context = context;
    this.injector = this.get("injector");
  }

  match(route: Route, context: Context) {
    try {
      const match = route.match(context);
      if (match) {
        this.route = route;
        this.controller = route.controller as ControllerConstructor;
        this.actionName = route.classMethod;
        this.resolve = true;
      }
      return match;
    } catch (e) {
      throw e;
    }
  }

  newController(context?: Context) {
    if (this.controller) {
      //const controller = new this.controller(context || this.context);
      const controller = this.injector.instantiate(
        this.controller,
        context || this.context
      );
      this.set("controller", controller);
      return controller;
    }
    throw new Error(`Route Controller not found`);
  }

  callController(data: any[] = [], reload: boolean = false) {
    try {
      let controller = this.get("controller");
      if (!controller || reload) {
        controller = this.newController();
      }
      this.set("action", this.action);
      const methodKey = this.actionName as keyof typeof controller;
      if (typeof controller[methodKey] === "function") {
        this.action = controller[methodKey] as Function;
        return (controller[methodKey] as Function)();
      }
      if (this.action) {
        return this.returnController(this.action(...data));
      }
      throw new Error(`Route Action not found`);
    } catch (e) {
      throw e;
    }
  }

  returnController(result: any) {
    const type = typeOf(result);
    switch (true) {
      case result instanceof Promise:
      case result instanceof BlueBird:
      case isPromise(result):
      default:
    }
  }
}

export default Resolver;
