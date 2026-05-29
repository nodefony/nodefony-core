/* eslint-disable @typescript-eslint/ban-ts-comment */
import clc from "cli-color";
import cluster from "node:cluster";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Container, { Scope } from "../Container";
import FileClass from "../FileClass";
import { Nodefony } from "../Nodefony";
import Orm from "./orm/Orm";
import Service, { DefaultOptionsService } from "../Service";
import { extend, isSubclassOf } from "../Tools";
import Command, { CommandArgs } from "../command/Command";
import { Severity } from "../syslog/Pdu";
import { DebugType, EnvironmentType } from "../types/globals";
import CliKernel from "./CliKernel";
import Module from "./Module";
//import Fetch from "../service/fetchService";
import { HttpKernel } from "@nodefony/http";
import Pm2 from "../service/pm2Service";
import Rollup from "../service/rollup/rollupService";
import Injector from "./injector/injector";
import Entity from "./orm/Entity";
import {
  isClusterMessage,
  CLUSTER_RT_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
} from "../service/cluster/clusterMessage";
import type { IKernel } from "../types/IKernel";
import type { IGuardedEmitResult, IGuardedListenerInfo } from "../Event";
import { withTimeout, TimeoutError } from "../runtime/withTimeout";
import { readListenerTags } from "./lifecycleTags";
//import Babylon from "../service/babel/babylon";
//import { StartOptions } from "pm2";

const colorLogEvent = clc.cyan.bgBlue("EVENT KERNEL");

export interface TypeKernelOptions extends DefaultOptionsService {
  node_start?: NodefonyStartType;
  log?: {
    active?: boolean;
    debug?: DebugType;
  };
}

interface MemoryStats {
  rss: number; // Resident Set Size
  heapTotal: number; // Total size of the heap
  heapUsed: number; // Heap actually used
  external: number; // Memory used by external C++ objects
}

interface Stats {
  memory: MemoryStats;
  // Ajoutez d'autres propriétés avec les types appropriés ici
}

const kernelDefaultOptions: TypeKernelOptions = {
  events: {
    nbListeners: 60,
    //captureRejections: true,
  },
};

type ClusterType = "master" | "worker";
type NodefonyStartType = "PM2" | "CONSOLE" | "NODEFONY" | "NODEFONY_CONSOLE";

// type EventsType = {
//   [key: string]: number;
// };

type EventsType = Record<string, number>;

const Events: Readonly<EventsType> = Object.freeze({
  onInit: 1 << 0,
  onPreStart: 1 << 1,
  onStart: 1 << 2,
  onPreRegister: 1 << 3,
  onRegister: 1 << 4,
  onPreBoot: 1 << 5,
  onBoot: 1 << 6,
  onReady: 1 << 7,
  onServersReady: 1 << 8,
  onPostReady: 1 << 9,
  onTerminate: 1 << 10,
});

export type KernelEventsType = keyof typeof Events;

export type KernelType = "console" | "server" | "CONSOLE" | "SERVER";

interface AppEnvironmentType {
  environment: EnvironmentType | string;
}

export interface NetworkInterface {
  [name: string]: os.NetworkInterfaceInfo[];
}
export type FamilyType = "IPv4" | "IPv6";

export interface FilterInterface {
  type?: "local" | "external";
  family?: FamilyType;
  condition?: "&&" | "||" | "==";
}

export interface ServiceWithInitialize extends Service {
  initialize?(module?: Module | Kernel): Promise<Service>;
}

export interface ServiceConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): ServiceWithInitialize;
  _inject?: { [key: number]: string };
}

export interface EntityConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): Entity;
}

export interface ModuleConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (kernel: Kernel, ...args: any[]): Module;
}

type trunkType = "javascript" | "typescript" | null;

/**
 * Orchestrateur central de Nodefony — gère le boot, les modules, le DI Container racine,
 * et expose les events lifecycle auxquels services/modules se branchent.
 *
 * Hérite de {@link Service} → bénéficie DI, EventEmitter, Syslog. Pollue le singleton
 * `Nodefony.#kernel` au constructor (`Nodefony.setKernel(this)`) — isoler les tests avec
 * un mock minimal.
 *
 * **Lifecycle phases** (chronologiques, jamais régressives) :
 * `started → preRegistered → registered → booted → ready → postReady`
 *
 * **Events bitmask** (`progress` = OR cumulatif) :
 * - `onInit=1`, `onPreStart=2`, `onStart=4`
 * - `onPreRegister=8`, `onRegister=16`
 * - `onPreBoot=32`, `onBoot=64`
 * - `onReady=128`, `onServersReady=256`, `onPostReady=512`
 * - `onTerminate=1024`
 *
 * **Chaîne async** (chaque maillon appelle le suivant si `!setCommandComplete`) :
 * `start() → preRegister() → boot() → onReady() → initServers()`
 *
 * @example
 * ```ts
 * import { CliKernel } from "nodefony";
 * const cli = new CliKernel("development");
 * await cli.start();   // → new Kernel(env, cli) → kernel.start() → boot complet
 * ```
 */
class Kernel extends Service implements IKernel {
  Events: Readonly<EventsType> = Events;
  type: KernelType;
  version: string = "1.0.0";
  started: boolean = false;
  booted: boolean = false;
  ready: boolean = false;
  postReady: boolean = false;
  trunk: trunkType = null;
  core: boolean = false;
  command: Command | null = null;
  commandArgs: CommandArgs = [];
  preRegistered: boolean = false;
  registered: boolean = false;
  app: Module | null = null;
  cli: CliKernel | null = null;
  environment: EnvironmentType = "production";
  debug: DebugType = false;
  appEnvironment: AppEnvironmentType = {
    environment: process.env.NODE_ENV as string,
  };
  path: string = process.cwd();
  typeCluster: ClusterType = this.clusterIsMaster() ? "master" : "worker";
  pid: number = process.pid;
  //process: NodeJS.Process = process;
  workerId: number | undefined = cluster.worker?.id;
  worker = cluster.worker;
  console: boolean = this.isConsole();
  node_start: NodefonyStartType =
    process.env.NODEFONY_START || this.options.node_start;
  platform: NodeJS.Platform = process.platform;
  projectName: string = "NODEFONY";
  uptime: number = new Date().getTime();
  numberCpu: number = os.cpus().length;
  modules: Record<string, Module> = {};
  tmpDir?: FileClass;
  interfaces: NetworkInterface;
  domain: string = "localhost";
  progress: number = Events.onInit;
  pm2?: Pm2;
  injector: Injector;
  isDev: boolean = false;
  isProd: boolean = true;
  // Buffer FIFO des `MODULE ADD` émis avant l'en-tête `SERVER` (logEnv) —
  // flushé par `initCluster()` après le banner. Tant qu'il n'est pas null
  // les logs sont différés ; passé à `null`, addModule() log immédiatement.
  private pendingModuleAddLogs: string[] | null = [];
  //babel?: Babylon;
  /**
   * Construit le Kernel. **Side effect critique** : appelle `Nodefony.setKernel(this)` →
   * écrase le singleton global. Isoler les tests avec un mock minimal pour éviter de
   * polluer les autres tests qui dépendent de `Nodefony.getKernel()`.
   *
   * Récupère le container du CLI si présent, sinon en crée un nouveau. Initialise les
   * interfaces réseau OS pour `setDomain()`. Fire `"onInit"` à la fin.
   *
   * @param environment - environnement (`"development"` / `"production"` / `"test"`).
   * @param cli - kernel CLI parent (fournit container, packageManager, commander). Peut être null.
   * @param options - options surchargées (events.nbListeners, log, etc.).
   */
  constructor(
    environment: EnvironmentType,
    cli?: CliKernel | null,
    options?: TypeKernelOptions,
  ) {
    const container: Container | Scope | null | undefined = cli?.container;
    const mergedOptions = extend(
      {},
      kernelDefaultOptions,
      options,
    ) as TypeKernelOptions;
    super(
      "KERNEL",
      container as Container,
      undefined, //cli.notificationsCenter as Event,
      mergedOptions,
    );
    this.environment = environment;
    // Limite de listeners alignée sur la config (`events.nbListeners`, défaut 60) :
    // chaque module/service attache ≥1 listener lifecycle (onBoot/onTerminate/…),
    // un `30` en dur sautait dès ~15 modules (MaxListenersExceededWarning au boot).
    this.setMaxListeners(mergedOptions.events?.nbListeners ?? 60);
    Nodefony.setKernel(this);
    this.kernel = this;
    this.set("kernel", this);
    this.type = "CONSOLE";
    this.cli = this.setCli(cli);
    this.interfaces = this.getNetworkInterfaces();
    this.injector = new Injector(this);
    this.set("injector", this.injector);
    this.fire("onInit", this);
  }

  /**
   * Point d'entrée du boot. Fire `"onPreStart"` puis `"onStart"`, charge l'application
   * (`loadApp()`), instancie services kernel (Rollup, Pm2), puis enchaîne sur
   * `preRegister()` → `boot()` → `onReady()` → `initServers()`.
   *
   * Si `command.kernelEvent` matche une phase déjà atteinte → terminate(0) immédiat (la
   * command a fini son boulot, pas besoin d'aller plus loin).
   *
   * @returns `this` après boot complet.
   * @throws Toute exception du pipeline est loggée CRITIC puis re-throw.
   */
  async start(): Promise<this> {
    this.debug = Boolean(this.cli?.commander?.opts().debug) || false;
    this.trunk = await this.isTrunk();
    this.initializeLog();
    if (!this.trunk && this.cli) {
      return await this.cli
        .runCommandAsync("start", ["-i"])
        .then(() => {
          if (this.command) {
            return this.command?.action(...this.commandArgs).then(() => {
              return this;
            });
          }
          return this;
        })
        .catch((e) => {
          this.log(e, "ERROR");
          throw e;
        });
    }

    // Splash en TÊTE du boot — affiché AVANT `SERVICE ADD`, `MODULE ADD` et les
    // events kernel. Le nom utilisé est `projectName` (="NODEFONY" jusqu'à ce
    // que loadApp() le remplace par le nom de l'app). Précédemment l'ASCII art
    // arrivait dans `preRegister()`, donc après plusieurs lignes de logs —
    // l'UX boot était confuse, le banner servait de séparateur en plein milieu.
    if (this.cli) {
      await this.cli.showAsciify(this.projectName).catch((e) => {
        this.log(e, "WARNING");
      });
      this.cli.showBanner();
      this.cli.blankLine();
    }

    // `tmp/` est gitignored (jamais commité) → absent sur un checkout frais (CI),
    // un container/pod neuf ou un premier boot. `FileClass` fait un `lstatSync()`
    // synchrone qui throw ENOENT si le dossier manque → `start()` rejette à
    // progress=1 (terminate:0, jamais de "Server Listen"). On garantit donc le
    // dossier ici (idempotent, un seul syscall au boot — hors hot path).
    const tmpPath = path.resolve(process.cwd(), "tmp");
    fs.mkdirSync(tmpPath, { recursive: true });
    this.tmpDir = new FileClass(tmpPath);
    //TODO don't instancce on prod
    //this.babel = (await this.addKernelService(Babylon)) as Babylon;
    await this.addKernelService(Rollup);

    if (!this.started) {
      await this.fireAsync("onPreStart", this).catch((e) => {
        this.log(e, "CRITIC");
        throw e;
      });
      if (this.setCommandComplete(Events.onPreStart)) {
        return this.terminate(0);
      }

      // load application
      await this.loadApp().catch((e) => {
        this.log(e, "CRITIC");
        throw e;
      });
      this.domain = this.setDomain();
      if (this.app) {
        this.projectName = this.app.getModuleName() as string;
      }
      this.pm2 = (await this.addKernelService(Pm2, this.options.pm2)) as Pm2;
      //parse command
      // if (this.cli && !this.command) {
      //   this.cli.clear();
      //   await this.cli.showAsciify(this.projectName);
      //   this.cli.showBanner();
      //   await this.cli.parseCommandAsync().catch((e) => {
      //     this.log(e, "ERROR");
      //     throw e;
      //   });
      // }
      return this.fireAsync("onStart", this)
        .then(async () => {
          // if (this.app) {
          //   this.projectName = this.app.getModuleName();
          // }
          this.started = true;
          if (this.cli) this.type = this.cli?.type;
          if (this.setCommandComplete(Events.onStart)) {
            return this.terminate(0);
          }
          return this.preRegister();
        })
        .catch((e) => {
          if (e.message !== "(outputHelp)") {
            this.log(e, "CRITIC");
          }
          throw e;
        });
    }
    return this;
  }

  /**
   * Phase pré-registration — fire `"onPreRegister"` puis `"onRegister"`. Les décorateurs
   * `@modules([...])` sont consommés ici (handler attaché en `prependOnceListener`).
   *
   * @returns `this` ou chaîne sur `boot()`.
   */
  async preRegister(): Promise<this> {
    // GARDÉ (Phase 3) : un module qui throw/se fige en pré-registration ne gèle
    // plus le boot ; fireLifecycle logge + propage selon criticité (prod).
    await this.fireLifecycle("onPreRegister", this);

    if (this.setCommandComplete(Events.onPreRegister)) {
      return this.terminate(0);
    }
    this.preRegistered = true;
    if (this.cli) {
      // showAsciify + showBanner sont désormais émis en TÊTE de `start()`.
      // On garde ici seulement la résolution debug/env/processTitle qui
      // dépend de l'instance CLI rattachée au kernel.
      this.debug = Boolean(this.cli?.commander?.opts().debug) || false;
      this.setEnv(this.cli.environment);
      this.cli.setProcessTitle(this.projectName.toLowerCase());
    }
    this.setNodeEnv(this.environment);
    // Clusters
    this.initCluster();
    // Overrides `Module-<name>` APRÈS l'enregistrement de tous les modules, AVANT
    // la validation Zod (`onKernelRegister`) → l'override est pris en compte
    // (fix dette d'ordering config, cf applyModuleConfigOverrides + Module.setEvents).
    this.applyModuleConfigOverrides();
    return this.fireLifecycle("onRegister", this)
      .then(() => {
        this.registered = true;
        if (this.setCommandComplete(Events.onRegister)) {
          return this.terminate(0);
        }
        return this.boot().catch((e) => {
          throw e;
        });
      })
      .catch((e) => {
        throw e;
      });
  }

  // fix workaround commander twice call options
  private fixCommanderCli(version = true, debug = false): void {
    if (this.cli && this.cli.commander && this.cli.commander?.options.length) {
      // fix workaround commander twice call options
      if (version) {
        const optionVersionExists = this.cli?.commander?.options.some(
          (opt) => opt.short === "-v" || opt.long === "--version",
        );
        if (optionVersionExists) {
          const index = this.cli.commander.options.findIndex((value) => {
            if (value.flags === "-v, --version") {
              return value;
            }
          });
          if (index >= 0) {
            // @ts-ignore
            this.cli.commander?.options.splice(index, 1);
          }
        }
      }
      if (debug) {
        const optionDebugExists = this.cli?.commander?.options.some(
          (opt) => opt.short === "-d" || opt.long === "--debug",
        );
        if (optionDebugExists) {
          const index = this.cli.commander.options.findIndex((value) => {
            if (value.flags === "-d, --debug") {
              return value;
            }
          });
          if (index >= 0) {
            // @ts-ignore
            this.cli.commander?.options.splice(index, 1);
          }
        }
      }
    }
  }

  /**
   * Phase boot — fire `"onPreBoot"` puis `"onBoot"`. Les services kernel (router, certificats,
   * sessions, http-kernel) sont créés ici via les décorateurs `@services`.
   *
   * @returns `this` ou chaîne sur `onReady()`.
   */
  async boot(): Promise<this> {
    // GARDÉ (Phase 3) — c'est ICI que bootent les @services + les hooks
    // onKernelBoot (ex. realtime/redis) : le cas vécu « backplane qui pend gèle
    // le boot » est borné par le timeout par-listener de fireLifecycle.
    await this.fireLifecycle("onPreBoot", this);
    if (this.setCommandComplete(Events.onPreBoot)) {
      return this.terminate(0);
    }
    //return;
    return this.fireLifecycle("onBoot", this)
      .then(() => {
        this.booted = true;
        if (this.setCommandComplete(Events.onBoot)) {
          return this.terminate(0);
        }
        return this.onReady().catch((e) => {
          throw e;
        });
      })
      .catch((e) => {
        throw e;
      });
  }

  /**
   * Phase ready — fire `"onReady"`, démarre les serveurs HTTP/WS via `initServers()`, log
   * memoryUsage, puis fire `"onPostReady"`. C'est ici que les Server Listen apparaissent.
   *
   * Si `command.name === "production"` ET pas PM2 → exécute `command.action()` (mode legacy
   * daemonisation).
   *
   * @returns `this` après tout le pipeline post-ready.
   */
  async onReady(): Promise<this> {
    return this.fireLifecycle("onReady", this)
      .then(async () => {
        this.ready = true;
        if (this.setCommandComplete(Events.onReady)) {
          return this.terminate(0);
        }
        // Mode production : daemonisation PM2 (LEGACY) uniquement avec `--daemon`
        // (le défaut). `--no-daemon` → boot foreground in-process : on tombe dans
        // initServers() sans jamais solliciter PM2. C'est la cible cloud-native
        // (1 process Node = 1 pod/container, supervision déléguée à l'orchestrateur)
        // et le prérequis de la CI d'intégration. Cf project_pm2_deprecation (P16.1).
        const prodOpts = this.commandArgs[0] as
          | { daemon?: boolean }
          | undefined;
        const noDaemon =
          typeof prodOpts === "object" &&
          prodOpts !== null &&
          prodOpts.daemon === false;
        if (
          this.command?.name === "production" &&
          process.env.MODE_START !== "PM2" &&
          !noDaemon
        ) {
          return this.command.action(...this.commandArgs).then(() => {
            return this;
          });
        }
        return this.initServers().then(async (servers) => {
          if (global && global.gc) {
            this.memoryUsage("MEMORY POST READY ");
            setTimeout(() => {
              if (global && global.gc) global.gc();
              this.memoryUsage("EXPOSE GARBADGE COLLECTOR ON START");
            }, 20000);
          } else {
            this.memoryUsage("MEMORY POST READY ");
          }
          return this.fireLifecycle("onPostReady", this)
            .then(() => {
              this.postReady = true;
              servers.map((server) => {
                server.showBanner();
              });
              if (this.setCommandComplete(Events.onPostReady)) {
                this.log(`Live cycle terminate`, "DEBUG");
                return this;
              } else {
                return this;
              }
            })
            .catch((e) => {
              throw e;
            });
        });
      })
      .catch((e) => {
        throw e;
      });
  }

  /**
   * Démarre les serveurs HTTP/HTTPS/HTTP2/WS/WSS via le `HttpKernel` (@nodefony/http).
   *
   * Si le HttpKernel n'est pas dans le container (mode CONSOLE pur) → retourne tableau vide.
   * Sinon → délègue à `httpKernel.initServers()`, fire `"onServersReady"` après succès.
   *
   * @returns array d'instances de serveurs démarrés (ou `[]`).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async initServers(): Promise<any[]> {
    const httpKernel = this.get<HttpKernel>("HttpKernel");
    if (httpKernel)
      return await httpKernel
        .initServers()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((servers: any[]) => {
          this.fireAsync("onServersReady").catch((e) => {
            throw e;
          });
          return servers;
        })
        .catch((e: Error) => {
          //this.log(e, "CRITIC");
          throw e;
        });
    return [];
  }

  override clean() {
    this.removeAllListeners();
    this.modules = {};
  }

  setCommand(command: Command): void {
    this.command = command;
  }

  setDomain(): string {
    if (this.options.domain == "selectAuto") {
      return this.getFirstExternalInterface()?.address || "localhost";
    } else {
      return this.options.domain || "localhost";
    }
  }

  readConfig(config?: TypeKernelOptions): TypeKernelOptions {
    if (!config) {
      return this.options;
    }
    return extend(this.options, config);
  }

  async addService(
    service: ServiceConstructor,
    module: Module,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    return module.addService(service, module, ...args);
  }

  /**
   * Instancie un service au niveau kernel (vs niveau module via `Module.addService`).
   *
   * Utilisé pour les services partagés essentiels au boot (Rollup, Pm2, HttpKernel).
   * Stocke directement dans le container kernel.
   *
   * @param ctor - constructeur du service (typiquement décoré `@injectable`).
   * @param args - args additionnels après les `@inject` resolved.
   * @returns instance du service prête à l'usage.
   */
  async addKernelService(
    service: ServiceConstructor,
    ...args: any[]
  ): Promise<Service | null> {
    const inst: Service = Injector.instantiate(service, this, ...args);
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
      // Service kernel = critique (true) : un `initialize` figé/échoué ne gèle
      // plus le boot — borné par timeout, fatal en prod, fail-soft en dev.
      const init = serviceInit.initialize.bind(serviceInit);
      await this.guardInitialize(() => init(this), inst.name, true);
    }
    this.set<Service>(inst.name, inst);
    return this.get<Service>(inst.name);
  }

  async loadService(
    service: string,
    module: Module | null = this.app,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    if (!module) {
      throw new Error(`Applcation not ready`);
    }
    const res = await import(service);
    return this.addService(res.default, module, ...args);
  }

  async loadModule(
    moduleName: string,
    build: boolean = false,
  ): Promise<Module> {
    const moduleClass = await import(moduleName);
    const module = await this.addModule(moduleClass.default);
    if (build) {
      await module.build();
    }
    return module;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /**
   * Instancie un module et l'enregistre dans `kernel.modules[name]`. Appelle `initialize(this)`
   * sur le module si défini (équivalent constructeur async).
   *
   * @param Mod - constructeur du module (extends `Module`).
   * @param args - arguments additionnels (après `kernel, path, options` par défaut).
   * @returns instance du module enregistrée.
   */
  async addModule(Mod: ModuleConstructor, ...args: any[]): Promise<Module> {
    const mod = new Mod(this, ...args);
    this.modules[mod.name] = mod;
    if (this.pendingModuleAddLogs) {
      this.pendingModuleAddLogs.push(mod.name);
    } else {
      this.log(`MODULE ADD : ${mod.name}`, "INFO");
    }
    if (mod.initialize) {
      this.log(`MODULE INITIALIZE : ${mod.name}`, "DEBUG");
      // Garde de boot : timeout + politique selon la criticité du module.
      const init = mod.initialize.bind(mod);
      await this.guardInitialize(
        () => init(this),
        mod.name,
        (mod.constructor as typeof Module).critical,
      );
      //await this.fireAsync("onInitialize", mod);
    }

    return mod as Module;
  }

  getModule(name: string): Module {
    return this.modules[name];
  }
  getModules(): Record<string, Module> {
    return this.modules;
  }

  /**
   * Applique les overrides de config inter-modules (clés `Module-<name>` /
   * `module-<name>` dans les options d'un module — typiquement l'app qui
   * reconfigure un autre module) en itérant TOUS les modules enregistrés.
   *
   * Appelé par {@link preRegister} ENTRE `onPreRegister` (tous les modules sont
   * alors enregistrés via `@modules`/`loadApp`) et `onRegister` (où les modules
   * valident + gèlent leur config Zod dans `onKernelRegister`). Corrige la dette
   * d'ordering : l'override était auparavant posé à `onPreBoot` (après la
   * validation) → silencieusement ignoré par tout module qui fige sa config tôt
   * (redis, realtime…). Désormais il précède la validation, qui le voit.
   *
   * Ordre d'application = ordre d'insertion dans `this.modules` (app chargée en
   * premier → configure les modules avant qu'ils ne se valident). Idempotent.
   */
  private applyModuleConfigOverrides(): void {
    for (const name in this.modules) {
      this.modules[name].readOverrideModuleConfig();
    }
  }

  private async loadApp(config?: TypeKernelOptions): Promise<Module> {
    this.app = await this.loadModule(`${this.path}/dist/index.js`);
    this.app.isApp = true;
    this.options = this.readConfig(extend(this.app.options, config));
    this.initializeLog();
    this.cli?.setPackageManager(this.options.packageManager);
    this.core = await this.isCore();

    this.app.package = await this.app.getPackageJson();
    this.version = this.app?.getModuleVersion() as string;
    this.fixCommanderCli();
    this.cli?.setCommandVersion(this.version);
    await this.fireAsync("onAppLoad", this.app).catch((e) => {
      throw e;
    });
    return this.app;
  }

  isTypeScript(): boolean {
    try {
      new FileClass(`${this.path}/index.ts`);
      return true;
    } catch (e) {
      return false;
    }
  }

  async isTrunk(): Promise<trunkType> {
    if (this.isTypeScript()) {
      try {
        const module = await import(`${this.path}/dist/index.js`);
        if (this.isModule(module.default)) {
          return "typescript";
        }
        this.log(new Error(`No Nodeofny Trunk Detected`), "ERROR");
        return null;
      } catch (e) {
        this.log(e, "ERROR");
        return null;
      }
    } else {
      try {
        const module = await import(`${this.path}/index.js`);
        if (this.isModule(module.default)) {
          return "javascript";
        }
        return null;
      } catch (e) {
        //this.log(e, "ERROR");
        return null;
      }
    }
  }

  async isCore(): Promise<boolean> {
    return false;
  }

  isModule(subclass: unknown): boolean {
    return isSubclassOf(subclass, Module);
  }

  getEventName(event: number): string {
    return Object.keys(Events).find((key) => Events[key] === event) as string;
  }

  setCommandComplete(progress: number): boolean {
    const index = this.getEventName(progress);
    this.progress |= Events[index];
    return this.isCommandComplete(progress);
  }

  isCommandComplete(progress: number): boolean {
    const index = this.getEventName(progress);
    if (this.command) {
      const int: number = Events[this.command.kernelEvent];
      const res = !!(this.progress & int);
      this.log(
        `Ckeck Command event : ${this.getEventName(int)}   Progress:  ${index}  :  Complete : ${res}`,
        "DEBUG",
        `COMMAND ${this.command.name}`,
      );
      return res;
    }
    return false;
  }

  initializeLog(): void | null {
    this.syslog?.removeAllListeners();

    if (this.options.log && !this.options.log.active) {
      return;
    }
    // CLI prend la priorité absolue sur la config.
    // La config log.debug n'est utilisée qu'en mode programmatique (sans CLI).
    if (!this.cli && !this.debug && this.options.log?.debug) {
      this.debug = this.options.log.debug;
    }
    if (this.cli) {
      return this.cli.initSyslog(this.environment, this.debug);
    } else {
      return this.initSyslog(this.environment, this.debug);
    }
  }

  setCli(cli?: CliKernel | null): CliKernel | null {
    if (cli) {
      this.type = cli.type;
      this.debug = Boolean(cli?.commander?.opts().debug) || false;
      if (this.typeCluster === "worker") {
        cli.setPid();
      }
      this.set("cli", cli);
      return cli;
    }
    return null;
  }

  isConsole(): boolean {
    return this.type === "CONSOLE" || this.type === "console";
  }

  setNodeEnv(environment: EnvironmentType): void {
    if (environment) {
      switch (environment) {
        case "dev":
        case "development":
          process.env.NODE_ENV = "development";
          process.env.BABEL_ENV = "development";
          this.isDev = true;
          break;
        default:
          process.env.NODE_ENV = "production";
          process.env.BABEL_ENV = "production";
          this.isProd = true;
      }
    }
    process.env.NODE_DEBUG = this.debug ? "true" : "false";
  }

  setEnv(environment: EnvironmentType) {
    if (environment) {
      switch (environment) {
        case "dev":
        case "development":
          this.environment = "development";
          this.appEnvironment.environment = "development";
          break;
        default:
          this.environment = "production";
          this.appEnvironment.environment = "production";
      }
    }
  }

  logEnv(): string {
    if (this.cli) {
      this.type = this.cli.type;
    }
    let txt = `      \x1b ${clc.blue(this.type)} `;
    txt += ` ${clc.magenta("Cluster")} : ${this.typeCluster} `;
    txt += ` ${clc.magenta("Nodefony Environment")} : ${this.environment}  `;
    if (this.appEnvironment) {
      txt += ` ${clc.magenta("App Environment")} : ${
        this.appEnvironment.environment
      }  `;
    }
    txt += ` ${clc.magenta("Debug")} : ${this.debug}\n`;
    return txt;
  }

  clusterIsMaster(): boolean {
    return cluster.isPrimary;
  }

  /**
   * Vide le buffer des `MODULE ADD` accumulés pendant `loadApp()` et bascule
   * `addModule()` en mode log immédiat. Appelé par `initCluster()` juste
   * après l'en-tête SERVER, pour que les modules apparaissent SOUS le banner.
   */
  private flushPendingModuleAddLogs(): void {
    if (!this.pendingModuleAddLogs) return;
    const pending = this.pendingModuleAddLogs;
    this.pendingModuleAddLogs = null;
    for (const name of pending) {
      this.log(`MODULE ADD : ${name}`, "INFO");
    }
  }

  initCluster(): void {
    this.pid = process.pid;
    //this.process = process;
    if (
      this.console &&
      this.cli &&
      this.cli.commander &&
      this.cli.commander.opts().json
    ) {
      return;
    }
    if (cluster.isPrimary) {
      console.log(this.logEnv());
      this.flushPendingModuleAddLogs();
      this.fire("onCluster", "MASTER", this, process);
    } else if (cluster.isWorker) {
      console.log(this.logEnv());
      this.flushPendingModuleAddLogs();
      this.workerId = cluster.worker?.id;
      this.worker = cluster.worker;
      this.fire("onCluster", "WORKER", this, process);
      process.on("message", (msg) => {
        // Canal IPC partagé : les publications realtime (nf:rt) et les snapshots de sonde
        // agrégée (nf:probe:snap) sont consommés par leurs propres listeners (ClusterBackplane
        // / ClusterProbeClient) → ne PAS les logger ni les re-fire ici, sinon flood au rythme
        // du fan-out / de la cadence sonde. On ne relaie que les messages de contrôle (rares).
        if (
          isClusterMessage(msg) &&
          (msg.kind === CLUSTER_RT_KIND ||
            msg.kind === CLUSTER_PROBE_SNAPSHOT_KIND)
        ) {
          return;
        }
        this.log(msg, "INFO", "IPC MESSAGE");
        this.fire("onMessage", msg);
      });
    }
    // if (nodefony.warning) {
    //   this.log(nodefony.warning, "WARNING");
    // }
  }

  getOrm(): string {
    return this.options.orm;
  }

  getOrmStrategy() {
    return this.getORM()?.options.strategy;
  }

  getORM() {
    return this.get<Orm>(this.getOrm());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fire(event: KernelEventsType, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.fire(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: KernelEventsType, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emit(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emitAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fireAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  /**
   * Timeout par listener appliqué au boot (résilience Phase 3). Précédence :
   * `NODEFONY_BOOT_TIMEOUT_MS` (env, orchestrateur) > défaut par env (dev 20 s,
   * prod 60 s). Large à dessein : il borne la PENDAISON infinie (ex. file Redis
   * offline qui ne rejette jamais), pas la lenteur normale d'un hook.
   */
  private bootTimeoutMs(): number {
    const env = Number(process.env.NODEFONY_BOOT_TIMEOUT_MS);
    if (Number.isFinite(env) && env > 0) {
      return env;
    }
    return this.environment === "production" ? 60_000 : 20_000;
  }

  /**
   * Seuil d'alerte de lenteur d'un hook de boot (NOTICE, sans le tuer). Précédence :
   * `NODEFONY_BOOT_WARN_MS` (env) > défaut 5 s. `0` désactive la mesure.
   */
  private bootWarnMs(): number {
    const env = Number(process.env.NODEFONY_BOOT_WARN_MS);
    if (Number.isFinite(env) && env >= 0) {
      return env;
    }
    return 5_000;
  }

  /**
   * Politique d'échec de boot commune (lifecycle + `initialize`). Log + verdict
   * de propagation. **Fatal** = module critique (tag `critical !== false`) ET
   * `production` → on interrompt le boot (le pod crashe, l'orchestrateur le
   * redémarre — cloud-native). Sinon **fail-soft** : WARNING, le boot continue.
   *
   * @param error - erreur/timeout capturé.
   * @param owner - module propriétaire (tag), ou `undefined` (listener interne).
   * @param critical - criticité (tag) ; `undefined` → traité comme critique.
   * @param timedOut - `true` si l'échec est un dépassement de timeout.
   * @returns `true` si l'échec doit interrompre le boot.
   */
  private isBootErrorFatal(
    error: unknown,
    owner: string | undefined,
    critical: boolean | undefined,
    timedOut: boolean,
  ): boolean {
    const who = owner ?? "(anonyme)";
    const fatal = critical !== false && this.environment === "production";
    const msg = error instanceof Error ? error.message : String(error);
    const tag = timedOut ? " [timeout]" : "";
    this.log(
      `boot lifecycle: ${fatal ? "échec critique" : "échec non bloquant (fail-soft)"} ` +
        `de "${who}"${tag} — ${msg}`,
      fatal ? "ERROR" : "WARNING",
    );
    if (this.debug && error instanceof Error && error.stack) {
      this.log(error.stack, "DEBUG");
    }
    return fatal;
  }

  /**
   * Émet une phase de **lifecycle de boot** de façon GARDÉE (cf
   * `Event.emitAsyncGuarded`) : chaque hook de module est isolé par try/catch +
   * timeout ; un module qui throw ou se fige ne gèle/ne tue plus tout le boot. La
   * politique (propager vs fail-soft) est tranchée par {@link isBootErrorFatal}
   * d'après les tags `owner`/`critical` posés par `Module.setEvents()`.
   *
   * Remplace `fireAsync` **uniquement** dans la chaîne boot (`onPreRegister` →
   * `onPostReady`). Le hot path HTTP/WS garde `emitAsync` nu (aucun timer/alloc).
   *
   * @param event - phase lifecycle à émettre.
   * @param args - arguments passés aux hooks (typiquement `this`).
   * @returns le {@link IGuardedEmitResult} (results / errors / stopped).
   * @throws l'erreur d'un module critique en production (interrompt le boot).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async fireLifecycle(
    event: KernelEventsType,
    ...args: any[]
  ): Promise<IGuardedEmitResult> {
    this.log(`${colorLogEvent} ${event as string} [guarded]`, "DEBUG");
    const warnMs = this.bootWarnMs();
    let fatalError: unknown = null;
    let hasFatal = false;
    const result = await super.emitAsyncGuarded(
      event,
      {
        timeoutMs: this.bootTimeoutMs(),
        warnMs,
        onListenerError: (error: unknown, info: IGuardedListenerInfo) => {
          const { owner, critical } = readListenerTags(info.listener);
          if (this.isBootErrorFatal(error, owner, critical, info.timedOut)) {
            fatalError = error;
            hasFatal = true;
            return true; // stoppe la chaîne lifecycle (le reste ne boote pas)
          }
          return; // fail-soft : on continue les autres modules
        },
        onListenerSlow: (info: IGuardedListenerInfo) => {
          const { owner } = readListenerTags(info.listener);
          this.log(
            `boot lifecycle: hook "${owner ?? "(anonyme)"}" lent ` +
              `(${Math.round(info.durationMs)}ms ≥ ${warnMs}ms) sur ${event as string}`,
            "NOTICE",
          );
        },
      },
      ...args,
    );
    if (hasFatal) {
      throw fatalError instanceof Error
        ? fatalError
        : new Error(String(fatalError));
    }
    return result;
  }

  /**
   * Exécute un `initialize()` (module ou service kernel) sous garde de boot :
   * borné par {@link bootTimeoutMs} et soumis à {@link isBootErrorFatal}. Un
   * `initialize` qui se fige (connexion réseau qui pend) ne gèle plus le boot.
   *
   * @param run - thunk qui lance l'`initialize` (déjà lié à son instance).
   * @param owner - nom du module/service (pour le log).
   * @param critical - criticité (module → `Module.critical` ; service kernel → `true`).
   */
  private async guardInitialize(
    run: () => Promise<unknown>,
    owner: string,
    critical: boolean,
  ): Promise<void> {
    try {
      await withTimeout(
        Promise.resolve(run()),
        this.bootTimeoutMs(),
        `initialize ${owner}`,
      );
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      if (this.isBootErrorFatal(error, owner, critical, timedOut)) {
        throw error;
      }
    }
  }

  checkPath(myPath: string): string | null {
    if (!myPath) {
      return null;
    }
    const abs = path.isAbsolute(myPath);
    if (abs) {
      return myPath;
    }
    return path.resolve(this.path, myPath);
  }

  sendMessage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handle?: any,
    options?: { swallowErrors?: boolean; keepOpen?: boolean | undefined },
    callback?: ((error: Error | null) => void) | undefined,
  ): boolean {
    if (process.send) {
      return process.send(
        {
          type: "process:msg",
          data: message,
        },
        handle,
        options,
        callback,
      );
    }
    throw new Error(`process.send not found `);
  }

  memoryUsage(message?: string, severity: Severity = "DEBUG") {
    const { memory } = this.stats();
    for (const ele in memory) {
      switch (ele) {
        case "rss":
          this.log(
            `${message || ele} ( Resident Set Size ) PID ( ${
              this.pid
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`,
          );
          break;
        case "heapTotal":
          this.log(
            `${message || ele} ( Total Size of the Heap ) PID ( ${
              this.pid
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`,
          );
          break;
        case "heapUsed":
          this.log(
            `${message || ele} ( Heap actually Used ) PID ( ${
              this.pid
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`,
          );
          break;
        case "external":
          this.log(
            `${message || ele} PID ( ${
              this.pid
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`,
          );
          break;
      }
    }
  }

  stats(): Stats {
    const stat: Stats = {
      memory: process.memoryUsage(),
    };
    return stat;
  }

  interfacesFilter(filters?: FilterInterface): NetworkInterface {
    if (filters) {
      let condition = (ele: boolean, ele2: boolean): boolean => {
        return ele && ele2;
      };
      if (filters.condition && filters.condition === "||") {
        condition = (ele: boolean, ele2: boolean): boolean => {
          return ele || ele2;
        };
      }
      const interfaces: NetworkInterface = {};
      for (const myinterface in this.interfaces) {
        interfaces[myinterface] = [];
        for (const infos of this.interfaces[myinterface]) {
          let matchType = false;
          let matchFamily = false;
          for (const filter in filters) {
            switch (filter) {
              case "type":
                if (filters["type"] === "external") {
                  if (!infos.internal) {
                    matchType = true;
                  }
                }
                if (filters["type"] === "local") {
                  if (infos.internal) {
                    matchType = true;
                  }
                }
                break;
              case "family":
                if (filters["family"] === infos.family) {
                  matchFamily = true;
                }
                break;
            }
          }
          if (condition(matchType, matchFamily))
            interfaces[myinterface].push(infos);
        }
      }
      return interfaces;
    }
    return this.interfaces;
  }

  getNetworkInterfaces(): { [name: string]: os.NetworkInterfaceInfo[] } {
    const nets = os.networkInterfaces();
    const devices: { [name: string]: os.NetworkInterfaceInfo[] } = {};
    Object.entries(nets).forEach(([name, ni]) => {
      if (!ni) return;
      devices[name] = ni;
    });
    return devices;
  }

  getNetwork() {
    return {
      external: this.interfacesFilter({ type: "external" }),
      local: this.interfacesFilter({ type: "local", condition: "==" }),
      ipv4: this.interfacesFilter({ family: "IPv4" }),
      ipv6: this.interfacesFilter({ family: "IPv6" }),
      interfaces: this.interfaces,
    };
  }

  getFirstExternalInterface(
    family?: FamilyType,
  ): os.NetworkInterfaceInfo | undefined {
    const filter: FilterInterface = {
      type: "external",
      family: family || "IPv4",
      condition: "&&",
    };
    const res: NetworkInterface = this.interfacesFilter(filter);
    const ele: os.NetworkInterfaceInfo[] = [];
    for (const myinterface in res) {
      for (const info of res[myinterface]) {
        ele.push(info);
      }
    }
    return ele[0] || undefined;
  }

  // async getProjectName(): Promise<string> {
  //   const res = await this.loadJson("package.json");
  //   return res.name as string;
  // }

  // async getProjectVersion(): Promise<string> {
  //   const res = await this.loadJson("package.json");
  //   return res.version as string;
  // }

  /**
   * Shutdown propre du kernel — fire `"onTerminate"` puis `CliKernel.quit(code)` sur next tick.
   *
   * @param code - exit code Unix (0 = succès, 1+ = erreur).
   * @returns Promise résolue avec `this` (ou rejected si `quit()` throw).
   */
  async terminate(code?: number): Promise<this> {
    if (code === undefined) {
      code = 0;
    }
    this.log(`terminate : ${code}`);
    try {
      //console.log(this.notificationsCenter?._events);
      await this.fireAsync("onTerminate", this, code);
    } catch (e) {
      this.log(e, "ERROR");
      code = 1;
    }
    return new Promise((resolve, reject) => {
      process.nextTick(() => {
        this.log(
          `NODEFONY Kernel Life Cycle Terminate CODE : ${code}`,
          "DEBUG",
        );
        try {
          CliKernel.quit(code as number);
          return resolve(this);
        } catch (e) {
          this.log(e, "ERROR");
          return reject(e as Error);
        }
      });
    });
  }
}

export default Kernel;

export { Events };
