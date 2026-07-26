import { dirname, resolve, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import Kernel, { ServiceConstructor, ServiceWithInit } from "./Kernel";
import { toImportSpecifier } from "./resolveModuleEntry";
import type { IModule, PackageJson } from "../types/IModule";
export type { PackageJson } from "../types/IModule";
import type { IKernel } from "../types/IKernel";
import { JSONObject } from "../types/globals";
import Service, { DefaultOptionsService } from "../Service";
import Command from "../command/Command";
import Injector from "./injector/injector";
import Container from "../Container";
import * as fs from "node:fs/promises";
import CliKernel from "./CliKernel";
import { extend } from "../Tools";
import { tagListener } from "./lifecycleTags";
import cluster from "node:cluster";
import Pdu, { Severity, Msgid, Message } from "../syslog/Pdu";
//import vm from "node:vm";
const regModuleName: RegExp = /^[Mm]odule-([\w-]+)/u;
import { createRequire } from "node:module";
// Type SEUL (paramètre de `TypeController<…>`) : le cœur ne dépend pas de
// `@nodefony/framework` à l'exécution — l'inverse serait un cycle.
import type { Controller } from "@nodefony/framework";
// oxlint-disable-next-line typescript/no-explicit-any -- signature de constructeur générique — `unknown[]` casse l'assignabilité des classes concrètes
export type TypeController<T> = new (...args: any[]) => T;
const controllers: Record<string, TypeController<Controller>> = {};

/**
 * Unité fonctionnelle de Nodefony — successeur direct du concept "Bundle" (Symfony / Nodefony JS).
 *
 * Un Module encapsule un domaine : routes, controllers, services, entités ORM, config, commandes
 * CLI. Il est instancié par le {@link Kernel} au boot depuis le manifeste `config.modules`
 * (résolu/chargé à `onPreRegister`). Hérite de {@link Service} → bénéficie du DI Container,
 * EventEmitter, Syslog.
 *
 * Hooks lifecycle disponibles (méthodes prototype obligatoires, jamais arrow ni property init —
 * `super()` tourne AVANT les initializers) :
 * - `onKernelRegister()` — phase `onRegister` (modules s'auto-déclarent)
 * - `onKernelBoot()` — phase `onBoot` (services bootés, connexions ouvertes)
 * - `onKernelReady()` — phase `onReady` (cross-wiring inter-modules)
 * - `init(kernel?)` — appelé par {@link Kernel.addModule}, équivalent constructeur async
 *
 * @example
 * ```ts
 * import { Module, services } from "nodefony";
 *
 * // `@services([...])` déclare les services du module ; l'ordre de la liste
 * // n'importe pas (il est recalculé depuis les dépendances déclarées).
 * @services([MyService])
 * export class MyModule extends Module {
 *   static readonly path: string = import.meta.url;
 *
 *   async onKernelBoot(): Promise<this> {
 *     this.log("Module booted", "INFO");
 *     return this;
 *   }
 * }
 * ```
 *
 * @remarks Le constructor attache TOUJOURS **un** listener, indépendamment des hooks de la
 *   sous-classe : un `prependOnceListener("onPreBoot")` qui charge le `package.json` du module
 *   ({@link Module.setEvents}). Les hooks `onKernelRegister/Boot/Ready` ne sont attachés que si la
 *   sous-classe les définit.
 */
class Module<TConfig = Record<string, unknown>>
  extends Service
  implements IModule
{
  commands: Record<string, Command> = {};
  static controllers = controllers;
  /**
   * Criticité du module pour la **résilience de boot** (Phase 3). `true` (défaut)
   * = un échec/timeout d'un de ses hooks lifecycle interrompt le boot **en
   * production** (le pod crashe → l'orchestrateur le redémarre, cloud-native) et
   * émet un WARNING **en développement** (le serveur démarre quand même). `false`
   * = fail-soft partout (le module est optionnel : un échec n'empêche jamais le
   * boot — ex. studio, fronts de démo, mediasoup, realtime, redis).
   *
   * ⚠️ **Statique** (pas une propriété d'instance) : lue dans le constructeur via
   * `Module.setEvents()`, donc AVANT que les initializers de la sous-classe ne
   * tournent — une `critical = false` en propriété d'instance arriverait trop
   * tard. Override déclaratif : `static override critical = false;`.
   */
  static critical: boolean = true;
  package?: PackageJson;
  path: string = "";
  isApp: boolean = false;
  /**
   * Noms des services enregistrés PAR ce module (via {@link addService},
   * y compris ceux du décorateur `@services`). Alloué au 1er ajout (lazy).
   * Sert l'introspection admin (Studio) — qui n'est pas inférable du Container
   * partagé seul. Cf {@link getServiceNames}.
   */
  private _serviceNames: string[] | null = null;
  public onKernelRegister?(): Promise<this>;
  public onKernelBoot?(): Promise<this>;
  public onKernelReady?(): Promise<this>;
  public init?(kernel?: IKernel): Promise<this>;
  /**
   * Initialise le module — appelé par {@link Kernel.addModule}.
   *
   * @param name - nom unique du module dans le kernel (key dans `kernel.modules`).
   * @param kernel - kernel parent (fournit container, syslog, lifecycle events).
   * @param path - chemin source du module (généralement `import.meta.url`).
   * @param options - config du module (merge avec defaults via `setParameters("modules.<name>")`).
   */
  constructor(
    name: string,
    kernel: Kernel,
    path: string,
    options: DefaultOptionsService,
  ) {
    super(name, kernel.container as Container, undefined, options);
    this.setParameters(`modules.${this.name}`, this.options);
    this.path = this.setPath(path);
    this.setEvents();
    // Aucun build runtime : le build des modules passe par la toolchain CLI
    // (`npm run build` / `nodefony build` → turbo + rolldown.config.ts par module),
    // PAS par un service rollup embarqué dans le process serveur (retiré 2026-06-02 :
    // doublon de config + coût d'import de la toolchain à chaque boot). En dev, le
    // rechargement backend = DevSupervisor (restart process) ; le HMR front = Vite.
  }

  /**
   * Schéma JSON (`z.toJSONSchema`) de la configuration du module, ou `null` si le
   * module n'est pas (encore) migré vers une validation Zod.
   *
   * Lu par le data plane admin ({@link KernelAdminApi} endpoint `module/{name}`) :
   * Studio affiche alors la config en mode « réglages documentés » (clé, type,
   * défaut, valeurs possibles, état, et valeur effective issue de `options`) au
   * lieu d'un dump brut clé→valeur. Les flags Nodefony (`reserved`,
   * `runtimeMutable`, `kernelDerived`, `secret`) attachés via `.meta()` (natif zod) sont
   * recopiés dans le JSON Schema par `z.toJSONSchema()` et exploités par l'UI.
   *
   * Défaut `null` (aucun schéma). Un module migré **override** pour renvoyer son
   * `xConfigJsonSchema()`. Le core n'importe PAS zod : la sérialisation vit dans
   * chaque module qui possède son schéma (0 dépendance ajoutée au cœur).
   *
   * @returns le JSON Schema de la config du module, ou `null`.
   */
  configSchema(): unknown | null {
    return null;
  }

  /**
   * Config **validée + gelée** du module — point d'accès UNIFORME et typé.
   *
   * Renvoie `this.options` (l'objet de config du module, réassigné par sa
   * validation Zod à `onKernelRegister`). Un module se type via
   * `extends Module<IXConfig>` → `this.config` est alors `IXConfig` sans cast.
   * Remplace le double idiome historique (`this.options` brut d'un côté,
   * `this.get("<module>Config")` de l'autre) par un seul accès. Coût nul : le
   * getter renvoie la référence, aucune allocation ni appel système.
   *
   * @returns la config du module, typée `TConfig` (défaut `Record<string, unknown>`).
   */
  get config(): TConfig {
    return this.options as unknown as TConfig;
  }

  /**
   * Résout le chemin source du module (`module.path`) — normalise URL `file://`,
   * remonte au-dessus de `dist/` si nécessaire.
   *
   * @remarks Opération purement LEXICALE, volontairement : l'entrée est déjà absolue
   *   (`import.meta.url`). Remonter le dossier `dist` passait auparavant par
   *   `resolve(myPath, "..")`, qui ancre le chemin sur le répertoire courant — donc sous
   *   Windows y ajoute la lettre de lecteur et normalise les séparateurs. La racine d'un
   *   module se mettait ainsi à dépendre de l'endroit d'où l'on avait lancé le process.
   *   `dirname` donne le même résultat sur tout chemin absolu, sans cet ancrage.
   *
   * @param myPath - chemin brut (souvent `import.meta.url` de la classe Module).
   * @returns chemin absolu du dossier source du module.
   */
  setPath(myPath: string): string {
    if (myPath.startsWith("file://")) {
      myPath = fileURLToPath(myPath);
    }
    const base = basename(dirname(myPath));
    const dir = base === "dist" ? dirname(myPath) : myPath;
    return dirname(dir);
  }

  gePath(name: string = this.name): string {
    return Module.getModulePath(name);
  }

  /**
   * Résout le chemin d'installation d'un module npm via `require.resolve`.
   *
   * @param name - nom du package npm (`"@nodefony/http"`, etc.).
   * @returns chemin absolu vers le dossier du module.
   */
  static getModulePath(name: string): string {
    const require = createRequire(import.meta.url);
    const pth = require.resolve(name);
    if (basename(dirname(pth)) === "dist") {
      return dirname(dirname(pth));
    }
    return dirname(pth);
  }

  /**
   * Câble les hooks lifecycle (`onKernelRegister/Boot/Ready`) sur le kernel parent.
   *
   * Appelé une seule fois dans le constructor. Lit les méthodes prototype définies par
   * la sous-classe et les attache via `kernel.once()`. Si la sous-classe ne définit pas
   * un hook, il n'est pas attaché (pas de listener orphelin).
   *
   * Toujours attache un listener `onPreBoot` (prepend, donc index 0) pour charger le
   * `package.json` du module. Les overrides de config `Module-<name>`, eux, ne passent
   * PLUS par ici : ils sont appliqués par `Kernel.applyModuleConfigOverrides()` entre
   * `onPreRegister` et `onRegister` (raison détaillée dans le corps de la méthode).
   */
  setEvents(): void {
    // Tags de politique de boot (Phase 3) : owner + criticité (statique → lisible
    // ici, avant les initializers de la sous-classe). Relus par
    // `Kernel.fireLifecycle()` pour décider propagation (critique+prod) vs fail-soft.
    const owner = this.name;
    const critical = (this.constructor as typeof Module).critical;
    if (this.onKernelRegister) {
      this.kernel?.once(
        "onRegister",
        tagListener(this.onKernelRegister.bind(this), owner, critical),
      );
    }
    if (this.onKernelBoot) {
      this.kernel?.once(
        "onBoot",
        tagListener(this.onKernelBoot.bind(this), owner, critical),
      );
    }
    if (this.onKernelReady) {
      this.kernel?.once(
        "onReady",
        tagListener(this.onKernelReady.bind(this), owner, critical),
      );
    }
    // `readOverrideModuleConfig` N'EST PLUS appelé ici : il l'était à `onPreBoot`
    // (bitmask 32), donc APRÈS la validation Zod des modules (`onKernelRegister`,
    // bitmask 16) → l'override `Module-<name>` était silencieusement ignoré pour
    // tout module qui fige sa config tôt (redis, realtime…). Il est désormais
    // appliqué par `Kernel.applyModuleConfigOverrides()` ENTRE `onPreRegister` et
    // `onRegister` (tous les modules enregistrés, validation pas encore faite).
    this.kernel?.prependOnceListener(
      "onPreBoot",
      tagListener(
        async () => {
          this.package = await this.getPackageJson();
        },
        owner,
        critical,
      ),
    );
  }

  /**
   * Pose un hook de cycle de vie du kernel **au nom de ce module** — donc avec sa
   * politique de boot (propriétaire + criticité), comme les hooks de classe.
   *
   * À utiliser partout où un hook est posé « à la main » depuis le module ou
   * depuis un de ses services (`this.module.hookKernel("onBoot", …)`) plutôt que
   * `kernel.once(...)` directement. Pourquoi : un listener non tagué n'a pas de
   * criticité, et {@link Kernel.isBootErrorFatal} traite l'absence de tag comme
   * **critique**. Un module qui déclare pourtant `static critical = false`
   * voyait donc son échec interrompre le boot en production — la déclaration ne
   * portait que sur ses hooks de classe, pas sur ceux de ses services. Le
   * journal ne pouvait même pas nommer le coupable (`"(anonyme)"`).
   *
   * @param event - nom de l'événement de cycle (`onRegister`, `onBoot`, `onReady`…).
   * @param listener - le hook ; il hérite du nom et de la criticité du module.
   * @returns le module (chaînable).
   */
  hookKernel(
    event: string,
    listener: (...args: never[]) => unknown | Promise<unknown>,
  ): this {
    const critical = (this.constructor as typeof Module).critical;
    this.kernel?.once(
      event,
      tagListener(listener as object, this.name, critical) as (
        ...args: unknown[]
      ) => unknown,
    );
    return this;
  }

  /**
   * Détecte les overrides de config destinés à d'autres modules (clés `Module-<name>`).
   *
   * Permet à un module de surcharger la config d'un autre module sans toucher au code de
   * ce dernier. Exemple : `Module-http: { port: 8080 }` dans la config de l'app → applique
   * `{ port: 8080 }` à `@nodefony/http`. Warn si module cible inconnu.
   *
   * @param deep - merge profond (`true`, défaut) vs shallow (`false`).
   * @returns options du module courant (inchangées — c'est la config des AUTRES modules qui est mutée).
   */
  readOverrideModuleConfig(deep: boolean = true): DefaultOptionsService {
    for (const ele in this.options) {
      let index: RegExpExecArray | null = null;
      const override: DefaultOptionsService = this.options[ele];
      index = regModuleName.exec(ele);
      if (index && index[1]) {
        const mod = this.kernel?.getModule(index[1] as string) as
          Module | undefined;
        if (!mod) {
          // Les overrides sont désormais appliqués à `preRegister` (tous les
          // modules @modules + l'app sont enregistrés) : un module introuvable ICI
          // est réellement ABSENT (non chargé), pas « pas encore enregistré ».
          // Niveau selon la SOURCE : l'APP qui référence un module qu'elle ne
          // charge pas = config morte → WARNING (compté au bilan de boot). Un
          // MODULE peut légitimement embarquer un override pour un module
          // OPTIONNEL (ex. studio → frontend, absent en livraison statique) et
          // ne peut pas savoir si sa cible est chargée → INFO.
          this.log(
            `Override de config ignoré : module "${index[1]}" introuvable (absent de @modules) — retirer la clé "${ele}" ou charger le module`,
            this.isApp ? "WARNING" : "INFO",
          );
          continue;
        }
        // Fonctionnement NOMINAL (un module surcharge la config d'un autre,
        // ex. framework → security) : INFO. Le WARNING était compté dans le
        // journal du bilan de boot comme une anomalie à traiter — à tort.
        this.log(`Override Configuration Module: ${mod.name}`, "INFO");
        if (deep) {
          mod.options = extend(true, {}, mod.options, override);
        } else {
          mod.options = extend({}, mod.options, override);
        }
      }
    }
    return this.options;
  }

  registerService(
    service: ServiceConstructor,
    name: string,
  ): ServiceConstructor {
    return Injector.register(name || service.constructor.name, service);
  }

  /**
   * Instancie un service via l'{@link Injector} et l'enregistre dans le container du module.
   *
   * Si le service expose une méthode `init(module)`, elle est appelée après
   * instanciation (équivalent constructeur async). Warn si un service du même nom existe
   * déjà (override).
   *
   * @param service - constructeur du service (typiquement décoré `@injectable`).
   * @param args - arguments additionnels passés au constructeur (après les `@inject` resolved).
   * @returns instance du service prête à l'usage.
   */
  async addService(
    service: ServiceConstructor,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    const inst = Injector.instantiate(service, this, ...args);
    if (this.get(inst.name)) {
      this.log(
        `SERVICE ALREADY EXIST  override old service  : ${inst.name}`,
        "WARNING",
      );
    }
    this.log(`SERVICE ADD : ${inst.name}`, "DEBUG");
    const serviceInit: ServiceWithInit = inst;
    const kernel = this.kernel as Kernel | null;
    if (kernel) {
      // Init SOUS GARDE (timeout + criticité du module porteur), comme les
      // services kernel : un `init` qui pend ne gèle plus le boot.
      await kernel.guardServiceInitialize(
        serviceInit,
        this,
        (this.constructor as typeof Module).critical,
      );
    } else if (serviceInit.init) {
      // Pas de kernel (test isolé / module orphelin) → init direct non gardé.
      this.log(`SERVICE INITIALIZE : ${inst.name}`, "DEBUG");
      await serviceInit.init(this);
    }
    // Le seul instant où le couple (classe, clé container) est connu : le
    // décorateur `@injectable` indexe la CLASSE, `super(nom, …)` la clé — et il
    // ne s'exécute qu'ici. On l'apprend pour que toute résolution ultérieure
    // (`@inject("Router")`, injection par type) retrouve CETTE instance au lieu
    // d'en fabriquer une seconde sous un nom qui ne round-trippe pas.
    Injector.rememberContainerKey(service, inst.name);
    this.set(inst.name, inst);
    (this._serviceNames ??= []).push(inst.name);
    return this.get<Service>(inst.name) as Service;
  }

  /**
   * Politique d'échec d'un service déclaré via `@services([...])` : la MÊME que
   * pour le reste du boot — fatal en production (ou sur une erreur de
   * configuration), fail-soft **ANNONCÉ** ailleurs (agrégé au BootReport, qui
   * fait dire « boot DÉGRADÉ » au superviseur). Jamais un skip silencieux.
   *
   * Appelée par le décorateur `@services`, dont le `catch` se contentait de
   * logger : l'échec n'atteignait ni la politique de criticité ni le BootReport.
   *
   * @param error - l'échec remonté par `addService`/`loadService`.
   * @param service - le constructeur (ou le chemin) du service fautif.
   * @throws l'erreur d'origine si l'échec est fatal (production + module critique).
   */
  handleServiceBootError(
    error: unknown,
    service: string | ServiceConstructor,
  ): void {
    const serviceName =
      typeof service === "string" ? service : (service?.name ?? "(anonyme)");
    const kernel = this.kernel as Kernel | null;
    if (!kernel) {
      // Module orphelin (test isolé) : aucune politique de boot à appliquer.
      this.log(error as Error, "ERROR");
      return;
    }
    const critical = (this.constructor as typeof Module).critical;
    if (
      kernel.serviceBootErrorFatal(
        error,
        `${this.name} → ${serviceName}`,
        critical,
      )
    ) {
      throw error;
    }
  }

  /**
   * Noms des services enregistrés par ce module (ordre d'ajout).
   * Vide tant qu'aucun service n'a été ajouté.
   */
  getServiceNames(): string[] {
    return this._serviceNames ? [...this._serviceNames] : [];
  }

  /**
   * Charge dynamiquement un service depuis un chemin (`import()`) puis l'enregistre via
   * {@link addService}.
   *
   * @param service - chemin/spécifier du module à importer (URL, npm package, path relatif).
   * @param args - arguments additionnels passés au constructeur.
   * @returns instance du service après instanciation + `init()`.
   */
  async loadService(
    service: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    // if (!module) {
    //   throw new Error(`Applcation not ready`);
    // }
    const res = await import(toImportSpecifier(service));
    return this.addService(res.default, ...args);
  }

  async getPackageJson(cwd?: string): Promise<PackageJson> {
    return (await this.loadJson(
      resolve(this.path, "package.json"),
      cwd,
    )) as PackageJson;
  }

  /**
   * Récupère un controller enregistré **dans ce module**.
   *
   * Le registre `Module.controllers` est process-global mais indexé par clé
   * **module-scopée** `${module}:${ClassName}` (posée par `Router.setController`),
   * exactement comme l'identité d'un `forward("module:controller:action")`. Deux
   * modules peuvent donc porter un controller homonyme sans collision.
   *
   * @param name - nom de classe du controller (ex. `"DefaultController"`).
   * @returns constructeur typé du controller.
   * @throws Si `name` est falsy ou si le controller n'est pas enregistré pour ce module.
   */
  getController<T = Controller>(name: string): TypeController<T> {
    if (!name) {
      throw new Error(`Module getController argument name is mandatory`);
    }
    const key = `${this.name}:${name}`;
    if (Module.controllers[key]) {
      return Module.controllers[key] as TypeController<T>;
    }
    throw new Error(`Controller ${key} not exist`);
  }

  /**
   * Retourne les controllers enregistrés **pour ce module** (clés = nom de classe
   * nu, préfixe module retiré). Vue jetable filtrée depuis le registre global.
   */
  getControllers<T = Controller>(): Record<string, TypeController<T>> {
    const prefix = `${this.name}:`;
    const out: Record<string, TypeController<T>> = {};
    for (const key in Module.controllers) {
      if (key.startsWith(prefix)) {
        out[key.slice(prefix.length)] = Module.controllers[
          key
        ] as TypeController<T>;
      }
    }
    return out;
  }

  /**
   * Liste les dépendances + peerDependencies du module (depuis son `package.json`).
   *
   * @returns array de noms de packages npm. **devDependencies exclus**. Doublons possibles
   *   si un même package est listé dans `dependencies` ET `peerDependencies`.
   */
  getDependencies(): string[] {
    return Module.getPackageDependencies(this.package as PackageJson);
  }

  /**
   * Variante static — extrait les deps depuis un `package.json` arbitraire.
   *
   * @param mypackage - objet `package.json` parsé.
   * @returns array de noms de packages npm (deps + peerDeps, devDeps exclus).
   */
  static getPackageDependencies(mypackage: PackageJson): string[] {
    if (mypackage) {
      const dependencies = Object.keys(mypackage.dependencies || {});
      const peerDependencies = Object.keys(mypackage.peerDependencies || {});
      return [...dependencies, ...peerDependencies];
    }
    return [];
  }

  public getModuleName(): string | undefined {
    return this.package?.name;
  }

  public getModuleVersion(): string | undefined {
    return this.package?.version;
  }

  /**
   * Enregistre une commande CLI custom rattachée à ce module.
   *
   * Pattern legacy `nodefony <name>:<action>` (ex: `nodefony users:add`). Le {@link CliKernel}
   * doit être disponible (sinon throw `Kernel not ready`). En mode cluster worker, exceptions
   * non-primary sont silencieusement avalées (retour `void`).
   *
   * @param cliCommand - constructeur de la commande (extends `Command`).
   * @returns instance de la commande enregistrée OU `void` si worker secondaire.
   * @throws `Error("Kernel not ready")` si `kernel.cli` n'est pas instancié.
   */
  public addCommand(
    cliCommand: new (cli: CliKernel) => Command,
  ): Command | void {
    if (this.kernel && this.kernel.cli) {
      try {
        const command = new cliCommand(this.kernel.cli as CliKernel);
        this.commands[command.name] = command;
        return command;
      } catch (e) {
        if (cluster.isPrimary) {
          throw e;
        } else if (cluster.isWorker) {
          return;
        }
      }
    }
    throw new Error(`Kernel not ready`);
  }

  /**
   * Exécute `npm install` (ou yarn/pnpm) dans le dossier du module.
   *
   * @param force - ajoute `--force` à l'install. Défaut `false`.
   * @returns code de retour du process (0 = succès) ou Error si crash.
   * @throws Si `packageManager` n'est pas attaché au CliKernel.
   */
  async install(force: boolean = false): Promise<number | Error> {
    if ((this.kernel?.cli as CliKernel)?.packageManager) {
      if (force) {
        return await (this.kernel?.cli as CliKernel)?.packageManager(
          ["install", "--force"],
          this.path,
        );
      }
      return await (this.kernel?.cli as CliKernel)?.packageManager(
        ["install"],
        this.path,
      );
    }
    throw new Error(`Package Manager not found`);
  }

  /**
   * Exécute `npm outdated` dans le dossier du module.
   *
   * @returns code de retour du process ou Error si crash.
   * @throws Si `packageManager` n'est pas attaché au CliKernel.
   */
  async outdated(): Promise<number | Error> {
    if ((this.kernel?.cli as CliKernel)?.packageManager) {
      return await (this.kernel?.cli as CliKernel)?.packageManager(
        ["outdated"],
        this.path,
      );
    }
    throw new Error(`Package Manager not found`);
  }

  async loadJson(
    url: string,
    cwd: string = process.cwd(),
  ): Promise<JSONObject> {
    try {
      const detectpath = isAbsolute(url) ? url : resolve(cwd, url);
      const fileContent = await fs.readFile(detectpath, "utf-8");
      const parsedJson = JSON.parse(fileContent);
      return parsedJson;
    } catch (error) {
      this.log(error, "ERROR");
      throw error;
    }
  }

  /**
   * Surcharge {@link Service.log} — `msgid` défaut = `"MODULE <name>"` pour identifier
   * les logs de ce module dans le pipeline Syslog.
   *
   * @param pci - payload (string, Error, objet — narrower côté lecteur).
   * @param severity - sévérité RFC 5424 (`"INFO"`, `"ERROR"`, etc.).
   * @param msgid - catégorie de message. Défaut `"MODULE <name>"`.
   * @param msg - détail libre optionnel.
   * @returns le `Pdu` produit (utile pour audit/tests).
   */
  override log(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pci: any,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ): Pdu {
    if (!msgid) {
      msgid = `MODULE ${this.name}`;
    }
    return super.log(pci, severity, msgid, msg);
  }
}

export default Module;
