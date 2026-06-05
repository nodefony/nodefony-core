/* eslint-disable @typescript-eslint/ban-ts-comment */
import { logColor, setLogColor, resolveColorEnabled } from "../syslog/logColor";
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
import Syslog, { NULL_LOG_SINK } from "../syslog/Syslog";
import { FileSink } from "../syslog/sinks/FileSink";
import {
  registerLogDriver,
  setActiveLogDriver,
  getLogDriverFactory,
  listLogDriverFactories,
  type ILogDriverContext,
} from "../syslog/drivers/logDriverRegistry";
import { registerBuiltinLogDrivers } from "../syslog/drivers/builtinLogDrivers";
import type { ITransport } from "../types/ITransport";
import { DebugType, EnvironmentType } from "../types/globals";
import CliKernel from "./CliKernel";
import Module from "./Module";
//import Fetch from "../service/fetchService";
import { HttpKernel } from "@nodefony/http";
import Injector from "./injector/injector";
import Entity from "./orm/Entity";
import {
  isClusterMessage,
  CLUSTER_RT_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
} from "../service/cluster/clusterMessage";
import type { IKernel } from "../types/IKernel";
import type {
  IModuleManifest,
  IModuleManifestEntry,
} from "../types/IModuleManifest";
import { isConfigDescriptor } from "../config/defineConfig";
import { defaultAppConfig } from "../config/defaults";
import type { ConfigContext } from "../config/types";
import nodefonyError from "../Error";
import { SysExit } from "../cli/sysexits";
import type { IGuardedEmitResult, IGuardedListenerInfo } from "../Event";
import { withTimeout, TimeoutError } from "../runtime/withTimeout";
import { readListenerTags } from "./lifecycleTags";

// Tag d'event — couleur gatée au boot (gratuit hors TTY ; logs DEBUG only).
const colorLogEvent = (): string => logColor.cyanBgBlue("EVENT KERNEL");

export interface TypeKernelOptions extends DefaultOptionsService {
  node_start?: NodefonyStartType;
  /**
   * Manifeste déclaratif des modules de l'app (liste ordonnée, gatable par
   * `policy`/`when`/environnement). Lu et orchestré par le Kernel à
   * `onPreRegister`. Remplace l'usage du décorateur `@modules` côté app.
   * Cf `project_module_loading_architecture` (mémoire IA).
   */
  modules?: IModuleManifest;
  log?: {
    active?: boolean;
    /**
     * Répertoire des fichiers de log (relatif au cwd, défaut `"logs"`) — où sont
     * écrits le sink texte `nodefony-<pid>.log` (LB.W) ET le JSONL queryable
     * `nodefony-<pid>.jsonl` (LB.2/5). Source UNIQUE : le Kernel y écrit, et le
     * viewer de fichiers Studio (`/nodefony/syslog/api/files`) y lit → cohérent.
     * Remplace l'ancien pointage sur `tmpDir`. Un chemin absolu dans `file.path`/
     * `queryFile.path` reste prioritaire (override par fichier).
     */
    dir?: string;
    debug?: DebugType;
    /** Coalescing des writes stdout par tick : "auto" (hors TTY) | true | false. */
    buffered?: boolean | "auto";
    /** Driver de sink (LB.W) : "stdout" (défaut) | "file" (fd async/worker) | "null" (bench). */
    driver?: "stdout" | "file" | "null";
    /** Options du driver "file" (chemin du log ; défaut logs/nodefony-<pid>.log ; sync=write direct). */
    file?: { path?: string; sync?: boolean };
    /**
     * Driver du **Log Backplane** (axe DESTINATION queryable, LB.0+) — où l'on
     * RELIT les logs : "memory" (défaut, ring buffer ; dev) | "file" (LB.2, JSONL
     * du worker courant) | "cluster-file" (LB.5, agrège les `nodefony-*.jsonl` de
     * TOUS les workers = vue cluster) | "elastic"/"loki" (LB.4, si enregistré).
     * Orthogonal à `driver` (sink write texte) et au bus temps réel `syslog:stream`.
     * En prod = figé ici/env (12-factor) ; le switch à la volée est une action de
     * contrôle dev-only.
     */
    queryDriver?: string;
    /**
     * Taille du **ring buffer** de logs en mémoire (nombre de Pdu conservés pour
     * la relecture par le driver `memory` + le snapshot Studio). Défaut **100**
     * (prod-safe) ; **2000 en développement** si non précisé → assez profond pour
     * tracer une requête complète (appel DB inclus) sans que le bruit de fond ne
     * l'évince. Borné en RAM : c'est une fenêtre glissante, pas une persistance.
     */
    maxStack?: number;
    /**
     * Options du driver de relecture `file` (LB.2) / `cluster-file` (LB.5) — actif
     * UNIQUEMENT si `queryDriver` vaut l'un des deux. `path` = fichier JSONL ÉCRIT
     * par ce worker (défaut `logs/nodefony-<pid>.jsonl`) ; `maxScanBytes` = plafond
     * d'octets relus depuis la FIN à chaque query (anti-OOM, défaut 8 MiB, appliqué
     * PAR fichier en mode cluster). Quand actif, un transport file `format:"json"`
     * est branché pour ÉCRIRE ce JSONL (cohérence write↔read). En `cluster-file`,
     * la lecture agrège le DOSSIER de `path` (tous les `nodefony-*.jsonl`).
     */
    queryFile?: { path?: string; maxScanBytes?: number };
    /**
     * Options du driver de relecture `loki` (LB.4) — actif UNIQUEMENT si
     * `queryDriver === "loki"`. `url` = base Loki (ex. `http://127.0.0.1:3100`).
     * Quand actif, un {@link LokiTransport} batché est branché pour POUSSER les logs
     * (`/loki/api/v1/push`) et le driver les RELIT en LogQL (write↔read cohérents).
     * Opt-in strict (jamais en dev « au cas où ») ; figé par config/env en prod.
     */
    loki?: {
      url: string;
      labels?: Record<string, string>;
      tenantId?: string;
      batchSize?: number;
      flushIntervalMs?: number;
      maxQueue?: number;
      maxScanLines?: number;
    };
    /**
     * Options du driver de relecture `opensearch` (LB.4) — actif UNIQUEMENT si
     * `queryDriver === "opensearch"`. `url` = base OpenSearch (ex. `http://127.0.0.1:9200`),
     * `index` (défaut `nodefony-logs`), `username`/`password` (auth basic prod). Write
     * via `/_bulk`, read via `/_search`. Opt-in strict ; figé par config/env en prod.
     */
    opensearch?: {
      url: string;
      index?: string;
      username?: string;
      password?: string;
      batchSize?: number;
      flushIntervalMs?: number;
      maxQueue?: number;
      maxHits?: number;
    };
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
type NodefonyStartType = "CONSOLE" | "NODEFONY" | "NODEFONY_CONSOLE";

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

/**
 * Durée de vie d'un run : `"oneshot"` = fait sa tâche puis le process sort (build,
 * install, help) ; `"longrunning"` = reste vivant jusqu'à un signal (serveur, daemon,
 * REPL) — maintenu soit par un socket en écoute, soit par un park explicite.
 */
export type RunLifetime = "oneshot" | "longrunning";

/**
 * Profil d'exécution d'un run — remplace l'ancien binaire `KernelType` (SERVER/CONSOLE)
 * qui écrasait 3 axes orthogonaux en un seul drapeau. Déclaré par chaque commande.
 *
 * - `servers` — monte des serveurs réseau HTTP/WS.
 * - `lifetime` — voir {@link RunLifetime}.
 * - `interactive` — a besoin d'un TTY (REPL, menu). Consommé au câblage REPL (différé).
 *
 * Note : le démarrage réel des serveurs reste piloté par `kernelEvent` + la présence du
 * `HttpKernel`. En revanche `lifetime` est désormais EFFECTIF : à la fin d'un run sans
 * serveur, le Kernel parke (daemon) ou terminate (one-shot) — cf {@link Kernel.finishOrPark}
 * et {@link Kernel.park} (source unique du park, ex-`new Promise(()=>{})` inline).
 */
export interface IRunProfile {
  servers: boolean;
  lifetime: RunLifetime;
  interactive: boolean;
}

/** Profil par défaut — équivaut à l'ancien `type = "CONSOLE"` (one-shot, sans serveur). */
export const CONSOLE_RUN_PROFILE: Readonly<IRunProfile> = Object.freeze({
  servers: false,
  lifetime: "oneshot" as RunLifetime,
  interactive: false,
});

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

/**
 * Interface-marqueur du **hook de cycle de vie async de boot** (pattern NestJS
 * `OnModuleInit`). Un service qui implémente `init` est initialisé une fois
 * au démarrage — par {@link Kernel.addKernelService} (service kernel) ou
 * {@link Module.addService} (service de module) — sous garde de boot
 * ({@link Kernel.guardInitialize} : timeout + politique de criticité).
 *
 * C'est LE hook standard : ne pas réinventer `boot()`/`connect()`/`onConnect()`.
 * Hook **optionnel** (pas de méthode no-op forcée sur {@link Service} : éviterait
 * une microtask par service sans init — règle perf). Distinct du hook
 * **per-request** des controllers (`ControllerWithInitialize.initialize`, hot
 * path, non gardé) : les deux noms restent volontairement disjoints (`init` =
 * boot une fois ; `initialize` = par requête) — pas de collision sur un
 * Controller qui est aussi un Service.
 *
 * @remarks `owner` = le {@link Module} (service de module) ou le {@link Kernel}
 *   (service kernel) propriétaire. Retour `Promise<this>` — l'implémenteur renvoie
 *   son instance typée.
 */
export interface ServiceWithInit extends Service {
  init?(owner?: Module | Kernel): Promise<this>;
}

export interface ServiceConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): ServiceWithInit;
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
  // Assigné dans le constructor (pas d'initializer) pour préserver la valeur figée de
  // `console` (ci-dessous) : `isConsole()` retourne `false` tant que `runProfile` est
  // indéfini, comme l'ancien `type` undefined au moment de l'init des fields.
  runProfile!: IRunProfile;
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
  /**
   * Vrai terminal disponible ? Résolu UNE fois dans le constructor (volet
   * « environnement », cf {@link IKernel.isTTY}). Surchargeable via `NO_TTY` (test/CI).
   */
  isTTY: boolean = process.env.NO_TTY ? false : process.stdout?.isTTY === true;
  /**
   * Timer no-op ref'd gardant l'event loop vivant pendant un {@link park} `keepAlive`
   * (daemon CONSOLE sans socket). `null` tant qu'aucun park alive — lazy. Nettoyé par
   * {@link terminate}.
   */
  private parkTimer: NodeJS.Timeout | null = null;
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
  injector: Injector;
  /**
   * Transports d'ÉCRITURE montés par {@link initializeLog} (drivers du Log
   * Backplane). `initializeLog` est ré-entrant (logger précoce dans `start()`,
   * puis re-init avec la config app dans `loadApp()`) : on retire ces transports
   * AVANT d'en monter de nouveaux, sinon chaque `FileTransport` (nouvelle instance
   * → dédup `addTransport` par référence inopérante) s'accumule et chaque log est
   * écrit N× dans le JSONL. Lazy (`null` tant qu'aucun transport monté).
   */
  private _mountedLogTransports: ITransport[] | null = null;
  isDev: boolean = false;
  isProd: boolean = true;
  /**
   * En dev, `BootReporter` (checklist animée) prend la main sur l'en-tête de boot
   * (splash + banner `SERVER`). Quand `true`, `initCluster()` ne ré-imprime PAS le
   * banner `logEnv()` (le reporter le place lui-même, dans le bon ordre). Dev-only,
   * boot-only — 0 impact runtime/requête.
   */
  reporterOwnsHeader: boolean = false;
  // Buffer FIFO des `MODULE ADD` émis avant l'en-tête `SERVER` (logEnv) —
  // flushé par `initCluster()` après le banner. Tant qu'il n'est pas null
  // les logs sont différés ; passé à `null`, addModule() log immédiatement.
  private pendingModuleAddLogs: string[] | null = [];
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
    // Trace boot-count diagnostique : 1 ligne par `new Kernel()`. Gardée par une env
    // absente en prod → 0 coût (cohérent avec NODEFONY_BOOT_TIMEOUT_MS/WARN_MS). Sert au
    // filet d'intégration CLI à prouver l'invariant « 1 seul Kernel par process »
    // (avant refacto registry : prod/cluster en créaient 2). Boot-only, hors hot path.
    if (process.env.NODEFONY_KERNEL_TRACE_FILE) {
      try {
        fs.appendFileSync(
          process.env.NODEFONY_KERNEL_TRACE_FILE,
          `${process.pid}:${environment}\n`,
        );
      } catch {
        /* diagnostic best-effort — ne jamais faire échouer le boot */
      }
    }
    // Limite de listeners alignée sur la config (`events.nbListeners`, défaut 60) :
    // chaque module/service attache ≥1 listener lifecycle (onBoot/onTerminate/…),
    // un `30` en dur sautait dès ~15 modules (MaxListenersExceededWarning au boot).
    this.setMaxListeners(mergedOptions.events?.nbListeners ?? 60);
    Nodefony.setKernel(this);
    this.kernel = this;
    this.set("kernel", this);
    this.runProfile = { ...CONSOLE_RUN_PROFILE };
    this.cli = this.setCli(cli);
    this.interfaces = this.getNetworkInterfaces();
    this.injector = new Injector(this);
    this.set("injector", this.injector);
    this.fire("onInit", this);
  }

  /**
   * Point d'entrée du boot. Fire `"onPreStart"` puis `"onStart"`, charge l'application
   * (`loadApp()`), instancie services kernel (Rollup), puis enchaîne sur
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

    // Splash ASCII (banner figlet + version) — affiché en TÊTE du boot, AVANT
    // `SERVICE ADD`, `MODULE ADD` et les events kernel.
    //
    // Gaté pour rester un confort de DEV interactif uniquement :
    // - **PRODUCTION / CLUSTER** → JAMAIS de splash. Cloud-native = logs structurés
    //   (collecteur JSON) : un art ASCII multi-ligne est du bruit ; en cluster, N workers
    //   produiraient N splash. L'info de boot vit dans les logs (`MODULE ADD`, `Server Listen`).
    // - **DEV** → un SEUL splash, dans le process qui boote réellement le serveur (l'enfant
    //   du DevSupervisor, `NODEFONY_DEV_CHILD=1`), PAS le superviseur parent CONSOLE
    //   (sinon double splash : parent + enfant — cf 2 ASCII art observés).
    const devSplash =
      this.environment === "development" &&
      process.env.NODEFONY_DEV_CHILD === "1";
    if (this.cli && devSplash) {
      await this.cli.showAsciify(this.projectName).catch((e) => {
        this.log(e, "WARNING");
      });
      // Header consolidé (version + env + meta) juste SOUS l'ASCII, AVANT tout log de
      // boot → ordre stable dans tous les modes dev (animé / debug / non-TTY). Couleurs
      // gatées TTY par logColor. initCluster() ne ré-imprime PAS logEnv (reporterOwnsHeader),
      // ni la ligne « Version … ». Le BootReporter ne pose que la checklist (✓/spinner).
      this.printDevHeader();
      this.reporterOwnsHeader = true;
    }

    // `tmp/` est gitignored (jamais commité) → absent sur un checkout frais (CI),
    // un container/pod neuf ou un premier boot. `FileClass` fait un `lstatSync()`
    // synchrone qui throw ENOENT si le dossier manque → `start()` rejette à
    // progress=1 (terminate:0, jamais de "Server Listen"). On garantit donc le
    // dossier ici (idempotent, un seul syscall au boot — hors hot path).
    const tmpPath = path.resolve(process.cwd(), "tmp");
    fs.mkdirSync(tmpPath, { recursive: true });
    this.tmpDir = new FileClass(tmpPath);

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
        // Erreur de config déjà présentée (bootConfigError) → ne pas re-logger une
        // stack brute. Toute autre erreur de boot → log CRITIC complet.
        if (!(e as { presented?: boolean }).presented) {
          this.log(e, "CRITIC");
        }
        throw e;
      });
      this.domain = this.setDomain();
      if (this.app) {
        this.projectName = this.app.getModuleName() as string;
      }
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
          if (this.cli) this.runProfile = this.cli.runProfile;
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
   * Phase pré-registration — fire `"onPreRegister"` puis `"onRegister"`. Le manifeste
   * `config.modules` est consommé ici (chargement via {@link loadModulesFromManifest}).
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
            // `commander.options` est typé `readonly Option[]` → cast vers un
            // tableau mutable pour le splice (commander n'expose pas d'API de
            // suppression publique). commander non-null garanti par le guard l.608.
            (this.cli.commander.options as unknown as unknown[]).splice(
              index,
              1,
            );
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
            // `commander.options` est typé `readonly Option[]` → cast vers un
            // tableau mutable pour le splice (commander n'expose pas d'API de
            // suppression publique). commander non-null garanti par le guard l.608.
            (this.cli.commander.options as unknown as unknown[]).splice(
              index,
              1,
            );
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
   * @returns `this` après tout le pipeline post-ready.
   */
  async onReady(): Promise<this> {
    return this.fireLifecycle("onReady", this)
      .then(async () => {
        this.ready = true;
        if (this.setCommandComplete(Events.onReady)) {
          // Phase cible atteinte sans serveur : terminate (one-shot) OU park (daemon
          // long-running). C'est la phase de readiness d'un daemon CONSOLE.
          return this.finishOrPark(0);
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

  /**
   * Parke le flow : retourne une Promise qui ne se résout JAMAIS (met en pause le
   * pipeline async appelant). **Source UNIQUE** du « rester vivant jusqu'à un signal »
   * — remplace les `new Promise(() => {})` inline disséminés (DevSupervisor parent,
   * master cluster, daemon).
   *
   * ⚠️ Une Promise pending ne garde PAS Node en vie (le process sort dès l'event loop
   * vide). Pour un daemon CONSOLE qui n'a aucun socket/handle → `keepAlive: true` ref un
   * timer no-op (réveil ~tous les 12 j, coût nul). Les superviseurs ont DÉJÀ leurs propres
   * handles (watchers fs du DevSupervisor / canaux IPC workers + timers de sonde du
   * master) → `keepAlive` défaut `false` : aucun handle en trop qui empêcherait leur
   * sortie naturelle au shutdown. Le timer alive est nettoyé par {@link terminate}.
   *
   * Signal handling : déjà fourni globalement par `Cli.handleSignals` → `terminate()`.
   *
   * @param opts.keepAlive - ref un timer no-op pour garder l'event loop vivant.
   * @returns Promise jamais résolue.
   */
  park(opts: { keepAlive?: boolean } = {}): Promise<never> {
    if (opts.keepAlive && this.parkTimer === null) {
      this.parkTimer = setInterval(() => {}, 1 << 30);
    }
    return new Promise<never>(() => {});
  }

  /**
   * Fin de cycle d'une commande ayant atteint sa phase cible : `terminate(code)` pour un
   * run one-shot (build, install, batch, help), MAIS **park** pour un run long-running
   * sans serveur (daemon CONSOLE : worker de queue, consumer, agent IA, cron daemon).
   *
   * C'est ICI que `lifetime` devient effectif : avant, chaque commande daemon inlinait
   * son propre park ; désormais le Kernel décide à partir de la `lifetime` DÉCLARÉE par
   * la commande (`command.lifetime`, fallback `runProfile.lifetime`) croisée avec
   * `runProfile.servers` (les serveurs gardent déjà le process vivant → jamais de park).
   *
   * @param code - exit code si run one-shot.
   * @returns Promise du terminate (one-shot) ou park (daemon, jamais résolue).
   */
  private finishOrPark(code: number): Promise<this> {
    const longrunning =
      (this.command?.lifetime ?? this.runProfile.lifetime) === "longrunning";
    if (longrunning && !this.runProfile.servers) {
      this.log(
        "CONSOLE long-running — park (no server, until signal)",
        "DEBUG",
      );
      return this.park({ keepAlive: true });
    }
    return this.terminate(code);
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
   * Utilisé pour les services partagés essentiels au boot (Rollup, HttpKernel).
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
    const serviceInit: ServiceWithInit = inst;
    // Service kernel = critique (true) : un `init` figé/échoué ne gèle
    // plus le boot — borné par timeout, fatal en prod, fail-soft en dev.
    await this.guardServiceInitialize(serviceInit, this, true);
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

  async loadModule(moduleName: string): Promise<Module> {
    const moduleClass = await import(moduleName);
    return await this.addModule(moduleClass.default);
  }

  /**
   * Résout la liste ORDONNÉE des entrées de modules à charger depuis le manifeste
   * `config.modules`, AVEC leur config colocalisée (`use(name, config)`). L'ordre
   * du tableau est conservé (= priorité de chargement) ; `policy`/`when` ne font
   * que FILTRER, jamais réordonner.
   *
   * - `policy:"dev"` → ignoré en production (gain mémoire = non-chargement ; en
   *   ESM un module importé n'est jamais déchargé).
   * - `when(config)` faux → ignoré (sa config colocalisée l'est aussi → pas de
   *   warning « module absent » sur un module volontairement gaté).
   * - string nue → policy `optional`, toujours chargée, sans config.
   *
   * @returns entrées `{ name, config? }` à charger, dans l'ordre.
   */
  private resolveModuleEntries(): {
    name: string;
    config?: Record<string, unknown>;
  }[] {
    const manifest = this.options.modules;
    if (!Array.isArray(manifest)) {
      return [];
    }
    // Gating `policy:"dev"` sur le MODE RUNTIME (NODE_ENV-aware) — un conteneur
    // staging (NODE_ENV=production) droppe bien les modules dev. Le gating fin par
    // environnement de déploiement passe par `when(config)` (axe appEnvironment).
    const isProd =
      this.resolveRuntimeEnv(this.cli?.environment) === "production";
    const result: { name: string; config?: Record<string, unknown> }[] = [];
    for (const item of manifest) {
      const entry: IModuleManifestEntry =
        typeof item === "string" ? { name: item } : item;
      if (!entry?.name) {
        continue;
      }
      if (entry.policy === "dev" && isProd) {
        continue;
      }
      if (typeof entry.when === "function" && !entry.when(this.options)) {
        continue;
      }
      result.push({ name: entry.name, config: entry.config });
    }
    return result;
  }

  /**
   * Charge en série les modules résolus par {@link resolveModuleEntries} via
   * `loadModule` (import dynamique → lazy : un module hors liste n'est jamais
   * importé), puis applique la config colocalisée (`use(name, config)`) de
   * chaque entrée. Branché à `onPreRegister` par {@link loadApp} si un manifeste
   * `config.modules` est présent. Seul orchestrateur du chargement de modules.
   */
  private async loadModulesFromManifest(): Promise<void> {
    for (const entry of this.resolveModuleEntries()) {
      const mod = await this.loadModule(entry.name);
      if (entry.config) {
        // Config colocalisée (`use(name, config)`) : deep-merge sous la config
        // DEFAULT du module fraîchement chargé, AVANT sa validation Zod
        // (`onKernelRegister`). Même sémantique de merge que les overrides legacy
        // `module-<nom>` (`extend(true, {}, …)`) — 1 seule recette de merge.
        mod.options = extend(true, {}, mod.options, entry.config);
        this.log(`MODULE CONFIG (use) : ${entry.name}`, "DEBUG");
      }
    }
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
    if (mod.init) {
      this.log(`MODULE INITIALIZE : ${mod.name}`, "DEBUG");
      // Garde de boot : timeout + politique selon la criticité du module.
      const init = mod.init.bind(mod);
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

  /**
   * Valide la config de l'app au boot via le schéma fourni par l'app, si présent.
   *
   * Convention générique (le core ne dépend PAS de Zod) : si l'entrée de l'app
   * (`dist/index.js`) exporte une fonction `validateConfig`, le Kernel l'exécute sur
   * la config résolue de l'app (`app.options`) — l'app porte le schéma + la dépendance
   * Zod. Absent → étape sautée (rétro-compatible avec une app sans schéma). L'import
   * est déjà résolu par `loadModule` (cache ESM) → coût négligeable, hors hot path.
   *
   * @throws si le validateur de l'app rejette la config (message agrégé).
   */
  private async validateAppConfig(): Promise<void> {
    const mod = (await import(`${this.path}/dist/index.js`)) as {
      validateConfig?: (options: unknown) => void;
    };
    mod.validateConfig?.(this.app?.options);
  }

  /**
   * Construit le contexte d'environnement (`ctx`) passé au descripteur
   * {@link defineConfig} d'une app moderne. `runtimeEnv` = `NODE_ENV` normalisé
   * (`dev`→`development`, conserve `test`/`production`) — granularité que le ctx
   * expose (`isTest`), DISTINCTE du collapse dev/prod de {@link resolveRuntimeEnv}
   * (gating moteur : un staging tourne « comme prod »). `appEnv` = axe déploiement
   * libre (`APP_ENV`/`NODEFONY_ENV`). `process.env` est déjà peuplé par `loadEnv`
   * (bin/nodefony) avant le boot → lecture sûre ici.
   *
   * @param env - catalogue env typé exposé par l'app (`export const env = defineEnv(…)`) ;
   *   `undefined` (app legacy / pas de catalogue) → `process.env` brut.
   * @returns contexte d'environnement pour `descriptor.resolve(ctx)`.
   */
  private buildConfigContext(env?: unknown): ConfigContext {
    const raw = process.env.NODE_ENV || this.cli?.environment || "production";
    const runtimeEnv = raw === "dev" ? "development" : raw;
    const appEnv =
      process.env.APP_ENV || process.env.NODEFONY_ENV || runtimeEnv;
    return {
      env: (env ?? process.env) as ConfigContext["env"],
      appEnv,
      runtimeEnv,
      isProd: runtimeEnv === "production",
      isDev: runtimeEnv === "development",
      isTest: runtimeEnv === "test",
    };
  }

  /**
   * Résout les options brutes de l'app. App moderne (`export default defineConfig(…)`)
   * → `raw` est un descripteur {@link AppConfigDescriptor} (le symbole de marque
   * survit au spread d'options de `Service`) → résolu avec `ctx` (deep-merge des
   * défauts framework + validation Zod intégrée à `resolve`). App legacy → objet de
   * config retourné tel quel (validé séparément par son export `validateConfig`).
   *
   * @param raw - export par défaut de l'app (descripteur ou objet de config).
   * @param ctx - contexte d'environnement ({@link buildConfigContext}).
   * @returns options résolues + `wasDescriptor` (pilote le fallback de validation).
   */
  private resolveAppOptions(
    raw: unknown,
    ctx: ConfigContext,
  ): { options: TypeKernelOptions; wasDescriptor: boolean } {
    if (isConfigDescriptor(raw)) {
      // Descripteur : merge défauts framework + validation Zod DANS resolve (Lot 1).
      return {
        options: raw.resolve(ctx) as TypeKernelOptions,
        wasDescriptor: true,
      };
    }
    // App legacy / config absente : merge SOUS les défauts framework (RÉSILIENCE — la
    // config reste complète ; tout champ omis prend son défaut EXPLICITE) via la même
    // recette `extend(true,{},…)` que le descripteur. La validation reste celle de
    // l'app (export `validateConfig`). Une app vide boote ainsi sur defaultAppConfig.
    const options = extend(
      true,
      {},
      defaultAppConfig,
      raw ?? {},
    ) as TypeKernelOptions;
    return { options, wasDescriptor: false };
  }

  /**
   * Construit + PRÉSENTE une erreur de configuration de boot de façon
   * EXCEPTIONNELLEMENT claire, et EXPLICITE sur la config PAR DÉFAUT du framework
   * (ce qui s'applique pour tout champ omis). Une config cassée n'est pas
   * récupérable (le framework ne peut pas deviner ports/modules) → fail-fast PROPRE :
   * log lisible SANS stack brute (faute de config, pas bug framework), erreur marquée
   * `presented` (le catch de boot ne re-loggue pas) + `exitCode` `EX_CONFIG`
   * (l'orchestrateur distingue « mauvaise config » d'un crash logiciel).
   *
   * @param title - titre court de l'erreur.
   * @param detail - phrase de contexte.
   * @param cause - erreur d'origine (Zod, import, fonction de config).
   * @param hints - correctifs actionnables.
   * @returns nodefonyError marquée (`exitCode`/`presented`), à `throw`.
   */
  private bootConfigError(
    title: string,
    detail: string,
    cause: unknown,
    hints: string[],
  ): nodefonyError {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    const lines = [
      "",
      `  ✖ ${title}`,
      `    ${detail}`,
      `    Cause : ${causeMsg}`,
      "",
      "    Configuration PAR DÉFAUT du framework (appliquée à tout champ omis) :",
      this.formatDefaults(),
      "",
      "    Pour corriger :",
      ...hints.map((h) => `      → ${h}`),
      "",
    ];
    this.log(lines.join("\n"), "CRITIC");
    const err = new nodefonyError(`${title} : ${causeMsg}`);
    err.exitCode = SysExit.CONFIG;
    err.presented = true;
    return err;
  }

  /** Rendu lisible (1 ligne/clé top-level) des valeurs par défaut du framework. */
  private formatDefaults(): string {
    return Object.entries(defaultAppConfig)
      .map(([k, v]) => {
        const val =
          v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
        return `      • ${k} = ${val}`;
      })
      .join("\n");
  }

  private async loadApp(config?: TypeKernelOptions): Promise<Module> {
    // ── Chargement + résolution de config = phase la plus fragile du boot →
    //    blindée : toute défaillance produit un diagnostic clair + fail-fast propre
    //    (cf bootConfigError), jamais une stack opaque.
    try {
      this.app = await this.loadModule(`${this.path}/dist/index.js`);
    } catch (e) {
      throw this.bootConfigError(
        "Chargement de l'application impossible",
        `Le point d'entrée \`${this.path}/dist/index.js\` n'a pas pu être importé/évalué.`,
        e,
        [
          "Build périmé ou absent → `npm run clean && npm run build`.",
          "Un fichier de config déréférence le kernel au top-level (résolu à l'import) → différer en getter/lazy.",
        ],
      );
    }
    this.app.isApp = true;
    // Catalogue env optionnel exposé par l'app (`export const env = defineEnv(…)`)
    // → alimente `ctx.env` ; absent (app legacy) → `process.env`. Import en cache
    // ESM (déjà résolu ci-dessus → ne peut plus échouer) → coût négligeable.
    const appModule = (await import(`${this.path}/dist/index.js`)) as {
      env?: unknown;
    };
    const ctx = this.buildConfigContext(appModule.env);
    // App moderne (`export default defineConfig(…)`) : descripteur résolu avec `ctx`
    // (merge défauts + validation Zod). App legacy / vide : merge sous les défauts
    // framework (config toujours complète). Échec ici = config invalide → diagnostic
    // explicite (incluant les valeurs par défaut) + fail-fast propre.
    let wasDescriptor = false;
    try {
      const resolved = this.resolveAppOptions(this.app.options, ctx);
      this.app.options = resolved.options;
      wasDescriptor = resolved.wasDescriptor;
    } catch (e) {
      throw this.bootConfigError(
        "Configuration de l'application invalide",
        "La résolution de la configuration (`defineConfig`) a échoué.",
        e,
        [
          "Vérifie les types/valeurs des champs signalés dans `nodefony.config.ts`.",
          "Une fonction `defineConfig((ctx) => …)` qui lève → corrige la logique par-env.",
        ],
      );
    }
    this.options = this.readConfig(extend(this.app.options, config));
    // Validation fail-fast AVANT initializeLog. Inutile pour une app moderne (le
    // descripteur valide déjà au resolve) → seulement pour le fallback legacy.
    // Convention `validateConfig` retirée au Lot 5 (migration app self-hosted).
    if (!wasDescriptor) {
      try {
        await this.validateAppConfig();
      } catch (e) {
        throw this.bootConfigError(
          "Configuration de l'application invalide",
          "Le schéma de validation de l'app a rejeté la configuration.",
          e,
          [
            "Corrige les champs signalés ci-dessus.",
            "Les valeurs par défaut du framework listées s'appliquent aux champs omis.",
          ],
        );
      }
    }
    // Chargement de modules piloté par CONFIG (manifeste `config.modules`). Branché
    // au MÊME instant que l'ancien décorateur @modules (listener `onPreRegister`)
    // → comportement identique, mais la liste est une DONNÉE gatable et le Kernel
    // en est le seul orchestrateur. Compat : sans manifeste, le décorateur @modules
    // (s'il est encore utilisé par une app/test) garde la main.
    // Cf project_module_loading_architecture (mémoire IA).
    if (Array.isArray(this.options.modules) && this.options.modules.length) {
      this.once("onPreRegister", async () => {
        await this.loadModulesFromManifest();
      });
    }
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
    // Idempotence des transports d'écriture : `removeAllListeners` ne touche QUE
    // les listeners EventEmitter, PAS le tableau `_transports`. Retirer ceux que
    // ce même `initializeLog` a montés au passage précédent (cf champ doc).
    if (this._mountedLogTransports !== null) {
      for (const t of this._mountedLogTransports) {
        this.syslog?.removeTransport(t);
      }
      this._mountedLogTransports = null;
    }

    if (this.options.log && !this.options.log.active) {
      return;
    }
    // Bufférisation de la sortie console (process-global) — coalesce les writes
    // d'un même tick en 1 syscall sous forte concurrence. "auto" (défaut) =
    // bufférise hors TTY (pipe/fichier = prod/collecteur), immédiat sur TTY
    // (dev). Cf Syslog.setOutputBuffering + config.log.buffered.
    const logCfg = this.options.log as TypeKernelOptions["log"];
    Syslog.setOutputBuffering(logCfg?.buffered ?? "auto");
    // Couleur ANSI des logs — résolue UNE fois ici (boot) à partir de `this.isTTY`
    // (déjà résolu, NO_TTY-aware — PAS de re-lecture de process.stdout), augmenté
    // des conventions NO_COLOR (no-color.org) + FORCE_COLOR. pipe/fichier = brut →
    // 0 ANSI baké (stdout pipe + .jsonl propres). 0 test par log ensuite.
    setLogColor(resolveColorEnabled(this.isTTY));
    // Répertoire des logs — SOURCE UNIQUE : sink `.log` (LB.W) + JSONL queryable
    // (LB.2/5) + viewer Studio. Configurable `log.dir` (défaut "logs"), sous cwd.
    const logDirAbs = path.resolve(process.cwd(), logCfg?.dir ?? "logs");
    // Driver de sink (LB.W) : stdout (défaut, cloud-native pipe non-bloquant) |
    // file (fd async PAR worker → 0 lock d'inode partagé en cluster, le goulet
    // prouvé +28%) | null (bench). FileSink Node-only ; Syslog reste isomorphe.
    const logDriver = logCfg?.driver ?? "stdout";
    if (logDriver === "file") {
      const logPath =
        logCfg?.file?.path ??
        path.join(logDirAbs, `nodefony-${process.pid}.log`);
      Syslog.setLogSink(
        new FileSink({ path: logPath, sync: logCfg?.file?.sync }),
      );
    } else if (logDriver === "null") {
      Syslog.setLogSink(NULL_LOG_SINK);
    } else {
      Syslog.setLogSink(null); // stdout (défaut isomorphe)
    }
    // ── Log Backplane (LB.1) — axe DESTINATION queryable (≠ sink write ci-dessus,
    //    ≠ bus temps réel syslog:stream). Le driver `memory` relit le ring buffer
    //    du syslog (source injectée lazy → lit le syslog courant à la query).
    //    Défaut dev ; `file`-JSONL / `elastic`-`loki` (Node-only, LB.2+) = drivers
    //    enregistrés à part. Switch à la volée = action de contrôle dev-only (Studio).
    // Profondeur du ring de relecture : config explicite, sinon 2000 en dev
    // (trace d'une requête lisible malgré le bruit), 100 ailleurs (prod-safe).
    const maxStack =
      logCfg?.maxStack ??
      (this.environment === "development" ? 2000 : undefined);
    if (maxStack) this.syslog?.setMaxStack(maxStack);
    const queryDriver = logCfg?.queryDriver ?? "memory";
    // Résolution des drivers par FABRIQUES (logDriverRegistry) — AUCUN `if (name === …)`
    // dans le Kernel : les drivers natifs (memory/file/cluster-file/loki/opensearch)
    // s'enregistrent dans `builtinLogDrivers` (idempotent), un userland ajoute le sien
    // via `registerLogDriverFactory`. Le Kernel ne fait que RÉSOUDRE + BRANCHER.
    registerBuiltinLogDrivers();
    const driverCtx: ILogDriverContext = {
      logCfg,
      environment: this.environment ?? "production",
      logDir: logDirAbs,
      pid: process.pid,
      getRingStack: () => this.syslog?.ringStack ?? [],
    };
    // Drivers à monter : l'ACTIF demandé + `memory` (toujours présent = fallback sûr) +
    // en DÉVELOPPEMENT les drivers fichier (switchables à chaud depuis Studio — on les
    // ENREGISTRE en plus, l'actif reste `queryDriver`). En prod = opt-in strict (12-factor :
    // destination figée, pas d'I/O « au cas où »). `writeKey` déduplique le transport
    // d'écriture partagé (file ↔ cluster-file = même JSONL par worker → branché 1×).
    const toMount = new Set<string>(["memory", queryDriver]);
    if (this.environment === "development") {
      // En dev : tenter de monter TOUS les drivers ENREGISTRÉS (registre de fabriques) →
      // switch à chaud (Studio) entre eux sans reboot, SANS liste codée en dur dans le
      // Kernel. Chaque fabrique s'auto-skippe (`null`) si sa config manque (ex. loki/
      // opensearch sans URL) → 0 I/O « au cas où ». En PROD = opt-in strict (`queryDriver`).
      // Conséquence assumée en dev : double-push si plusieurs destinations sont configurées
      // (volume dev faible) — c'est le prix du switch instantané.
      for (const name of listLogDriverFactories()) toMount.add(name);
    }
    const addedWrites = new Set<string>();
    for (const name of toMount) {
      const factory = getLogDriverFactory(name);
      if (factory === undefined) continue;
      const mount = factory(driverCtx);
      if (mount === null) continue;
      registerLogDriver(mount.driver);
      if (mount.transport !== undefined) {
        const key = mount.writeKey;
        if (key === undefined || !addedWrites.has(key)) {
          this.syslog?.addTransport(mount.transport);
          (this._mountedLogTransports ??= []).push(mount.transport);
          if (key !== undefined) addedWrites.add(key);
        }
      }
    }
    try {
      setActiveLogDriver(queryDriver);
    } catch {
      // Driver configuré non enregistré (ex. "elastic" sans son module) → fallback
      // "memory" (toujours présent) + avertissement. Jamais de crash au boot.
      this.syslog?.log(
        `Log query driver "${queryDriver}" introuvable — fallback "memory".`,
        "WARNING",
        "SYSLOG",
      );
      setActiveLogDriver("memory");
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
      this.runProfile = cli.runProfile;
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
    // Défensif : `runProfile` peut être indéfini au moment de l'init du field `console`
    // (avant le constructor) → `false`, préservant la valeur figée historique.
    return this.runProfile ? !this.runProfile.servers : false;
  }

  setNodeEnv(environment: EnvironmentType): void {
    if (environment) {
      switch (environment) {
        case "dev":
        case "development":
          process.env.NODE_ENV = "development";
          process.env.BABEL_ENV = "development";
          this.isDev = true;
          this.isProd = false;
          break;
        default:
          process.env.NODE_ENV = "production";
          process.env.BABEL_ENV = "production";
          this.isProd = true;
          this.isDev = false;
      }
    }
    process.env.NODE_DEBUG = this.debug ? "true" : "false";
  }

  /**
   * Résout le **mode runtime** (dev/prod) selon le 12-factor : `NODE_ENV`
   * (ambient, posé par l'orchestrateur en cloud) PRIME sur l'intention de la
   * commande locale, qui prime sur la valeur courante. Normalise en
   * `"development" | "production"`. Pur (lit `process.env`, n'écrit rien) → sûr à
   * appeler avant que `setNodeEnv` n'ait posé `NODE_ENV` (ex. gating de modules à
   * `onPreRegister`). Cf project_app_config_refonte_chantier (deux axes d'env).
   */
  resolveRuntimeEnv(
    fromCommand?: EnvironmentType,
  ): "development" | "production" {
    const raw =
      process.env.NODE_ENV || fromCommand || this.environment || "production";
    return raw === "dev" || raw === "development"
      ? "development"
      : "production";
  }

  setEnv(environment?: EnvironmentType) {
    // MODE RUNTIME (dev/prod) — source 12-factor : NODE_ENV > commande > courant.
    const runtime = this.resolveRuntimeEnv(environment);
    this.environment = runtime;
    // ENVIRONNEMENT DE DÉPLOIEMENT (axe DISTINCT du mode runtime) — string libre
    // via APP_ENV / NODEFONY_ENV (staging/preprod/prod/canary/prod-eu…) ; pilote la
    // config/secrets, PAS le moteur. Défaut = le mode runtime si non posé →
    // comportement inchangé hors cloud. Un staging tourne en mode `production`
    // (optimisé) mais reste l'env `staging`. Cf project_app_config_refonte_chantier.
    this.appEnvironment.environment =
      process.env.APP_ENV || process.env.NODEFONY_ENV || runtime;
  }

  /**
   * Header de boot dev consolidé, imprimé juste sous l'ASCII (dev-only) : nom +
   * version + environnement + meta (`cluster · platform · node · pid`). Remplace la
   * ligne « Version … » et le banner « SERVER … » bruts. Couleurs gatées TTY (logColor).
   */
  private printDevHeader(): void {
    let version = "";
    try {
      const v: unknown = this.cli?.commander?.version();
      if (typeof v === "string") version = v;
    } catch {
      /* commander sans version définie — ignore */
    }
    const meta = [
      String(this.typeCluster ?? ""),
      process.platform,
      `node ${process.version}`,
      `pid ${process.pid}`,
      // Rappel du volet TTY (découvrabilité) : interactif possible SSI interactive && tty.
      `tty ${this.isTTY ? "yes" : "no"}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const tag = version ? ` ${logColor.blackBright(`v${version}`)}` : "";
    const env = this.environment
      ? `   ${logColor.green(String(this.environment))}`
      : "";
    // Axe DÉPLOIEMENT (APP_ENV / NODEFONY_ENV) affiché seulement s'il DIFFÈRE du
    // mode runtime — sinon redondant. Lu DIRECTEMENT depuis l'env (ambient) car le
    // header s'imprime avant que `setEnv` n'ait résolu `appEnvironment`. Cf deux axes.
    const appEnv = process.env.APP_ENV || process.env.NODEFONY_ENV;
    const deploy =
      appEnv && appEnv !== String(this.environment)
        ? ` ${logColor.blackBright("·")} ${logColor.magenta(appEnv)}`
        : "";
    console.log(
      `  ${logColor.cyan("⬢")} ${logColor.cyanBold("Nodefony")}${tag}${env}${deploy}`,
    );
    console.log(`  ${logColor.blackBright(meta)}\n`);
  }

  logEnv(): string {
    if (this.cli) {
      this.runProfile = this.cli.runProfile;
    }
    const profileLabel = this.runProfile.servers ? "server" : "console";
    let txt = `      \x1b ${logColor.blue(profileLabel)} `;
    txt += ` ${logColor.magenta("Cluster")} : ${this.typeCluster} `;
    txt += ` ${logColor.magenta("Nodefony Environment")} : ${this.environment}  `;
    if (this.appEnvironment) {
      txt += ` ${logColor.magenta("App Environment")} : ${
        this.appEnvironment.environment
      }  `;
    }
    txt += ` ${logColor.magenta("Debug")} : ${this.debug}\n`;
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
      if (!this.reporterOwnsHeader && !this.cli?.quietBoot)
        console.log(this.logEnv());
      this.flushPendingModuleAddLogs();
      this.fire("onCluster", "MASTER", this, process);
    } else if (cluster.isWorker) {
      if (!this.reporterOwnsHeader && !this.cli?.quietBoot)
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
    this.log(`${colorLogEvent()} ${event as string}`, "DEBUG");
    return super.fire(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: KernelEventsType, ...args: any[]): boolean {
    this.log(`${colorLogEvent()} ${event as string}`, "DEBUG");
    return super.emit(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emitAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent()} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fireAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent()} ${event as string}`, "DEBUG");
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
    this.log(`${colorLogEvent()} ${event as string} [guarded]`, "DEBUG");
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
   * Initialise un service **sous garde de boot** (timeout + politique de criticité
   * via {@link guardInitialize}) si le service expose le hook `init`. Point
   * d'entrée commun à {@link addKernelService} (service kernel, `critical=true`) et
   * à {@link Module.addService} (service de module, criticité = celle du module
   * porteur), pour que les deux chemins d'init partagent la même résilience.
   *
   * @remarks Avant 2026-05-29 les services de module passaient par un `await` NU
   *   (aucun timeout) : un `init` qui pend (ex. `redis` = connexion réseau)
   *   gelait le boot indéfiniment. Désormais borné comme les services kernel.
   *
   * @param serviceInit - instance du service ; ne fait rien si `init` absent.
   * @param owner - propriétaire passé au hook : le {@link Module} ou ce {@link Kernel}.
   * @param critical - criticité transmise à {@link isBootErrorFatal}.
   */
  async guardServiceInitialize(
    serviceInit: ServiceWithInit,
    owner: Module | Kernel,
    critical: boolean,
  ): Promise<void> {
    if (!serviceInit.init) {
      return;
    }
    this.log(`SERVICE INITIALIZE : ${serviceInit.name}`, "DEBUG");
    const init = serviceInit.init.bind(serviceInit);
    await this.guardInitialize(() => init(owner), serviceInit.name, critical);
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
    // Libère le timer de park (daemon) : sinon il garderait l'event loop vivant après
    // le shutdown. Idempotent (no-op si jamais parké).
    if (this.parkTimer) {
      clearInterval(this.parkTimer);
      this.parkTimer = null;
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
