import { fileURLToPath } from "url";
import Router, { TypeController } from "../service/router";
import { RouteOptions } from "../src/Route";
import Controller from "../src/Controller";
import { Module } from "nodefony";
import { ControllerConstructor } from "../src/Route";

type Constructor<T = {}> = new (...args: any[]) => T;

function DefineController(name: string, options: Record<string, any>) {
  return function (controller: any) {
    const constructor = controller.constructor;
    const className = controller.name;
    //Router.setController(name, { className, constructor, ...options });
    return controller;
  };
}

function controllers(
  controller: TypeController<Controller>[] | TypeController<Controller>
): <T extends Constructor<Module>>(constructor: T) => T {
  return function <T extends Constructor<Module>>(constructor: T): T {
    class NewConstructorControllers extends constructor {
      constructor(...args: any[]) {
        super(...args);
        this.kernel?.once("onBoot", async () => {
          return this.initDecoratorControllers();
        });
      }
      async initDecoratorControllers() {
        if (Array.isArray(controller)) {
          for (const contr of controller) {
            Router.setController(contr, this);
          }
        } else {
          Router.setController(controller, this);
        }
      }
    }
    return NewConstructorControllers;
  };
}

/**
 * Crée une route avec le nom et les options spécifiés.
 *
 * @param name - Le nom de la route.
 * @param options - Les options de la route.
 * @returns Un décorateur de méthode qui peut être utilisé pour annoter une méthode de contrôleur.
 *
 * @example
 * \@route("myroute", {
 *   path: "/add/{name}",
 *   method: ["GET", "POST"],
 *   defaults: { name: "john" },
 * })
 * method() {
 *   console.log("call method");
 * }
 */
function DefineRoute(name: string, options: RouteOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const className = target.constructor.name;
    const classMethod = propertyKey;
    const prefix = target.constructor.basepath;
    const path = options.path || "";
    let filePath;
    try {
      const stackTrace = new Error().stack;
      if (stackTrace && stackTrace.split) {
        const sp = stackTrace?.split("\n");
        if (sp[2]) {
          let ele = sp[2].match(/\(([^)]+)\)/);
          if (ele) {
            filePath = ele[1];
            filePath = fileURLToPath(filePath);
          }
        }
      }
    } catch (e) {}

    Router.createRoute(name, {
      path,
      filePath,
      constructor: target.constructor as ControllerConstructor,
      prefix,
      className,
      classMethod,
      method: options.method,
      host: options.host,
      defaults: options.defaults,
      requirements: options.requirements,
    });
    return descriptor;
  };
}

export { DefineRoute, DefineController, controllers };
