/* eslint-disable @typescript-eslint/no-explicit-any */
import "reflect-metadata";
import Service from "../../Service";
import Container from "../../Container";
import Event from "../../Event";
import Kernel, { ServiceConstructor, ServiceWithInitialize } from "../Kernel";
import { Nodefony } from "../../Nodefony";
import Fetch from "../../service/fetchService";

const injectables: Record<string, ServiceConstructor> = {};

class Injector extends Service {
  static injectables: Record<string, ServiceConstructor> = injectables;

  constructor(kernel: Kernel) {
    super(
      "injector",
      kernel.container as Container,
      kernel.notificationsCenter as Event
    );
    Injector.register("Fetch", Fetch);
  }

  static register(serviceName: string, service: ServiceConstructor): ServiceConstructor {
    if (!serviceName || !service) {
      throw new Error(`Injector register  bad argument`);
    }
    return (injectables[serviceName] = service);
  }

  static isRegistered(serviceName: string): boolean {
    return serviceName in injectables;
  }

  static get(serviceName: string): ServiceConstructor {
    const service = injectables[serviceName];
    if (!service) {
      throw new Error(`Service ${serviceName} not found or not injectable`);
    }
    return service;
  }

  static inject(service: ServiceConstructor, ...args: any[]): Service | ServiceWithInitialize | any {
    return Injector.instantiate(service, ...args);
  }

  instantiate(constructor: ServiceConstructor, ...args: any[]): Service | ServiceWithInitialize | any {
    return Injector.instantiate(constructor, ...args);
  }

  // ─── Résolution d'un service par nom ─────────────────────────────────────────
  // Cherche d'abord dans le container kernel, sinon instancie depuis le registre.
  private static _resolve(serviceName: string, argsClass: any[]): any {
    const kernel = Nodefony.getKernel();
    if (kernel && kernel.get(serviceName)) {
      return kernel.get(serviceName);
    }
    return Injector.instantiate(Injector.get(serviceName), ...argsClass);
  }

  // ─── Instantiation avec injection ────────────────────────────────────────────
  //
  // Deux sources de métadonnées (toutes deux sous "inject:services" / "design:paramtypes") :
  //
  //   1. design:paramtypes  — émis par TypeScript (emitDecoratorMetadata) dès qu'un decorator
  //      est présent sur la classe. Permet l'auto-injection par type sans @inject explicite.
  //
  //   2. inject:services    — stocké par @inject("name"). Tableau sparse indexé par numéro
  //      de paramètre. Prend la priorité sur design:paramtypes.
  //
  // Algorithme :
  //   Pour chaque position i de 0 à totalParams-1 :
  //     - Si @inject[i] est défini → résoudre par nom (priorité absolue)
  //     - Sinon si paramTypes[i] est enregistré dans injectables → auto-injection par type
  //     - Sinon → consommer le prochain arg explicite (argsClass[explicitIdx++])
  //   Appendre les args explicites restants.
  //
  // Compatibilité ascendante : si aucune métadonnée → Reflect.construct(ctor, argsClass).
  static instantiate(
    constructor: ServiceConstructor,
    ...argsClass: any[]
  ): Service | ServiceWithInitialize | any {
    // @inject explicite — tableau sparse : [paramIndex] = serviceName
    const injectExplicit: (string | undefined)[] =
      Reflect.getMetadata("inject:services", constructor) || [];

    // design:paramtypes — émis par TypeScript si emitDecoratorMetadata + au moins 1 decorator
    const paramTypes: unknown[] =
      Reflect.getMetadata("design:paramtypes", constructor) || [];

    const hasInjectInfo = injectExplicit.some(Boolean) || paramTypes.length > 0;

    if (!hasInjectInfo) {
      return Reflect.construct(constructor, argsClass);
    }

    const totalParams = Math.max(paramTypes.length, injectExplicit.length);
    const resolvedArgs: any[] = [];
    let explicitIdx = 0;

    for (let i = 0; i < totalParams; i++) {
      const explicitName = injectExplicit[i];

      if (explicitName) {
        // @inject("name") — priorité absolue
        resolvedArgs.push(Injector._resolve(explicitName, argsClass));
        continue;
      }

      const type = paramTypes[i] as { name?: string } | undefined;
      if (type?.name && Injector.isRegistered(type.name)) {
        // Auto-injection via design:paramtypes
        resolvedArgs.push(Injector._resolve(type.name, argsClass));
        continue;
      }

      // Pas injectable → arg explicite
      resolvedArgs.push(argsClass[explicitIdx++]);
    }

    // Args explicites en excès (argsClass plus long que totalParams)
    while (explicitIdx < argsClass.length) {
      resolvedArgs.push(argsClass[explicitIdx++]);
    }

    return Reflect.construct(constructor, resolvedArgs);
  }

  reflect(constructor: ServiceConstructor, ...args: any[]): Service | ServiceWithInitialize | any {
    try {
      return Reflect.construct(constructor, args);
    } catch (e: any) {
      this.log(`ERROR SERVICE CLASS ${this.name} ${e.message}`, "ERROR");
      throw e;
    }
  }
}

export default Injector;
