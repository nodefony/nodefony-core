/* eslint-disable @typescript-eslint/no-explicit-any */
import "reflect-metadata";
import Module from "../Module";
import { ModuleConstructor, ServiceConstructor } from "../Kernel";
import Service from "../../Service";
import Injector, {
  DIScope,
  InjectableOptions,
  PropertyInjectMeta,
} from "../injector/injector";
import Entity, { TypeEntity } from "../orm/Entity";
// import nodefony from "nodefony";

type Constructor = new (...args: any[]) => Module;
type Injectable<T = { service: Service }> = new (...args: any[]) => T;

function modules(
  nameOrPath: string | (string | ModuleConstructor)[] | ModuleConstructor,
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
  nameOrPath: string | (string | ServiceConstructor)[] | ServiceConstructor,
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
                },
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
              },
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
  entity: string | (string | TypeEntity<Entity>)[] | TypeEntity<Entity>,
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
  nameOrOptions?: string | InjectableOptions,
): <T extends Injectable<Service>>(constructor: T) => T {
  return function <T extends Injectable<Service>>(constructor: T): T {
    let regName: string;
    let scope: DIScope = "singleton";

    if (typeof nameOrOptions === "string") {
      regName = nameOrOptions || constructor.name;
    } else if (nameOrOptions && typeof nameOrOptions === "object") {
      regName = nameOrOptions.name || constructor.name;
      scope = nameOrOptions.scope ?? "singleton";
    } else {
      regName = constructor.name;
    }

    Injector.register(regName, constructor);
    Reflect.defineMetadata("di:scope", scope, constructor);
    return constructor;
  };
}

/**
 * Injecter une Service avec son nom dans le constructeur.
 *
 * @param serviceName - Le nom du service à injecter (doit correspondre à un @injectable)
 *
 * @example
 *  class MyService extends Service {
 *    constructor(@inject("Fetch") private fetch: Fetch) { super("my", ...) }
 *  }
 */
function inject(serviceName: string): ParameterDecorator {
  return function (
    target: object,
    _propertyKey: string | symbol | undefined,
    parameterIndex: number,
  ): void {
    if (!serviceName) {
      throw new Error(`Inject decorator requires a valid service name`);
    }
    // Stockage au niveau de la classe (pas de propertyKey) — cohérent avec
    // Injector.instantiate qui lit Reflect.getMetadata("inject:services", constructor).
    const existing: (string | undefined)[] =
      Reflect.getMetadata("inject:services", target) || [];
    existing[parameterIndex] = serviceName;
    Reflect.defineMetadata("inject:services", existing, target);
  };
}

/**
 * Injecter une Service sur une propriété de classe (property injection).
 * Distinct de @inject (minuscule) qui cible les paramètres de constructeur.
 *
 * Le nom est obligatoire si emitDecoratorMetadata n'est pas actif (tests tsx).
 *
 * @example
 *  class MyService extends Service {
 *    @Inject("Fetch") private fetch!: Fetch;
 *  }
 */
function Inject(name?: string): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    const resolvedName =
      name ||
      (
        Reflect.getMetadata("design:type", target, propertyKey) as
          | { name?: string }
          | undefined
      )?.name;
    if (!resolvedName) {
      throw new Error(
        `@Inject requires an explicit name on property "${String(propertyKey)}" (emitDecoratorMetadata not active)`,
      );
    }
    const existing: PropertyInjectMeta[] =
      Reflect.getMetadata("inject:properties", target) || [];
    existing.push({ key: propertyKey, name: resolvedName });
    Reflect.defineMetadata("inject:properties", existing, target);
  };
}

export { modules, injectable, inject, Inject, services, entities };
