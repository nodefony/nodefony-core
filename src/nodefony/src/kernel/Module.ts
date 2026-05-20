import { dirname, resolve, basename, isAbsolute } from "node:path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import Kernel, {
  ServiceConstructor,
  ServiceWithInitialize,
  EntityConstructor,
} from "./Kernel";
import type { IModule, PackageJson } from "../types/IModule";
export type { PackageJson } from "../types/IModule";
import type { IKernel } from "../types/IKernel";
import { JSONObject } from "../types/globals";
import Service, { DefaultOptionsService } from "../Service";
import Command from "../command/Command";
import Injector from "./injector/injector";
import Container from "../Container";
import * as fs from "fs/promises";
import CliKernel from "./CliKernel";
import { extend } from "../Tools";
import cluster from "node:cluster";
import Pdu, { Severity, Msgid, Message } from "../syslog/Pdu";
import RollupService from "../service/rollup/rollupService";
import watcherService from "../service/watcherService";
//import vm from "node:vm";
const regModuleName: RegExp = /^[Mm]odule-([\w-]+)/u;
import {
  RollupWatchOptions,
  RollupOptions,
  RollupWatcher,
  rollup,
  RollupOutput,
  OutputOptions,
  LogLevel,
  RollupLog,
} from "rollup";
import { FSWatcher } from "chokidar";
import { createRequire } from "node:module";
import Entity from "./orm/Entity";
import { Controller } from "@nodefony/framework";
export type TypeController<T> = new (...args: any[]) => T;
const controllers: Record<string, TypeController<Controller>> = {};

/**
 * Unité fonctionnelle de Nodefony — successeur direct du concept "Bundle" (Symfony / Nodefony JS).
 *
 * Un Module encapsule un domaine : routes, controllers, services, entités ORM, config, commandes
 * CLI. Il est instancié par le {@link Kernel} au boot via le décorateur `@modules([...])` côté
 * application. Hérite de {@link Service} → bénéficie du DI Container, EventEmitter, Syslog.
 *
 * Hooks lifecycle disponibles (méthodes prototype obligatoires, jamais arrow ni property init —
 * `super()` tourne AVANT les initializers) :
 * - `onKernelRegister()` — phase `onRegister` (modules s'auto-déclarent)
 * - `onKernelBoot()` — phase `onBoot` (services bootés, connexions ouvertes)
 * - `onKernelReady()` — phase `onReady` (cross-wiring inter-modules)
 * - `initialize(kernel?)` — appelé par {@link Kernel.addModule}, équivalent constructeur async
 *
 * @example
 * ```ts
 * import { Module, Service } from "nodefony";
 *
 * @Service({ singleton: true })
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
 * @remarks Le constructor ajoute TOUJOURS 2 listeners (onBoot + onPostReady) indépendamment des
 *   hooks user — comportement normal pour récupérer rollup/watcher + démarrer le watch dev.
 */
class Module extends Service implements IModule {
  commands: Record<string, Command> = {};
  static controllers = controllers;
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
  rollup?: RollupService | null;
  watcherService?: watcherService | null;
  watcher?: FSWatcher | null;
  public onKernelRegister?(): Promise<this>;
  public onKernelBoot?(): Promise<this>;
  public onKernelReady?(): Promise<this>;
  public initialize?(kernel?: IKernel): Promise<this>;
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
    this.kernel?.once("onBoot", async () => {
      this.rollup = this.get<RollupService>("rollup");
      this.watcherService = this.get<watcherService>("watcher");
    });
    this.kernel?.once("onPostReady", async () => {
      if (this.options.watch && this.kernel?.environment === "development") {
        await this.watch();
      }
    });
  }

  /**
   * Démarre un watcher Rollup sur les sources du module (mode dev).
   *
   * Appelé automatiquement à `onPostReady` si `options.watch === true` ET environnement
   * `development`. Recompile les fichiers TS modifiés à la volée et écrit dans `dist/`.
   *
   * @param options - surcharge optionnelle de la config Rollup (sinon defaults via {@link RollupService.setDefaultConfig}).
   * @returns instance `RollupWatcher` active (chokidar sous-jacent).
   * @throws Si le `watcherService` n'est pas disponible dans le container.
   */
  async watch(options?: RollupWatchOptions): Promise<RollupWatcher> {
    if (this.watcherService) {
      const mylog = function (this: Module, level: LogLevel, log: RollupLog) {
        this.rollup?.loggerRollup(this, level, log);
      }.bind(this);
      options = RollupService.setDefaultConfig(
        this,
        this.kernel?.environment,
        mylog,
      );
      return this.watcherService?.createRollupWatcher(this, options);
    }
    throw new Error(`Watcher Service service not found`);
  }

  /**
   * Build one-shot du module via Rollup (mode prod ou test).
   *
   * Lit `package.json` du module, applique la config Rollup par défaut, écrit dans
   * `dist/`. À ne pas confondre avec {@link watch} (mode continu dev).
   *
   * @returns objet `RollupOutput` contenant les bundles produits.
   */
  async build(): Promise<RollupOutput> {
    const pck = await readFile(resolve(this.path, "package.json"), "utf8");
    const jsonPck = JSON.parse(pck) as PackageJson;
    const ele = {
      path: this.path,
      package: jsonPck,
      getDependencies: () => {
        return Module.getPackageDependencies(jsonPck);
      },
    } as Module;
    const options = RollupService.setDefaultConfig(ele);
    const bundle = await rollup(options);
    const res = await bundle.write(options.output as OutputOptions);
    await bundle.close();
    return res;
  }

  /**
   * Résout le chemin source du module (`module.path`) — normalise URL `file://`,
   * remonte au-dessus de `dist/` si nécessaire.
   *
   * @param myPath - chemin brut (souvent `import.meta.url` de la classe Module).
   * @returns chemin absolu du dossier source du module.
   */
  setPath(myPath: string): string {
    if (/^file:\/\//.test(myPath)) {
      myPath = fileURLToPath(myPath);
    }
    const base = basename(dirname(myPath));
    let dir = null;
    if (base === "dist") {
      dir = resolve(myPath, "..");
    } else {
      dir = myPath;
    }
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
   * Toujours attache un listener `onPreBoot` (prepend, donc index 0) pour charger
   * `package.json` + appliquer les overrides de config.
   */
  setEvents(): void {
    if (this.onKernelRegister) {
      this.kernel?.once("onRegister", this.onKernelRegister.bind(this));
    }
    if (this.onKernelBoot) {
      this.kernel?.once("onBoot", this.onKernelBoot.bind(this));
    }
    if (this.onKernelReady) {
      this.kernel?.once("onReady", this.onKernelReady.bind(this));
    }
    this.kernel?.prependOnceListener("onPreBoot", async () => {
      this.package = await this.getPackageJson();
      this.readOverrideModuleConfig();
    });
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
          | Module
          | undefined;
        if (!mod) {
          this.log(
            `Can't Override Configuration Module : ${index[1]} is not ready, Register module before`,
            "ERROR",
          );
          continue;
        }
        this.log(`Override Configuration Module: ${mod.name}`, "WARNING");
        if (deep) {
          mod.options = extend(true, {}, mod.options, override);
        } else {
          mod.options = extend({}, mod.options, override);
        }
      }
    }
    return this.options;
  }

  async getRollupConfig(): Promise<RollupOptions> {
    return (await this.rollup?.getRollupConfigTs(this)) as RollupOptions;
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
   * Si le service expose une méthode `initialize(module)`, elle est appelée après
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
    const serviceInit: ServiceWithInitialize = inst;
    if (serviceInit.initialize) {
      this.log(`SERVICE INITIALIZE : ${inst.name}`, "DEBUG");
      await serviceInit.initialize(this);
    }
    this.set(inst.name, inst);
    (this._serviceNames ??= []).push(inst.name);
    return this.get<Service>(inst.name) as Service;
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
   * @returns instance du service après instanciation + `initialize()`.
   */
  async loadService(
    service: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    // if (!module) {
    //   throw new Error(`Applcation not ready`);
    // }
    const res = await import(service);
    return this.addService(res.default, ...args);
  }

  async getPackageJson(cwd?: string): Promise<PackageJson> {
    return (await this.loadJson(
      resolve(this.path, "package.json"),
      cwd,
    )) as PackageJson;
  }

  /**
   * Récupère un controller enregistré (registre statique partagé tous modules).
   *
   * @param name - nom du controller (généralement nom de classe).
   * @returns constructeur typé du controller.
   * @throws Si `name` est falsy ou si le controller n'est pas dans `Module.controllers`.
   */
  getController<T = Controller>(name: string): TypeController<T> {
    if (!name) {
      throw new Error(`Module getController argument name is mandatory`);
    }
    if (Module.controllers[name]) {
      return Module.controllers[name] as TypeController<T>;
    }
    throw new Error(`Controller ${name} not exist`);
  }
  getControllers<T = Controller>(): Record<string, TypeController<T>> {
    return Module.controllers as Record<string, TypeController<T>>;
  }

  async loadEntity(entity: string) {
    const res = await import(entity);
    return this.addEntity(res.default);
  }

  addEntity(entity: EntityConstructor): Entity {
    const inst = new entity(this);
    return inst;
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
