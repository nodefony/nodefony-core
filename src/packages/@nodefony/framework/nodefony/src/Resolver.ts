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
import {
  Context,
  HttpError,
  ContextType,
  HttpContext,
  Response,
  wsResponse,
} from "@nodefony/http";
import Route, { ControllerConstructor } from "./Route";
import BlueBird from "bluebird";
import Controller from "./Controller";

import { ServiceWithInitialize } from "nodefony";
//import { ServiceConstructor } from "nodefony";

export interface ControllerWithInitialize {
  initialize(controler: Controller): Promise<Controller>;
}

class Resolver extends Service {
  injector: Injector;
  controller: ControllerConstructor | null = null;
  actionName?: string;
  action?: Function;
  context: ContextType;
  route: Route | null = null;
  resolve: boolean = false;
  variables: any[] = [];
  exception?: HttpError | Error | null;
  constructor(context: ContextType) {
    super(
      "RESOLVER",
      context.container as Container,
      context.notificationsCenter as Event
    );
    this.context = context;
    this.injector = this.get("injector");
  }

  match(route: Route, context: ContextType) {
    try {
      const match = route.match(context);
      if (match) {
        this.variables = match;
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

  async newController(context?: ContextType): Promise<Controller> {
    if (this.controller) {
      const controller = this.injector.instantiate(
        this.controller,
        context || this.context
      );
      if (controller) {
        this.set("controller", controller);
        if (
          "initialize" in controller &&
          typeof controller.initialize === "function"
        ) {
          await controller.initialize();
          return controller as Controller;
        }
        return controller as Controller;
      }
    }
    throw new Error(`Route Controller not found`);
  }

  async callController(data: any[] = [], reload: boolean = false) {
    try {
      let controller = this.get("controller") as Controller;
      if (!controller || reload) {
        controller = await this.newController();
      }
      if (this.controller?.prototype.module) {
        controller.module = this.controller?.prototype.module;
      }
      this.set("action", this.action);
      this.set("route", this.route);
      controller.setRoute(this.route as Route);
      const methodKey = this.actionName as keyof typeof controller;
      const ele = [...this.variables, ...data];
      if (typeof controller[methodKey] === "function") {
        try {
          const action = (controller[methodKey] as Function)(...ele);
          return this.returnController(action);
        } catch (e) {
          throw e;
        }
      }
      if (this.action) {
        try {
          return this.returnController(this.action(...ele));
        } catch (e) {
          throw e;
        }
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
        return result.catch((e: Error) => {
          throw e;
        });
      case type === "string":
      case result instanceof String:
        return (this.context as HttpContext).send(result);
      case result instanceof Response:
      case result instanceof wsResponse:
        return (this.context as HttpContext).send().catch((e: Error) => {
          throw e;
        });
      case type === "object":
        break;
      default:
        if ((this.context as HttpContext).isRedirect) {
          return (this.context as HttpContext).send().catch((e: Error) => {
            throw e;
          });
        }
        this.context.waitAsync = true;
    }
  }
}

export default Resolver;
