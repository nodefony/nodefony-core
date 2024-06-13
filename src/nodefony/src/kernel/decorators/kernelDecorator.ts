/* eslint-disable @typescript-eslint/no-explicit-any */
import "reflect-metadata";
import Module from "../Module";
import { ModuleConstructor, ServiceConstructor } from "../Kernel";
import Service from "../../Service";
import Injector from "../injector/injector";
import Entity, { TypeEntity } from "../orm/Entity";
// import nodefony from "nodefony";

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
      private async initDecoratorModules() {
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
      private async initDecoratorServices() {
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

function entities(
  entity: string | (string | TypeEntity<Entity>)[] | TypeEntity<Entity>
): <T extends Constructor>(constructor: T) => T {
  return function <T extends Constructor>(constructor: T): T {
    class NewConstructorEntity extends constructor {
      constructor(...args: any[]) {
        super(...args);
        this.kernel?.once("onBoot", async () => {
          return this.initDecoratorEntity();
        });
      }
      private async initDecoratorEntity() {
        if (Array.isArray(entity)) {
          for (const ent of entity) {
            if (typeof ent === "string") {
              await this.loadEntity(ent);
            } else {
              this.addEntity(ent);
            }
          }
        } else {
          if (typeof entity === "string") {
            await this.loadEntity(entity);
          } else {
            this.addEntity(entity);
          }
        }
      }
    }
    return NewConstructorEntity;
  };
}

function injectable(
  name?: string
): <T extends Injectable<Service>>(constructor: T) => T {
  return function <T extends Injectable<Service>>(constructor: T): T {
    //console.log("injectable", name || constructor.name);
    Injector.register(name || constructor.name, constructor);
    return constructor;
  };
}

/**
 * Injecter une Service avec son nom
 *
 * @param serviceName - Le nom du service a injecter
 *
 *
 * @example
 *  class myClass{
 *    httpKernel: HttpKernel
 *    constructor(@inject("HttpKernel") private httpKernel: HttpKernel) {
 *      this.HttpKernel = httpKernel
 *    }
 *  }
 */
// eslint-disable-next-line @typescript-eslint/ban-types
function inject(serviceName: string): Function {
  return function (
    target: any,
    propertyKey: string,
    parameterIndex: number
  ): void {
    if (!serviceName) {
      throw new Error(`Inject decorator requires a valid service name`);
    }
    const existingInjectedServices =
      Reflect.getMetadata("inject:services", target, propertyKey) || [];
    existingInjectedServices[parameterIndex] = serviceName;
    Reflect.defineMetadata(
      "inject:services",
      existingInjectedServices,
      target,
      propertyKey
    );
  };
}

export { modules, injectable, inject, services, entities };
