import "reflect-metadata";
import Service from "../../Service";
import Container from "../../Container";
import Event from "../../Event";
import Kernel, { ServiceConstructor } from "../Kernel";
import { Nodefony } from "../../Nodefony";
import Fetch from "../../service/fetchService";
import RequestContext from "../../runtime/RequestContext";
import type { IScope } from "../../types/IContainer";
import { BootConfigurationError } from "../BootConfigurationError";

/**
 * Durée de vie d'un service injectable.
 *
 * - `"singleton"` (défaut) : une instance pour tout le processus, rangée dans
 *   le conteneur du kernel à sa première résolution.
 * - `"transient"` : une instance neuve à chaque résolution ; elle vit aussi
 *   longtemps que celui qui la détient.
 * - `"request"` : une instance par requête HTTP — par CONNEXION en WebSocket,
 *   donc partagée par tous les messages et toutes les invocations concurrentes
 *   d'une même socket. Créée à sa première résolution dans la requête, rangée
 *   dans le scope de celle-ci, et nettoyée (`clean()`) à sa fermeture. Son
 *   constructeur reçoit le scope en premier argument. Un singleton ne peut pas
 *   en dépendre : il garderait l'exemplaire de la première requête pour toutes
 *   les suivantes — l'injecteur le refuse.
 */
export type DIScope = "singleton" | "transient" | "request";

export interface InjectableOptions {
  name?: string;
  scope?: DIScope;
}

const DI_SCOPES: ReadonlySet<string> = new Set<DIScope>([
  "singleton",
  "transient",
  "request",
]);

/** Noms d'une pile de résolution, pour les messages d'erreur (chemin froid). */
const namesOf = (stack: readonly ServiceConstructor[]): string =>
  stack.map((ctor) => ctor.name).join(" → ");

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
    return Injector.scopeOf(Ctor);
  }

  /**
   * Portée DÉCLARÉE d'une classe par `@injectable({ scope })` — `"singleton"`
   * si elle n'en déclare aucune. C'est elle qui décide comment l'injecteur
   * résout la classe quand on la réclame par son nom.
   *
   * @param service - le constructeur
   * @returns sa portée déclarée
   */
  static scopeOf(service: ServiceConstructor): DIScope {
    return (
      (Reflect.getMetadata("di:scope", service) as DIScope | undefined) ??
      "singleton"
    );
  }

  /**
   * Durée de vie EFFECTIVE d'une instance de `ctor`, pour juger si elle peut
   * détenir un service `request` : le statique `scope` d'abord — c'est lui que
   * suit le `Resolver` pour un contrôleur (`@Scope("singleton")` le met en
   * cache pour tout le processus) —, sinon la portée déclarée.
   *
   * @remarks Appelée seulement quand un service `request` est résolu, jamais
   *   sur le chemin de toutes les instanciations : le statique se lit en
   *   quelques nanosecondes, là où `Reflect.getMetadata` parcourt toute la
   *   chaîne des prototypes d'un contrôleur qui n'en porte pas.
   */
  private static _lifetimeOf(ctor: ServiceConstructor): DIScope {
    const own = (ctor as { scope?: unknown }).scope;
    return typeof own === "string" && DI_SCOPES.has(own)
      ? (own as DIScope)
      : Injector.scopeOf(ctor);
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
  //        request   : l'exemplaire du scope de la requête, créé au 1ᵉʳ besoin
  //        singleton : container kernel en premier, sinon instanciée PUIS mémoïsée
  //   2. Non @injectable → container kernel (services ajoutés via kernel.set())
  //   3. Sinon → throw
  //
  // `stack` : les constructeurs en cours, de la racine au demandeur.
  private static _resolveWithStack(
    serviceName: string,
    stack: ServiceConstructor[],
  ): unknown {
    if (Injector.isRegistered(serviceName)) {
      const Ctor = Injector.get(serviceName);
      const scope = Injector.scopeOf(Ctor);

      if (scope === "transient") {
        return Injector._instantiateWithStack(Ctor, stack, []);
      }
      if (scope === "request") {
        return Injector._resolveRequestScoped(serviceName, Ctor, stack);
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
        // Une dépendance captive est une faute de DÉCLARATION, pas d'ordre :
        // l'habiller du conseil « liste-le avant » enverrait chercher ailleurs.
        if (BootConfigurationError.is(error)) throw error;
        // Cas dominant : le service attend son module porteur, ne le reçoit pas
        // (une dépendance se résout sans argument) et casse sur `module.container`
        // — `Cannot read properties of undefined` ne dit RIEN de la vraie cause.
        // La cause quasi certaine est un ORDRE : dans `@services([...])`, un
        // service doit précéder ses consommateurs, sinon il n'est pas encore au
        // container quand ils le réclament.
        const requester = stack[stack.length - 1]?.name;
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

  // ─── Portée `request` ─────────────────────────────────────────────────────────
  //
  // L'exemplaire vit dans le scope de la requête courante, lu par l'ALS. Trois
  // refus, dans cet ordre : détenteur singleton (captive — faute de déclaration,
  // visible dès le boot), aucune requête ouverte, clé du scope déjà prise par un
  // autre objet. Coût nul pour une requête qui n'en résout aucun.
  private static _resolveRequestScoped(
    serviceName: string,
    Ctor: ServiceConstructor,
    stack: ServiceConstructor[],
  ): unknown {
    // Le DÉTENTEUR est le plus proche ancêtre non transient : une dépendance
    // transient vit aussi longtemps que celui qui la tient. S'il est singleton,
    // il est mémoïsé à sa première construction : il garderait l'exemplaire de
    // CETTE requête et le servirait à toutes les suivantes, concurrentes
    // comprises. Un avertissement laisserait tourner cette fuite de données
    // entre requêtes — on refuse, même pendant une requête. Une racine
    // transient sans détenteur appartient à son appelant : acceptée.
    for (let i = stack.length - 1; i >= 0; i--) {
      const lifetime = Injector._lifetimeOf(stack[i]);
      if (lifetime === "transient") continue;
      if (lifetime === "singleton") {
        const holder = stack[i].name;
        throw new BootConfigurationError(
          `Dépendance captive refusée : « ${holder} » (singleton) dépend de ` +
            `« ${serviceName} » (portée request) — chemin ${namesOf(stack)} → ` +
            `${serviceName}. Un singleton vit tout le processus : il garderait ` +
            `l'exemplaire de la première requête et le servirait à toutes les ` +
            `suivantes. Déclarer « ${holder} » en portée request, ou lui ` +
            `passer ce dont il a besoin en argument de méthode au lieu de ` +
            `l'injecter.`,
        );
      }
      break;
    }

    let scope: IScope;
    try {
      scope = RequestContext.requireScope();
    } catch (error) {
      throw new Error(
        `Service « ${serviceName} » (portée request) résolu hors d'une ` +
          `requête ouverte. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    // Lecture sur les propriétés PROPRES du scope : `get()` suivrait la chaîne
    // de prototypes et rendrait un singleton homonyme du conteneur racine.
    const learned = Injector.containerKeyOf(Ctor);
    const key = learned ?? serviceName;
    if (scope.hasOwn(key)) {
      const existing = scope.get(key);
      if (existing instanceof Ctor) return existing;
      throw Injector._requestKeyTaken(serviceName, key, existing);
    }

    // Le scope en premier argument : un service `request` n'a pas d'autre
    // conteneur à recevoir — construit sans, un `Service` fabriquerait un
    // conteneur orphelin.
    const instance = Injector._instantiateWithStack(Ctor, stack, [scope]);
    const canonicalKey = instance.name || serviceName;
    // Une clé posée par le pipeline (`context`, `controller`…) écrasée par un
    // service homonyme casserait la requête en silence : refus nommé.
    if (canonicalKey !== key && scope.hasOwn(canonicalKey)) {
      throw Injector._requestKeyTaken(
        serviceName,
        canonicalKey,
        scope.get(canonicalKey),
      );
    }
    // Apprise une fois pour toutes : ne réécrire la table qu'à la 1ʳᵉ requête.
    if (canonicalKey !== learned) {
      Injector.rememberContainerKey(Ctor, canonicalKey);
    }
    scope.set(canonicalKey, instance);
    scope.own(instance);
    return instance;
  }

  /** Erreur d'une clé de scope déjà occupée par un autre objet (chemin froid). */
  private static _requestKeyTaken(
    serviceName: string,
    key: string,
    occupant: unknown,
  ): Error {
    const kind =
      (occupant as { constructor?: { name?: string } } | null)?.constructor
        ?.name ?? typeof occupant;
    return new Error(
      `Service « ${serviceName} » (portée request) : la clé « ${key} » du ` +
        `scope de la requête est déjà occupée par un autre objet (${kind}). ` +
        `Le pipeline y range ses propres objets ; donner au service un autre ` +
        `nom (celui de son super()).`,
    );
  }

  // ─── Property injection post-construction ─────────────────────────────────────
  private static _applyPropertyInjection(
    constructor: ServiceConstructor,
    instance: unknown,
    stack: ServiceConstructor[],
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
  // `stack` : chemin de résolution courant — les CONSTRUCTEURS, propres à chaque
  // arbre d'appel (async-safe). Chaque niveau crée une copie [...stack, ctor] —
  // jamais de mutation du tableau parent. Des constructeurs et non des noms :
  // deux classes homonymes ne sont pas un cycle, et la portée d'un ancêtre se
  // relit sur lui — sans rien calculer tant qu'aucun service `request` n'est
  // résolu.
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
    stack: ServiceConstructor[],
    argsClass: unknown[],
  ): Service {
    // ── Détection circulaire ────────────────────────────────────────────────────
    if (stack.includes(constructor)) {
      throw new Error(
        `Circular dependency detected: ${namesOf([...stack, constructor])}`,
      );
    }
    const nextStack = [...stack, constructor];

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
