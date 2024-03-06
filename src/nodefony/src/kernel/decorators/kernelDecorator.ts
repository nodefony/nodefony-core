/* eslint-disable @typescript-eslint/no-explicit-any */
import Module from "../Module";
import { ModuleConstructor, ServiceConstructor } from "../Kernel";
import Service from "../../Service";
import Injector from "../injector/injector";
//import nodefony from "../../Nodefony";

// eslint-disable-next-line @typescript-eslint/ban-types
type Constructor = new (...args: any[]) => Module;

type Injectable<T = { service: Service }> = new (...args: any[]) => T;

function modules(
  nameOrPath: string | (string | ModuleConstructor)[] | ModuleConstructor
): <T extends Constructor>(constructor: T) => T {
  return function <T extends Constructor>(constructor: T): T {
    class NewModuleConstructor extends constructor {
      constructor(...args: any[]) {
        super(...args);
        this.kernel?.once("onPreRegister", async () => {
          return await this.initDecoratorModules();
        });
      }
      async initDecoratorModules() {
        if (Array.isArray(nameOrPath)) {
          for (const path of nameOrPath) {
            if (this.kernel?.isModule(path)) {
              await this.kernel?.addModule(path as ModuleConstructor);
            } else {
              await this.kernel?.loadModule(path as string, false);
            }
          }
        } else {
          if (typeof nameOrPath === "string") {
            return await this.kernel?.loadModule(nameOrPath, false);
          }
          if (this.kernel?.isModule(nameOrPath)) {
            return await this.kernel?.addModule(nameOrPath);
          }
        }
      }
    }
    return NewModuleConstructor;
  };
}

function services(
  nameOrPath: string | (string | ServiceConstructor)[] | ServiceConstructor
): <T extends Constructor>(constructor: T) => T {
  return function <T extends Constructor>(constructor: T): T {
    class NewConstructorService extends constructor {
      constructor(...args: any[]) {
        super(...args);
        this.kernel?.once("onPreBoot", async () => {
          return await this.initDecoratorServices();
        });
      }
      async initDecoratorServices() {
        if (Array.isArray(nameOrPath)) {
          for (const path of nameOrPath) {
            if (typeof path !== "string") {
              await this.addService(path as ServiceConstructor).catch(
                (e: Error) => {
                  this.log(e, "ERROR");
                }
              );
            } else {
              await this.loadService(path as string).catch((e: Error) => {
                this.log(e, "ERROR");
              });
            }
          }
        } else {
          if (typeof nameOrPath === "string") {
            return await this.loadService(nameOrPath as string).catch(
              (e: Error) => {
                this.log(e, "ERROR");
              }
            );
          }
          return await this.addService(nameOrPath).catch((e: Error) => {
            this.log(e, "ERROR");
          });
        }
      }
    }
    return NewConstructorService;
  };
}

// function injectable(
//   name?: string
// ): <T extends Constructor>(constructor: T) => T {
//   return function <T extends Constructor>(constructor: T): T {
//     //console.log("injectable", name || constructor.name);
//     Injector.register(
//       name || constructor.name,
//       constructor as ServiceConstructor
//     );
//     return constructor;
//   };
// }

function injectable(
  name?: string
): <T extends Injectable<Service>>(constructor: T) => T {
  return function <T extends Injectable<Service>>(constructor: T): T {
    //console.log("injectable", name || constructor.name);
    Injector.register(name || constructor.name, constructor);
    return constructor;
  };
}

// eslint-disable-next-line @typescript-eslint/ban-types
function inject(serviceName: string): Function {
  return function (
    target: any,
    propertyKey: string,
    parameterIndex: number
  ): void {
    if (!serviceName) {
      throw new Error(`Inject decorator bad serviceName`);
    }
    const index = Number(parameterIndex);
    // if (typeof target === "function" && propertyKey) {
    //   console.log(`Je suis une methode de class`);
    // } else {
    //   console.log(`Je suis un constructeur`);
    // }
    //Injector.get(serviceName);
    if (!target._inject) {
      target._inject = {};
    }
    target._inject[index] = serviceName;
  };
}

export { modules, injectable, inject, services };
