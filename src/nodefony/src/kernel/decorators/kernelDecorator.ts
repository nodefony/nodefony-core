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
  registeredNameOf,
  type ServiceEntry,
} from "../injector/serviceOrder";
import { BootConfigurationError } from "../BootConfigurationError";
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

/**
 * Déclare les services qu'un module enregistre dans son conteneur au démarrage.
 *
 * Décorateur de **classe de module**. Les services sont instanciés au hook
 * `onPreBoot`, et **l'ordre écrit ici n'a aucune importance** : il est recalculé
 * depuis les dépendances déclarées (`@inject`), de sorte qu'un service réclamé
 * soit présent avant son consommateur. Le hook est tagué au nom du module : un
 * service qui échoue suit la politique de criticité de SON module — fatal en
 * production, dégradation annoncée ailleurs — au lieu de faire tomber le boot
 * anonymement.
 *
 * @param nameOrPath - Une classe de service, un chemin de fichier, ou un tableau
 *   mêlant les deux.
 * @returns Le décorateur de classe, qui renvoie le module enrichi du hook.
 * @example
 * ```typescript
 * @services([Router, Eta, AdminBroker])
 * class FrameworkModule extends Module {}
 * ```
 */
function services(
  nameOrPath: string | (string | ServiceConstructor)[] | ServiceConstructor,
): <T extends Constructor>(constructor: T) => T {
  return function <T extends Constructor>(constructor: T): T {
    class NewConstructorService extends constructor {
      constructor(...args: any[]) {
        // Classe mixin : TypeScript IMPOSE `...args: any[]` (TS2545), l'étalement
        // vers le constructeur décoré est donc typé `any` par construction.
        // oxlint-disable-next-line typescript/no-unsafe-argument
        super(...args);
        // Tagué au nom du module (`hookKernel`) : un module optionnel dont un
        // service échoue à l'instanciation doit rester fail-soft, y compris en
        // production. Un `kernel.once` nu n'aurait porté aucune criticité.
        this.hookKernel("onPreBoot", async () => {
          return await this.initDecoratorServices();
        });
      }
      // Un service qui échoue passe par `handleServiceBootError` (Module) → la
      // politique de criticité du boot : fatal en production, fail-soft ANNONCÉ
      // (BootReport) ailleurs. Un simple `log(e, "ERROR")` — ce qui se faisait
      // ici — n'atteignait NI la politique (jamais fatal, même en prod) NI le
      // BootReport : un boot amputé d'un service critique se déclarait « UP ».
      private async initDecoratorServices(): Promise<void> {
        // L'ordre d'instanciation se CALCULE depuis les dépendances déclarées
        // (@inject / design:paramtypes) — il ne se lit plus dans la liste. Un
        // service réclamé doit être au container avant son consommateur ;
        // faire reposer ça sur l'ordre écrit à la main était un piège (déplacer
        // `HttpKernel` de 3 lignes → 499 sur chaque requête). Tri STABLE : une
        // liste déjà correcte sort inchangée.
        const entries: ServiceEntry[] = Array.isArray(nameOrPath)
          ? orderServicesByDependencies(nameOrPath)
          : [nameOrPath];
        for (const entry of entries) {
          if (typeof entry === "string") {
            await this.loadService(entry).catch((e: Error) => {
              this.handleServiceBootError(e, entry);
            });
          } else if (Injector.scopeOf(entry) === "request") {
            // Portée `request` : la DÉCLARER suffit (`@injectable` l'a
            // inscrite à l'import) — chaque requête créera son exemplaire à
            // sa première résolution. Rien à instancier au démarrage, mais
            // tout à VÉRIFIER : personne ne la construira avant une requête.
            try {
              // Portée HÉRITÉE d'une classe parente sans inscription propre :
              // aucune résolution ne la trouverait jamais.
              if (registeredNameOf(entry) === null) {
                throw new BootConfigurationError(
                  `Service « ${entry.name} » listé dans @services([...]) : sa ` +
                    `portée request est héritée d'une classe parente, mais lui ` +
                    `n'est pas inscrit — aucune résolution ne le trouverait. ` +
                    `Le déclarer par @injectable({ scope: "request" }).`,
                );
              }
              Injector.assertNoCaptiveDependency(entry);
              this.log(`SERVICE DECLARED (request) : ${entry.name}`, "DEBUG");
            } catch (e) {
              this.handleServiceBootError(e, entry);
            }
          } else {
            await this.addService(entry).catch((e: Error) => {
              this.handleServiceBootError(e, entry);
            });
          }
        }
      }
    }
    return NewConstructorService;
  };
}

/**
 * Rend une classe de service résoluble par le conteneur d'injection.
 *
 * Décorateur de **classe**. Il inscrit la classe à l'annuaire d'injection sous
 * un nom — celui de la classe par défaut — et fige sa portée. Sans lui, la
 * classe reste une classe ordinaire : elle ne peut être ni découverte, ni
 * injectée, et un `@inject("…")` qui la réclame échouera à la résolution.
 *
 * @param nameOrOptions - Le nom d'enregistrement, ou `{ name?, scope? }`. La
 *   portée vaut `"singleton"` par défaut — une seule instance pour le
 *   processus ; `"transient"` en fabrique une par résolution ; `"request"` une
 *   par requête (par connexion en WebSocket), nettoyée à sa fin — cf
 *   {@link DIScope}.
 * @returns Le décorateur de classe, qui renvoie la classe inchangée.
 * @example
 * ```typescript
 * @injectable()
 * class Router extends Service {}
 *
 * @injectable({ name: "pdfRenderer", scope: "transient" })
 * class PdfRenderer extends Service {}
 *
 * // Reçoit le scope de la requête en premier argument ; `false` : pas de bus
 * // d'événements par requête. Son `clean()` part avec la requête.
 * @injectable({ name: "tenant", scope: "request" })
 * class Tenant extends Service {
 *   constructor(scope: Scope) {
 *     super("tenant", scope, false);
 *   }
 * }
 * ```
 */
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
      (Reflect.getMetadata("inject:services", target) as
        (string | undefined)[] | undefined) || [];
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
      (Reflect.getMetadata("inject:properties", target) as
        PropertyInjectMeta[] | undefined) || [];
    existing.push({ key: propertyKey, name: resolvedName });
    Reflect.defineMetadata("inject:properties", existing, target);
  };
}

export { injectable, inject, Inject, services };
