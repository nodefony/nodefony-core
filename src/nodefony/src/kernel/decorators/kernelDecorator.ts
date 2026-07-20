// `any` ASSUMÉ ici (pas une dette à purger) : les types de mixin TS
// (`new (...args: any[]) => X`) et les constructeurs `class extends ctor`
// EXIGENT `...args: any[]` — `unknown[]` déclenche TS2545 (« A mixin class must
// have a constructor with a single rest parameter of type 'any[]' »).
/* eslint-disable @typescript-eslint/no-explicit-any */
import "reflect-metadata";
import Module from "../Module";
import { ServiceConstructor } from "../Kernel";
import Service from "../../Service";
import Injector, {
  DIScope,
  InjectableOptions,
  PropertyInjectMeta,
} from "../injector/injector";
import {
  orderServicesByDependencies,
  type ServiceEntry,
} from "../injector/serviceOrder";
// import nodefony from "nodefony";

// `Module<unknown>` et NON `Module` (= `Module<Record<string, unknown>>`) : ce
// décorateur ne lit ni n'écrit `config`, donc il ne présume RIEN de sa forme —
// `unknown` dit exactement cela, là où `any` désactiverait la vérification.
// Avec le défaut du générique, TypeScript n'accorde d'index signature implicite
// qu'aux *alias de type*, jamais aux *interfaces* : `class X extends
// Module<IXConfig>` (la convention `I` que le CLAUDE.md racine IMPOSE) échouait
// en TS1238/TS1270, sur un message qui ne nomme pas la cause. Les modules du
// repo y échappaient par accident, leurs `IXConfig` étant des alias Zod.
// Sentinelle : `servicesDecoratorConfig.types.test.ts`.
type Constructor = new (...args: any[]) => Module<unknown>;
type Injectable<T = { service: Service }> = new (...args: any[]) => T;

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
      // Un service qui échoue passe par `handleServiceBootError` (Module) → la
      // politique de criticité du boot : fatal en production, fail-soft ANNONCÉ
      // (BootReport) ailleurs. Un simple `log(e, "ERROR")` — ce qui se faisait
      // ici — n'atteignait NI la politique (jamais fatal, même en prod) NI le
      // BootReport : un boot amputé d'un service critique se déclarait « UP ».
      private async initDecoratorServices() {
        if (Array.isArray(nameOrPath)) {
          // L'ordre d'instanciation se CALCULE depuis les dépendances déclarées
          // (@inject / design:paramtypes) — il ne se lit plus dans la liste. Un
          // service réclamé doit être au container avant son consommateur ;
          // faire reposer ça sur l'ordre écrit à la main était un piège (déplacer
          // `HttpKernel` de 3 lignes → 499 sur chaque requête). Tri STABLE : une
          // liste déjà correcte sort inchangée.
          const ordered = orderServicesByDependencies(
            nameOrPath as ServiceEntry[],
          );
          for (const path of ordered) {
            if (typeof path !== "string") {
              await this.addService(path as ServiceConstructor).catch(
                (e: Error) => {
                  this.handleServiceBootError(e, path as ServiceConstructor);
                },
              );
            } else {
              await this.loadService(path as string).catch((e: Error) => {
                this.handleServiceBootError(e, path as string);
              });
            }
          }
        } else {
          if (typeof nameOrPath === "string") {
            return await this.loadService(nameOrPath as string).catch(
              (e: Error) => {
                this.handleServiceBootError(e, nameOrPath as string);
              },
            );
          }
          return await this.addService(nameOrPath).catch((e: Error) => {
            this.handleServiceBootError(e, nameOrPath);
          });
        }
      }
    }
    return NewConstructorService;
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
          { name?: string } | undefined
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

export { injectable, inject, Inject, services };
