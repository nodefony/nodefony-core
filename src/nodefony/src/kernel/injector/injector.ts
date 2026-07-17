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

// Dictionnaire SANS prototype : un objet littéral hériterait de `Object.prototype`,
// dont les membres (`toString`, `constructor`, `valueOf`…) répondraient alors à
// `isRegistered()` comme autant de services fantômes que personne n'a enregistrés —
// et `register("__proto__", …)` déracinerait le registre au lieu d'y poser une clé.
const injectables: Record<string, ServiceConstructor> = Object.create(null);

// ─── Classe → clé container (le « token ») ───────────────────────────────────
//
// LE nœud du DI : `@injectable(nom)` indexe des CLASSES, `super(nom, container)`
// indexe des INSTANCES, et les deux chaînes n'ont aucune raison d'être égales
// (`Router` vs `"router"`). Le décorateur ne PEUT pas connaître la seconde : il
// s'exécute au CHARGEMENT de la classe, `super()` seulement à la CONSTRUCTION.
//
// D'où l'apprentissage : au moment où un service est POSÉ au container
// (`Module.addService` / `Kernel.addKernelService`), on connaît enfin le couple
// (classe, clé). On s'en souvient, et toute résolution ultérieure passe par la
// CLASSE — le nom écrit dans `@inject` ne sert plus qu'à la retrouver.
//
// Map (clés = constructeurs) et non objet : la clé est une référence, pas un nom
// — c'est précisément le but. Alimentée au boot (une poignée d'entrées).
const containerKeys = new Map<ServiceConstructor, string>();

class Injector extends Service {
  static injectables: Record<string, ServiceConstructor> = injectables;

  constructor(kernel: Kernel) {
    super(
      "injector",
      kernel.container as Container,
      kernel.notificationsCenter as Event,
    );
    // `Fetch` est le service « batteries incluses » du core : injectable partout
    // via `@inject("Fetch")` sans qu'aucune app ait à le déclarer. On le DÉCLARE
    // (registre) *et* on le POSE (container) ici : déclarer sans poser laissait
    // `kernel.get("Fetch")` vide, donc un `new Fetch(...)` à CHAQUE résolution —
    // un service par requête, là où le scope en promet un seul.
    Injector.register("Fetch", Fetch);
    kernel.set("Fetch", new Fetch(kernel));
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

  /**
   * Mémorise la clé sous laquelle une classe de service vit RÉELLEMENT dans le
   * container — apprise au moment où l'instance y est posée.
   *
   * @remarks Sans elle, `@inject("Router")` interrogeait le container avec
   *   `"Router"` alors que l'instance y est rangée sous `"router"` (le nom de son
   *   `super()`) : le container répondait `null` et le service était RECONSTRUIT,
   *   son cache vide, silencieusement. Un seul des 7 `@injectable` échappait au
   *   piège — `HttpKernel`, par coïncidence de casse.
   *
   * @param service - le constructeur, tel qu'enregistré par `@injectable`.
   * @param containerKey - `instance.name`, la clé réelle du container.
   */
  static rememberContainerKey(
    service: ServiceConstructor,
    containerKey: string,
  ): void {
    if (!service || !containerKey) return;
    containerKeys.set(service, containerKey);
  }

  /**
   * Clé container connue d'une classe de service, ou `null` si elle n'a jamais
   * été posée au container (rien à apprendre encore).
   */
  static containerKeyOf(service: ServiceConstructor): string | null {
    return containerKeys.get(service) ?? null;
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
  // Une DÉPENDANCE se résout sans argument : elle n'hérite jamais de ceux de son
  // parent (cf. `_instantiateWithStack`). D'où l'absence d'`argsClass` ici.
  //
  // Ordre de résolution :
  //   1. @injectable → scope détermine le comportement :
  //        transient : toujours nouvelle instance (container ignoré)
  //        singleton : container kernel en premier, sinon instanciée PUIS mémoïsée
  //   2. Non @injectable → container kernel (services ajoutés via kernel.set())
  //   3. Sinon → throw
  private static _resolveWithStack(
    serviceName: string,
    stack: string[],
  ): unknown {
    if (Injector.isRegistered(serviceName)) {
      const Ctor = Injector.get(serviceName);
      const scope: DIScope =
        (Reflect.getMetadata("di:scope", Ctor) as DIScope) ?? "singleton";

      if (scope === "transient") {
        return Injector._instantiateWithStack(Ctor, stack, []);
      }

      // Le nom écrit dans `@inject` sert à retrouver la CLASSE ; c'est ELLE qui
      // dit où l'instance vit (clé apprise quand le service a été posé). Sans ce
      // relais, on interrogeait le container avec le nom DEMANDÉ — `"Router"` —
      // là où l'instance est rangée sous `"router"` : réponse `null`, service
      // reconstruit, cache vide, en silence.
      const kernel = Nodefony.getKernel();
      const key = Injector.containerKeyOf(Ctor) ?? serviceName;
      if (kernel && kernel.get(key)) {
        return kernel.get(key);
      }
      // Absent du container : on instancie, puis on MÉMOÏSE — sans quoi le scope
      // `singleton` rendrait une instance neuve à chaque résolution, dupliquant
      // l'état (cache, compteur, connexion) que le service est censé porter seul.
      let instance: Service;
      try {
        instance = Injector._instantiateWithStack(Ctor, stack, []);
      } catch (error) {
        // Cas dominant : le service attend son module porteur, ne le reçoit pas
        // (une dépendance se résout sans argument) et casse sur `module.container`
        // — `Cannot read properties of undefined` ne dit RIEN de la vraie cause.
        // La cause quasi certaine est un ORDRE : dans `@services([...])`, un
        // service doit précéder ses consommateurs, sinon il n'est pas encore au
        // container quand ils le réclament.
        const requester = stack[stack.length - 1];
        throw new Error(
          `Cannot resolve service "${serviceName}"` +
            (requester ? ` required by "${requester}"` : "") +
            `: it is @injectable but absent from the kernel container, so it was ` +
            `constructed without arguments — and its constructor threw ` +
            `(${error instanceof Error ? error.message : String(error)}). ` +
            `If "${serviceName}" is declared in @services([...]), list it BEFORE ` +
            `its consumers: services are instantiated in order, and a service ` +
            `must be in the container before anyone injects it.`,
          { cause: error },
        );
      }
      // On range sous la clé CANONIQUE du service (le nom de son `super()`), pas
      // sous le nom qu'on nous a demandé : sinon un `@inject("Router")` créerait
      // au container un second `"Router"` à côté du `"router"` légitime — deux
      // entrées, deux instances, le doublon qu'on cherche justement à tuer.
      // Et on APPREND le couple (classe, clé) au passage : la prochaine
      // résolution, par quelque nom que ce soit, retombera sur cette instance.
      const canonicalKey = instance.name || serviceName;
      Injector.rememberContainerKey(Ctor, canonicalKey);
      kernel?.set(canonicalKey, instance);
      return instance;
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
        Injector._resolveWithStack(name, stack);
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

      // `argsClass` appartient à la classe qu'on construit, PAS à ses dépendances :
      // une dépendance se RÉSOUT (container/registre), elle ne s'HÉRITE pas. Les
      // propager donnait à une dépendance les arguments de son parent — un service
      // recevait alors un objet d'un type qu'il n'attend pas, sans que TypeScript
      // ne voie rien (vécu : `Fetch(module: Module)` construit avec un `HttpContext`).
      if (explicitName) {
        resolvedArgs.push(Injector._resolveWithStack(explicitName, nextStack));
        continue;
      }

      const type = paramTypes[i] as { name?: string } | undefined;
      if (type?.name && Injector.isRegistered(type.name)) {
        resolvedArgs.push(Injector._resolveWithStack(type.name, nextStack));
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
