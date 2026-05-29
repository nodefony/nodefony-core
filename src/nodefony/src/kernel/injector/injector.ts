import "reflect-metadata";
import Service from "../../Service";
import Container from "../../Container";
import Event from "../../Event";
import Kernel, { ServiceConstructor } from "../Kernel";
import { Nodefony } from "../../Nodefony";
import Fetch from "../../service/fetchService";

export type DIScope = "singleton" | "transient";

export interface InjectableOptions {
  name?: string;
  scope?: DIScope;
}

export interface PropertyInjectMeta {
  key: string | symbol;
  name: string;
}

const injectables: Record<string, ServiceConstructor> = {};

class Injector extends Service {
  static injectables: Record<string, ServiceConstructor> = injectables;

  constructor(kernel: Kernel) {
    super(
      "injector",
      kernel.container as Container,
      kernel.notificationsCenter as Event,
    );
    Injector.register("Fetch", Fetch);
  }

  static register(
    serviceName: string,
    service: ServiceConstructor,
  ): ServiceConstructor {
    if (!serviceName || !service) {
      throw new Error(`Injector register  bad argument`);
    }
    return (injectables[serviceName] = service);
  }

  static isRegistered(serviceName: string): boolean {
    return serviceName in injectables;
  }

  static getScope(serviceName: string): DIScope {
    const Ctor = injectables[serviceName];
    if (!Ctor) return "singleton";
    return (Reflect.getMetadata("di:scope", Ctor) as DIScope) ?? "singleton";
  }

  static get(serviceName: string): ServiceConstructor {
    const service = injectables[serviceName];
    if (!service) {
      throw new Error(`Service ${serviceName} not found or not injectable`);
    }
    return service;
  }

  static inject<T extends Service = Service>(
    service: ServiceConstructor,
    ...args: unknown[]
  ): T {
    return Injector.instantiate<T>(service, ...args);
  }

  instantiate<T extends Service = Service>(
    constructor: ServiceConstructor,
    ...args: unknown[]
  ): T {
    return Injector.instantiate<T>(constructor, ...args);
  }

  // ─── API publique ─────────────────────────────────────────────────────────────
  static instantiate<T extends Service = Service>(
    constructor: ServiceConstructor,
    ...argsClass: unknown[]
  ): T {
    return Injector._instantiateWithStack(constructor, [], argsClass) as T;
  }

  // ─── Résolution par nom avec stack circulaire ─────────────────────────────────
  //
  // Ordre de résolution :
  //   1. @injectable → scope détermine le comportement :
  //        transient : toujours nouvelle instance (container ignoré)
  //        singleton : container kernel en premier, sinon nouvelle instance
  //   2. Non @injectable → container kernel (services ajoutés via kernel.set())
  //   3. Sinon → throw
  private static _resolveWithStack(
    serviceName: string,
    argsClass: unknown[],
    stack: string[],
  ): unknown {
    if (Injector.isRegistered(serviceName)) {
      const Ctor = Injector.get(serviceName);
      const scope: DIScope =
        (Reflect.getMetadata("di:scope", Ctor) as DIScope) ?? "singleton";

      if (scope === "transient") {
        return Injector._instantiateWithStack(Ctor, stack, argsClass);
      }

      const kernel = Nodefony.getKernel();
      if (kernel && kernel.get(serviceName)) {
        return kernel.get(serviceName);
      }
      return Injector._instantiateWithStack(Ctor, stack, argsClass);
    }

    // Non @injectable → fallback sur le container kernel
    const kernel = Nodefony.getKernel();
    if (kernel) {
      const existing = kernel.get(serviceName);
      if (existing) return existing;
    }

    throw new Error(`Service ${serviceName} not found or not injectable`);
  }

  // ─── Property injection post-construction ─────────────────────────────────────
  private static _applyPropertyInjection(
    constructor: ServiceConstructor,
    instance: unknown,
    stack: string[],
  ): unknown {
    const propMetas: PropertyInjectMeta[] =
      Reflect.getMetadata("inject:properties", constructor.prototype) || [];
    for (const { key, name } of propMetas) {
      (instance as Record<string, unknown>)[key as string] =
        Injector._resolveWithStack(name, [], stack);
    }
    return instance;
  }

  // ─── Instantiation avec injection + détection circulaire ─────────────────────
  //
  // `stack` : chemin de résolution courant — propre à chaque arbre d'appel (async-safe).
  // Chaque niveau crée une copie [...stack, name] — jamais de mutation du tableau parent.
  //
  // Deux sources de métadonnées :
  //   1. inject:services    — stocké par @inject("name"). Tableau sparse par position.
  //                           Prend la priorité sur design:paramtypes.
  //   2. design:paramtypes  — émis par TypeScript (emitDecoratorMetadata).
  //                           Permet l'auto-injection par type sans @inject explicite.
  //
  // Algorithme :
  //   Pour chaque position i :
  //     - @inject[i] défini → résoudre par nom (priorité absolue)
  //     - paramTypes[i] enregistré → auto-injection par type
  //     - sinon → arg explicite (argsClass[explicitIdx++])
  //   Appliquer la property injection post-construction.
  private static _instantiateWithStack(
    constructor: ServiceConstructor,
    stack: string[],
    argsClass: unknown[],
  ): Service {
    const ctorName = constructor.name;

    // ── Détection circulaire ────────────────────────────────────────────────────
    if (stack.includes(ctorName)) {
      throw new Error(
        `Circular dependency detected: ${[...stack, ctorName].join(" → ")}`,
      );
    }
    const nextStack = [...stack, ctorName];

    // ── Métadonnées DI ──────────────────────────────────────────────────────────
    const injectExplicit: (string | undefined)[] =
      Reflect.getMetadata("inject:services", constructor) || [];
    const paramTypes: unknown[] =
      Reflect.getMetadata("design:paramtypes", constructor) || [];

    const hasInjectInfo = injectExplicit.some(Boolean) || paramTypes.length > 0;

    if (!hasInjectInfo) {
      const instance = Reflect.construct(constructor, argsClass);
      return Injector._applyPropertyInjection(
        constructor,
        instance,
        nextStack,
      ) as Service;
    }

    const totalParams = Math.max(paramTypes.length, injectExplicit.length);
    const resolvedArgs: unknown[] = [];
    let explicitIdx = 0;

    for (let i = 0; i < totalParams; i++) {
      const explicitName = injectExplicit[i];

      if (explicitName) {
        resolvedArgs.push(
          Injector._resolveWithStack(explicitName, argsClass, nextStack),
        );
        continue;
      }

      const type = paramTypes[i] as { name?: string } | undefined;
      if (type?.name && Injector.isRegistered(type.name)) {
        resolvedArgs.push(
          Injector._resolveWithStack(type.name, argsClass, nextStack),
        );
        continue;
      }

      resolvedArgs.push(argsClass[explicitIdx++]);
    }

    while (explicitIdx < argsClass.length) {
      resolvedArgs.push(argsClass[explicitIdx++]);
    }

    const instance = Reflect.construct(constructor, resolvedArgs);
    return Injector._applyPropertyInjection(
      constructor,
      instance,
      nextStack,
    ) as Service;
  }

  reflect<T extends Service = Service>(
    constructor: ServiceConstructor,
    ...args: unknown[]
  ): T {
    try {
      return Reflect.construct(constructor, args) as T;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.log(`ERROR SERVICE CLASS ${this.name} ${message}`, "ERROR");
      throw e;
    }
  }
}

export default Injector;
