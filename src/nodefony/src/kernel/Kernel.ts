/* eslint-disable @typescript-eslint/ban-ts-comment */
import { logColor, setLogColor, resolveColorEnabled } from "../syslog/logColor";
import cluster from "node:cluster";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Container, { Scope } from "../Container";
import FileClass from "../FileClass";
import { Nodefony } from "../Nodefony";
import Service, { DefaultOptionsService } from "../Service";
import { extend, isSubclassOf } from "../Tools";
import Command, { CommandArgs } from "../command/Command";
import { Severity } from "../syslog/Pdu";
import Syslog, { NULL_LOG_SINK } from "../syslog/Syslog";
import { FileSink } from "../syslog/sinks/FileSink";
import {
  registerLogDriver,
  setActiveLogDriver,
  getActiveLogDriver,
  getLogDriverFactory,
  listLogDriverFactories,
  type ILogDriverContext,
} from "../syslog/drivers/logDriverRegistry";
import {
  registerBuiltinLogDrivers,
  resolveQueryDriver,
} from "../syslog/drivers/builtinLogDrivers";
import {
  isInKubernetes,
  shouldWarnPerPodView,
} from "../service/cluster/podEnvironment";
import type { ITransport } from "../types/ITransport";
import { DebugType, EnvironmentType } from "../types/globals";
import CliKernel from "./CliKernel";
import Module from "./Module";
import { resolveModuleEntry, toImportSpecifier } from "./resolveModuleEntry";
import { writeLastBoot, type ILastBoot } from "./checks/lastBoot";
//import Fetch from "../service/fetchService";
// Type SEUL (`this.get<HttpKernel>(…)`) : le cœur ne dépend pas de `@nodefony/http`
// à l'exécution — l'inverse serait un cycle, http déclarant `nodefony`.
import type { HttpKernel } from "@nodefony/http";
import Injector from "./injector/injector";
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
import {
  isConfigDescriptor,
  readAppEnvOverrideReport,
} from "../config/defineConfig";
import { defaultAppConfig } from "../config/defaults";
import {
  parseNfEnvOverrides,
  applyResolvedPath,
  pathLooksSecret,
  closestMatch,
  resolveFailureHint,
} from "../config/envOverride";
import type { ConfigContext } from "../config/types";
import { resolveInfra, AUTO_STORE } from "../config/infra";
import type { IInfra, IStoreResolution } from "../config/infra";
import { findSetReservedKeys } from "../config/configProvenance";
import nodefonyError from "../Error";
import { SysExit } from "../cli/sysexits";
import type { IGuardedEmitResult, IGuardedListenerInfo } from "../Event";
import { withTimeout, TimeoutError } from "../runtime/withTimeout";
import { readListenerTags } from "./lifecycleTags";
import { BootConfigurationError } from "./BootConfigurationError";
import type {
  IBootReport,
  IBootFailure,
  IBootServerInfo,
  IBootModuleGated,
} from "./bootReport";

// Tag d'event — couleur gatée au boot (gratuit hors TTY ; logs DEBUG only).
const colorLogEvent = (): string => logColor.cyanBgBlue("EVENT KERNEL");

// Nom de service serveur → scheme d'URL conventionnel (pour le BootReport).
const SERVER_SCHEME: Readonly<Record<string, string>> = {
  http: "http",
  https: "https",
  websocket: "ws",
  "websocket-secure": "wss",
};

export interface TypeKernelOptions extends DefaultOptionsService {
  node_start?: NodefonyStartType;
  /**
   * Manifeste déclaratif des modules de l'app (liste ordonnée, gatable par
   * `policy`/`when`/environnement). Lu et orchestré par le Kernel à
   * `onPreRegister`. Remplace l'usage du décorateur `@modules` côté app.
   * Cf `project_module_loading_architecture` (mémoire IA).
   */
  modules?: IModuleManifest;
  /**
   * Deadline GLOBALE du shutdown (ms) — cf `AppConfigInput.shutdownDeadline`
   * (config/types.ts). Au-delà, {@link Kernel.terminate} force la sortie code 1
   * même si un listener `onTerminate` pend. `0` = filet désactivé.
   */
  shutdownDeadline?: number;
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
     * Orthogonal à `driver` (sink write texte) et au bus temps réel `nodefony:syslog`.
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

// Deadline globale du shutdown (fallback si la config app n'est pas passée —
// tests unitaires, kernels embarqués). Le défaut nominal vit dans
// `config/defaults.ts` (`shutdownDeadline`), aligné sur cette valeur.
const DEFAULT_SHUTDOWN_DEADLINE = 15_000;
// Sentinelles du Promise.race de terminate() (identité stricte, jamais égales
// à une valeur de listener).
const SHUTDOWN_DEADLINE = Symbol("shutdown-deadline");
const SHUTDOWN_DRAIN_ERROR = Symbol("shutdown-drain-error");
/**
 * Dérogation au gating `policy:"dev"` en production — posée à `1`, les modules de
 * développement sont chargés malgré le mode.
 *
 * Existe pour éprouver un runtime de production AVEC les briques de banc (une suite
 * d'intégration interroge des routes qu'un module `policy:"dev"` porte, et qui
 * n'existent donc pas là-bas : tout répond 404). Réservée aux bancs et au
 * diagnostic — chaque module chargé par dérogation est journalisé en WARNING, et
 * la variable n'a **aucun effet** hors production.
 */
export const FORCE_DEV_MODULES_ENV = "NF_WITH_DEV_MODULES";
/**
 * Durée de vie d'un runtime de production qui a dérogé au gating des modules dev.
 *
 * La variable seule ne protège de rien : elle s'oublie, dans une image, un manifeste
 * de déploiement, un fichier d'environnement recopié — et le jour où elle survit à
 * une mise en production, plus rien ne le dit. Un runtime en dérogation **s'arrête
 * donc tout seul** : l'oubli devient un incident immédiat et lisible plutôt qu'une
 * surface offerte pour des mois. Large devant toute suite de tests (les tâches
 * d'intégration continue du dépôt expirent à 20 minutes), dérisoire devant la durée
 * de vie d'un déploiement.
 */
export const FORCE_DEV_MODULES_TTL_MS = 30 * 60_000;
/**
 * Plafond DUR de cette durée de vie. Un banc de charge légitime dure plus qu'une
 * suite d'intégration, d'où le réglage ci-dessous — mais aucune valeur ne désarme
 * la minuterie : une protection qu'on peut annuler par la même variable que celle
 * qu'elle protège n'en est pas une.
 */
export const FORCE_DEV_MODULES_TTL_MAX_MS = 4 * 60 * 60_000;
/** Variable de réglage de la durée de vie, en MINUTES (bornée par le plafond dur). */
export const FORCE_DEV_MODULES_TTL_ENV = "NF_WITH_DEV_MODULES_TTL_MIN";

/**
 * Durée de vie effective d'un runtime en dérogation — fonction PURE.
 *
 * @param env - environnement à lire (injecté : la règle s'éprouve sans toucher au process).
 * @returns la durée en millisecondes, toujours comprise entre le défaut et le plafond.
 */
export function resolveDevModulesTtlMs(
  env: Record<string, string | undefined>,
): number {
  const raw = Number.parseInt(env[FORCE_DEV_MODULES_TTL_ENV] ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return FORCE_DEV_MODULES_TTL_MS;
  return Math.min(
    Math.max(raw * 60_000, FORCE_DEV_MODULES_TTL_MS),
    FORCE_DEV_MODULES_TTL_MAX_MS,
  );
}

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
  init?(owner?: Module<unknown> | Kernel): Promise<this>;
}

export interface ServiceConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): ServiceWithInit;
  _inject?: { [key: number]: string };
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
  /**
   * Supprime les bannières serveurs « Server Listen on… » (`showBanner`) — posé
   * par le `BootReporter` animé (dev TTY non-debug) : le bloc « ✓ Prêt » liste
   * déjà les URLs, ces logs feraient doublon. Reste `false` en prod/CI/`--debug`
   * → bannières affichées (aucun changement hors écran de boot animé).
   */
  suppressBootBanners: boolean = false;
  trunk: trunkType = null;
  // Entrée app résolue par resolveAppEntry() — undefined = pas encore résolue.
  private _appEntry: string | null | undefined = undefined;
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
  /** Minuterie d'auto-arrêt d'un runtime en dérogation de modules dev (`null` = aucune). */
  private devModulesStopTimer: NodeJS.Timeout | null = null;
  node_start: NodefonyStartType =
    process.env.NODEFONY_START || this.options.node_start;
  platform: NodeJS.Platform = process.platform;
  projectName: string = "NODEFONY";
  uptime: number = new Date().getTime();
  numberCpu: number = os.cpus().length;
  modules: Record<string, Module> = {};
  tmpDir?: FileClass;
  /**
   * Répertoire des données runtime **persistées** (`<path>/var`) — base commune des
   * stores fichier (passkeys, TOTP, sessions) et bases SQLite. Gitignoré comme
   * `tmpDir` → garanti créé au boot. Distinct de `tmpDir` (éphémère).
   */
  varDir?: FileClass;
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
   * Échecs de boot non fatals (fail-soft) agrégés pour le {@link IBootReport}.
   * **Lazy** : reste `null` tant qu'aucun module/hook n'échoue → 0 allocation sur
   * un boot nominal (règle perf core).
   */
  private bootFailures: IBootFailure[] | null = null;
  /**
   * Modules du manifeste volontairement NON chargés (gating `policy`/`when` de
   * {@link resolveModuleEntries}), avec leur raison — un gating silencieux se lit
   * comme un module perdu. **Lazy** : `null` si rien n'est gaté (cas nominal).
   */
  private modulesGated: IBootModuleGated[] | null = null;
  /**
   * Compteurs WARNING/ERROR du journal de boot, **figés** quand `postReady` passe
   * true (après, le ring syslog mélange boot et runtime). `null` = boot en cours
   * → {@link getBootReport} compte à la volée.
   */
  private bootLogCounts: { warnings: number; errors: number } | null = null;
  /**
   * Serveurs réellement en écoute, figés à `onPostReady`. `null` tant que le boot
   * n'a pas atteint cette phase ; `[]` si profil serveur mais rien n'écoute (cas
   * du garde-fou 0-serveur).
   */
  private bootServers: IBootServerInfo[] | null = null;
  /** Horodatage (`Date.now()`) du début de `start()` — base de `durationMs`. */
  private bootStartedAt: number = 0;
  /**
   * Lignes de détail de boot par phase (canal NEUTRE) : un module pousse via
   * {@link reportBootLine} ce qu'il veut voir RACONTÉ sous sa phase (ex. un
   * adapter ORM : « drizzle → sqlite »). Le core reste agnostique du contenu.
   * Lazy : `null` tant qu'aucune ligne (dev-only en pratique).
   */
  private bootLines: Map<string, string[]> | null = null;
  /**
   * Construit le Kernel. **Side effect critique** : appelle `Nodefony.setKernel(this)` →
   * écrase le singleton global. Isoler les tests avec un mock minimal pour éviter de
   * polluer les autres tests qui dépendent de `Nodefony.getKernel()`.
   *
   * Récupère le container du CLI si présent, sinon en crée un nouveau. Initialise les
   * interfaces réseau OS pour `setDomain()`. Fire `"onInit"` à la fin.
   *
   * @param environment - mode MOTEUR (`"development"` / `"production"`, ou leurs
   *   abrégés `"dev"` / `"prod"`). ⚠️ Ni `"test"` ni `"staging"` : `test` est une valeur
   *   de `NODE_ENV` normalisée en `runtimeEnv` (→ `ConfigContext.isTest`), et un staging
   *   tourne EN mode `production` — il se distingue par `APP_ENV`, pas par son moteur.
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
   * Point d'entrée du boot — et POINT DE PASSAGE UNIQUE de l'échec de démarrage.
   *
   * Le déroulé vit dans {@link startBoot} ; cette enveloppe ne fait qu'une
   * chose : figer le bilan (`var/last-boot.json`) quand le démarrage est
   * abandonné, puis relancer l'erreur inchangée. Le bilan d'un démarrage
   * ABOUTI est écrit ailleurs — au moment où il est complet (cf
   * {@link captureBootServers} / `onPostReady`), pas ici.
   *
   * Pourquoi l'échec ICI et pas dans les `catch` du pipeline : ils sont une
   * douzaine, et chacun relance. Y répartir l'écriture donnerait autant
   * d'implémentations d'une même règle — dont certaines seraient oubliées au
   * premier ajout de phase, sans que rien ne le signale. Un seul point ne peut
   * pas diverger de lui-même.
   *
   * Et pourquoi RIEN n'est effacé sur un succès : une commande console
   * (`inspect`, une commande de module) démarre et réussit sans jamais monter
   * de serveur. Effacer ici ferait disparaître le bilan d'un échec applicatif
   * au premier `nodefony inspect` lancé pour le diagnostiquer — l'outil de
   * diagnostic détruirait la preuve qu'il vient chercher.
   *
   * @returns `this` après boot complet.
   * @throws Toute exception du pipeline est loggée CRITIC puis re-throw — le
   *         bilan n'en absorbe aucune.
   */
  async start(): Promise<this> {
    try {
      return await this.startBoot();
    } catch (e) {
      this.traceFatalBootFailure(e);
      throw e;
    }
  }

  /**
   * Traduit le bitmask {@link progress} en NOM de la dernière phase atteinte.
   *
   * C'est l'information la plus discriminante d'une trace d'échec : elle situe
   * le défaut dans le cycle de vie (« mort à `onBoot` » désigne les modules,
   * « mort à `onReady` » désigne les serveurs) sans qu'on ait à lire une pile.
   *
   * @returns le nom de la phase la plus avancée, `"onInit"` par défaut.
   */
  private lastReachedPhase(): string {
    let reached = "onInit";
    for (const [name, bit] of Object.entries(Events)) {
      if (this.progress & bit) reached = name;
    }
    return reached;
  }

  /**
   * Socle commun des deux bilans (abouti et abandonné) — ce qui est vrai dans
   * les deux cas se remplit ICI, une seule fois.
   *
   * @param status - issue du démarrage.
   * @returns le bilan, prêt à être complété par l'appelant.
   */
  private baseLastBoot(status: ILastBoot["status"]): ILastBoot {
    return {
      status,
      timestamp: new Date().toISOString(),
      environment: this.environment ?? "unknown",
      pid: process.pid,
      node: process.version,
      phase: this.lastReachedPhase(),
    };
  }

  /**
   * Fige le bilan d'un démarrage ABOUTI.
   *
   * Ce n'est pas une redondance avec le journal : le bilan retient ce que le
   * terminal a montré une fois puis perdu — les briques ignorées AVEC leur
   * raison, celles que le gating a écartées, les comptes d'avertissements. Une
   * application qui démarre amputée ne se signale plus après sa première
   * seconde de vie ; c'est justement le cas que personne ne diagnostique.
   *
   * @param report - bilan de boot figé (serveurs capturés).
   */
  private writeBootSummary(report: IBootReport): void {
    const entry = this.baseLastBoot("ok");
    entry.durationMs = report.durationMs;
    entry.healthy = report.healthy;
    entry.modulesLoaded = report.modulesLoaded;
    entry.warnings = report.warnings;
    entry.errors = report.errors;
    entry.remediation = report.remediation ?? undefined;
    if (report.modulesSkipped.length) {
      entry.bricksSkipped = report.modulesSkipped.map((f) => ({
        module: f.module,
        reason: f.reason,
        phase: f.phase,
      }));
    }
    if (report.modulesGated.length) {
      entry.bricksGated = report.modulesGated.map((g) => ({
        module: g.module,
        reason: g.reason,
      }));
    }
    if (report.serversListening.length) {
      entry.serversListening = report.serversListening.map(
        (s) => `${s.type}${s.port ? `:${s.port}` : ""}`,
      );
    }
    writeLastBoot(this.path, entry);
  }

  /**
   * Consigne le démarrage ABANDONNÉ, sans jamais pouvoir aggraver la panne.
   *
   * À ne pas confondre avec {@link recordBootFailure}, qui collecte les échecs
   * **non fatals** (fail-soft) d'un boot qui, lui, continue. Les deux se
   * complètent, et c'est pourquoi le bilan embarque le second : quand le boot
   * meurt, savoir quelles briques avaient DÉJÀ été ignorées avant désigne
   * souvent la cause réelle — un module optionnel tombé emporte plus loin celle
   * qui en dépendait, et seul le premier incident l'explique.
   *
   * @param e - l'erreur qui a fait abandonner le boot.
   */
  private traceFatalBootFailure(e: unknown): void {
    const err = e instanceof Error ? e : new Error(String(e));
    const entry = this.baseLastBoot("failed");
    entry.error = {
      message: err.message,
      name: err.name,
      exitCode: (err as { exitCode?: number }).exitCode,
      stack: err.stack,
    };
    if (this.bootFailures?.length) {
      entry.bricksSkipped = this.bootFailures.map((f) => ({
        module: f.module,
        reason: f.reason,
        phase: f.phase,
      }));
    }
    writeLastBoot(this.path, entry);
  }

  /**
   * Déroulé du boot. Fire `"onPreStart"` puis `"onStart"`, charge l'application
   * (`loadApp()`), instancie services kernel (Rollup), puis enchaîne sur
   * `preRegister()` → `boot()` → `onReady()` → `initServers()`.
   *
   * Si `command.kernelEvent` matche la phase atteinte → {@link finishOrPark} immédiat
   * (la command a fini son boulot : terminate one-shot OU park daemon long-running) —
   * même sémantique de sortie à TOUTES les phases d'arrêt.
   *
   * Appelé UNIQUEMENT par {@link start}, qui porte la trace d'échec.
   *
   * @returns `this` après boot complet.
   * @throws Toute exception du pipeline est loggée CRITIC puis re-throw.
   */
  private async startBoot(): Promise<this> {
    if (this.bootStartedAt === 0) {
      this.bootStartedAt = Date.now();
    }
    this.debug = Boolean(this.cli?.commander?.opts().debug) || false;
    this.trunk = await this.isTrunk();
    this.initializeLog();
    if (!this.trunk && this.cli) {
      // PROJET Nodefony présent mais pas bootable (deps non installées / non
      // construit) → message ACTIONNABLE + exit 1, TTY ou pas. Ouvrir le wizard
      // de création dans un projet existant serait un contresens (vécu : app
      // générée, `nodefony dev` avant `npm install` → « il ne détecte pas »).
      const hint = this.diagnoseUnbootableProject();
      if (hint) {
        this.log(hint, "CRITIC");
        return (await this.terminate(1)) as this;
      }
      // Hors projet Nodefony (aucune entrée d'app résolue depuis package.json).
      // Le wizard de création est un outil INTERACTIF : sans TTY (container,
      // CI, orchestrateur), prompter est absurde (le prompt crashe « User
      // force closed ») → erreur claire + exit 1, diagnosticable en logs.
      if (!this.isTTY) {
        this.log(
          `Pas de projet Nodefony ici (${this.path}) : aucune entrée d'app ` +
            `résolue (package.json \`main\`, dist/index.js ou index.js). ` +
            `Vérifie le répertoire de travail et le build (dist/).`,
          "CRITIC",
        );
        return (await this.terminate(1)) as this;
      }
      return await this.cli
        .runCommandAsync("menu", ["-i"])
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

    // `var/` = données runtime PERSISTÉES (stores fichier passkeys/TOTP/sessions,
    // bases SQLite). Gitignoré comme `tmp/` → absent sur checkout frais/pod neuf. On
    // garantit le dossier ici (idempotent, 1 syscall au boot, hors hot path) pour que
    // les fabriques de stores fichier disposent d'une base commune (`kernel.varDir`).
    const varPath = path.resolve(this.path, "var");
    fs.mkdirSync(varPath, { recursive: true });
    this.varDir = new FileClass(varPath);

    if (!this.started) {
      await this.fireAsync("onPreStart", this).catch((e) => {
        this.log(e, "CRITIC");
        throw e;
      });
      if (this.setCommandComplete(Events.onPreStart)) {
        return this.finishOrPark(0);
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
            return this.finishOrPark(0);
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

    // Manifest de complétion shell : ICI (et pas avant) les commandes de MODULE sont
    // posées dans commander → dump complet pour le fast-path `__complete` (0 boot au
    // TAB). DEV uniquement (prod cloud-native : FS possiblement read-only, aucune
    // complétion dans un pod) ; fire-and-forget best-effort → coût boot nul, un
    // échec d'écriture n'impacte JAMAIS le boot.
    if (this.resolveRuntimeEnv(this.cli?.environment) === "development") {
      void this.cli?.writeCompletionManifest().catch(() => {});
    }

    if (this.setCommandComplete(Events.onPreRegister)) {
      return this.finishOrPark(0);
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
        // Config validée + gelée pour tous les modules → filet « clé réservée » :
        // avertir si l'app a posé une clé INERTE (le pendant, au boot, du drapeau
        // `reserved` que Studio grise). Après onRegister (options post-Zod), 0 hot path.
        this.warnReservedConfigKeys();
        if (this.setCommandComplete(Events.onRegister)) {
          return this.finishOrPark(0);
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
      return this.finishOrPark(0);
    }
    //return;
    return this.fireLifecycle("onBoot", this)
      .then(() => {
        this.booted = true;
        if (this.setCommandComplete(Events.onBoot)) {
          return this.finishOrPark(0);
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
          // Fige la vérité « serveurs en écoute » + verdict AVANT `onPostReady` :
          // le BootReporter (listener de `onPostReady`) doit lire un report complet.
          this.captureBootServers(servers);
          const report = this.getBootReport();
          this.logBootVerdict(report);
          // Le journal dit ce bilan une fois, au terminal de celui qui lance.
          // Le fichier le rend lisible ensuite — par un agent, une tâche
          // d'intégration continue, ou quiconque arrive après coup.
          this.writeBootSummary(report);
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
              // Fige le journal de boot : après cette ligne le ring syslog
              // mélange boot et runtime — les lectures tardives (Studio,
              // BootReporter différé par Vite) gardent le compte du BOOT.
              this.bootLogCounts = this.countBootLogIssues();
              // Bannières « Server Listen on… » : sautées sous l'écran de boot
              // animé (le bloc « ✓ Prêt » liste déjà les URLs). Affichées sinon
              // (prod / CI / --debug).
              if (!this.suppressBootBanners) {
                servers.map((server) => {
                  server.showBanner();
                });
              }
              // GARDE-FOU 0-serveur : profil serveur attendu mais rien n'écoute →
              // boot raté. On NE laisse PAS le process s'éteindre en exit 0
              // trompeur : `terminate(EX_UNAVAILABLE)` porte un code SÉMANTIQUE,
              // lu par l'orchestrateur (k8s → pod failed) ET le DevSupervisor
              // (message honnête + pas de retry). Cf BootReport.healthy.
              if (!report.healthy && report.serversExpected) {
                return this.terminate(SysExit.UNAVAILABLE);
              }
              if (this.setCommandComplete(Events.onPostReady)) {
                // Profil SERVEUR : les serveurs tiennent le process — ne JAMAIS
                // finir ici (un finishOrPark nu ferait terminate → tuerait le
                // runtime dev/prod fraîchement prêt).
                // Profil CONSOLE arrêté à onPostReady (ex. `security:user:add`,
                // qui attend le service "users" posé à onReady) : one-shot →
                // terminate, daemon → park. SANS ça le process ne finissait
                // JAMAIS (handles du boot vivants — commande faite, process
                // fantôme, vécu). `process.exitCode` posé par la commande
                // (erreur métier) est préservé — terminate(0) l'écraserait.
                if (!this.runProfile.servers) {
                  return this.finishOrPark(
                    typeof process.exitCode === "number" ? process.exitCode : 0,
                  );
                }
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
   * **Le profil d'exécution fait foi** : une commande qui déclare ne pas vouloir
   * de serveur (`runProfile.servers === false`, le défaut console) n'en obtient
   * pas, même si le `HttpKernel` est chargé. Sans cette garde, toute commande
   * poussée jusqu'à `onPostReady` ouvrait les ports par effet de bord — elle
   * échouait alors si un serveur tournait déjà, et refusait le service à celui
   * qui tournait pendant sa brève existence. `onServersReady` n'est pas émis :
   * annoncer des serveurs prêts quand il n'y en a aucun rendrait l'événement
   * inexploitable pour ceux qui l'écoutent.
   *
   * @returns array d'instances de serveurs démarrés (ou `[]`).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async initServers(): Promise<any[]> {
    if (this.runProfile?.servers === false) return [];
    const httpKernel = this.get<HttpKernel>("HttpKernel");
    if (httpKernel)
      return await httpKernel
        .initServers()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(async (servers: any[]) => {
          // ATTENDRE la diffusion `onServersReady` (vs fire-and-forget) garantit
          // que ses listeners (report ORM du BootReporter, sondes cluster…) ont
          // FINI avant d'enchaîner sur `onPostReady`/le récap. Boot-only : le
          // surcoût = la durée (faible) de ces listeners.
          await this.fireAsync("onServersReady");
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
    // oxlint-disable-next-line typescript/no-explicit-any -- arguments variadiques transmis tels quels au constructeur appelé
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
    // Apprend le couple (classe, clé container) — cf. `Module.addService`.
    Injector.rememberContainerKey(service, inst.name);
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
    const res = await import(toImportSpecifier(service));
    return this.addService(res.default, module, ...args);
  }

  /**
   * Charge un module du manifeste. La résolution part de l'APPLICATION
   * ({@link resolveModuleEntry}) et non du paquet `nodefony` : sans cela, un
   * module local de l'app (workspace `modules/*`) est introuvable dès que le core
   * vit hors de l'arbre `node_modules` de l'app (`--link`, monorepo, pnpm).
   */
  async loadModule(moduleName: string): Promise<Module> {
    const moduleClass = await import(resolveModuleEntry(this.path, moduleName));
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
    // Dérogation explicite au gating `policy:"dev"` — pour éprouver un runtime de
    // production AVEC les modules de banc (suite d'intégration, diagnostic « pourquoi
    // ce module manque »). Lue ici et nulle part ailleurs ; jamais silencieuse (cf
    // le WARNING par module ci-dessous) ; sans effet hors production.
    const devModulesForced =
      isProd && process.env[FORCE_DEV_MODULES_ENV] === "1";
    // Reset (défensif si rappelée) : les skips motivés sont re-collectés à chaque
    // résolution — sinon un double appel dupliquerait les entrées du bilan.
    this.modulesGated = null;
    const result: { name: string; config?: Record<string, unknown> }[] = [];
    for (const item of manifest) {
      const entry: IModuleManifestEntry =
        typeof item === "string" ? { name: item } : item;
      if (!entry?.name) {
        continue;
      }
      if (entry.policy === "dev" && isProd) {
        if (devModulesForced) {
          // Dérogation DEMANDÉE : on charge, on le CRIE, et on arme l'auto-arrêt.
          // Un module de banc dans un runtime de production est une surface
          // offerte — que personne ne doit découvrir en lisant les routes.
          this.log(
            `module "${entry.name}" (policy "dev") chargé en PRODUCTION sur ` +
              `${FORCE_DEV_MODULES_ENV}=1 — dérogation explicite, à ne jamais poser sur un déploiement réel`,
            "WARNING",
            "KERNEL",
          );
          this.armDevModulesSelfStop();
        } else {
          this.recordModuleGated(
            entry.name,
            `policy "dev" — runtime production`,
          );
          continue;
        }
      }
      if (typeof entry.when === "function" && !entry.when(this.options)) {
        this.recordModuleGated(
          entry.name,
          "condition when(config) non remplie",
        );
        continue;
      }
      result.push({ name: entry.name, config: entry.config });
    }
    return result;
  }

  /**
   * Enregistre un module volontairement non chargé (gating `policy`/`when`) avec
   * sa raison — surfacé par le bilan de boot ({@link getBootReport}). Lazy : 0
   * allocation si rien n'est gaté.
   *
   * @param module - nom d'entrée du manifeste.
   * @param reason - raison lisible du non-chargement.
   */
  private recordModuleGated(module: string, reason: string): void {
    (this.modulesGated ??= []).push({ module, reason });
    this.log(`MODULE GATED : ${module} — ${reason}`, "DEBUG");
  }

  /**
   * Arme l'auto-arrêt d'un runtime de production ayant dérogé au gating des modules
   * de développement (cf {@link FORCE_DEV_MODULES_ENV}). Idempotent : une seule
   * minuterie, quel que soit le nombre de modules concernés.
   *
   * **L'échéance est ANNONCÉE, deux fois.** Un arrêt temporisé qui surprend est pire
   * que pas de garde-fou : il coupe un banc de charge au milieu d'une mesure, et le
   * journal qu'on relira ensuite accusera le code. On dit donc l'échéance au
   * démarrage — avec le moyen de l'allonger — puis on prévient avant de tomber, et
   * l'arrêt lui-même en donne la raison. Les minuteries sont `unref` : elles
   * n'empêchent jamais une sortie naturelle.
   */
  private armDevModulesSelfStop(): void {
    if (this.devModulesStopTimer) return;
    const ttl = resolveDevModulesTtlMs(process.env);
    const minutes = Math.round(ttl / 60_000);
    this.log(
      `runtime en DÉROGATION (modules dev en production) — arrêt automatique dans ` +
        `${minutes} min. Allonger : ${FORCE_DEV_MODULES_TTL_ENV}=<minutes> ` +
        `(plafond ${Math.round(FORCE_DEV_MODULES_TTL_MAX_MS / 60_000)} min, jamais désarmé)`,
      "WARNING",
      "KERNEL",
    );
    const notice = ttl - 5 * 60_000;
    if (notice > 0) {
      setTimeout(() => {
        this.log(
          `arrêt automatique dans 5 min (dérogation ${FORCE_DEV_MODULES_ENV}) — ` +
            `termine ta mesure ou relance avec ${FORCE_DEV_MODULES_TTL_ENV} plus haut`,
          "WARNING",
          "KERNEL",
        );
      }, notice).unref();
    }
    this.devModulesStopTimer = setTimeout(() => {
      this.log(
        `arrêt automatique : ce runtime tournait en production avec des modules ` +
          `"policy: dev" (${FORCE_DEV_MODULES_ENV}=1). Ce n'est pas une panne — c'est la ` +
          `garde qui empêche une dérogation de banc de survivre à un déploiement`,
        "CRITIC",
        "KERNEL",
      );
      void this.terminate(0);
    }, ttl);
    this.devModulesStopTimer.unref();
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
      try {
        const mod = await this.loadModule(entry.name);
        if (entry.config) {
          // Config colocalisée (`use(name, config)`) : deep-merge sous la config
          // DEFAULT du module fraîchement chargé, AVANT sa validation Zod
          // (`onKernelRegister`). Même sémantique de merge que les overrides legacy
          // `module-<nom>` (`extend(true, {}, …)`) — 1 seule recette de merge.
          mod.options = extend(true, {}, mod.options, entry.config);
          this.log(`MODULE CONFIG (use) : ${entry.name}`, "DEBUG");
        }
      } catch (error) {
        // Résilience PAR-ENTRÉE : un module du manifeste introuvable/périmé
        // (`import()` qui throw « Cannot find package », typiquement un dist
        // racine périmé après pull/merge) ne doit PAS interrompre le chargement
        // des modules SUIVANTS (sinon 1 module masque N autres en silence). On
        // collecte l'échec (verdict de boot) et on continue. La vraie criticité
        // est tranchée en aval par le garde-fou 0-serveur (`onPostReady`) : si un
        // module manquant casse les serveurs → boot `unhealthy` → exit non-zéro.
        const msg = error instanceof Error ? error.message : String(error);
        this.log(
          `MODULE LOAD: échec non bloquant (fail-soft) de "${entry.name}" — ${msg}`,
          "WARNING",
        );
        this.recordBootFailure({
          module: entry.name,
          reason: msg,
          phase: "load",
        });
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
  // oxlint-disable-next-line typescript/no-explicit-any -- arguments variadiques transmis tels quels au constructeur appelé
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
    // Override env générique `NF__<MODULE>__<CHEMIN>` APRÈS le merge de l'app
    // (précédence ADR-0006 D5 : env > app) et AVANT la validation Zod du module.
    this.applyEnvConfigOverrides();
  }

  /**
   * Applique les overrides de config par variable d'environnement générique
   * `NF__<MODULE>__<CHEMIN…>` (ADR-0006 D3) sur la config de chaque module ciblé.
   *
   * Résolu 1× au boot (hors hot path). La surcharge est déposée sur
   * `module.options` → elle sera validée par le schéma Zod du module à
   * `onKernelRegister` (fail-closed si invalide). Un module ou un chemin
   * introuvable est SIGNALÉ (WARNING) sans bloquer le boot — jamais de clé
   * fantôme silencieuse. Les valeurs de chemins « secrets » sont rédigées au log.
   */
  private applyEnvConfigOverrides(): void {
    const overrides = parseNfEnvOverrides(process.env);
    if (!overrides.length) return;
    for (const ov of overrides) {
      const mod = this.findModuleBySegment(ov.moduleSeg);
      if (!mod) {
        const suggestion = closestMatch(ov.moduleSeg, this.moduleSegments());
        this.log(
          `Override env ignoré : module "${ov.moduleSeg}" introuvable (${ov.envKey})` +
            (suggestion ? ` — vouliez-vous dire « ${suggestion} » ?` : ""),
          "WARNING",
        );
        continue;
      }
      const applied = applyResolvedPath(
        mod.options as Record<string, unknown>,
        ov.path,
        ov.value,
      );
      if (applied) {
        const shown = pathLooksSecret(ov.path)
          ? "«***»"
          : JSON.stringify(ov.value);
        this.log(
          `Override env: ${mod.name}.${ov.path.join(".")} = ${shown}`,
          "INFO",
        );
      } else {
        this.log(
          `Override env ignoré : chemin "${ov.path.join(".")}" inconnu sur ${mod.name} (${ov.envKey})` +
            resolveFailureHint(mod.options as Record<string, unknown>, ov.path),
          "WARNING",
        );
      }
    }
  }

  /**
   * Filet « clé réservée » : avertit au BOOT quand une application a posé une clé de
   * config marquée `reserved` (inerte — son levier vit ailleurs) à une valeur
   * non-défaut. C'est le pendant runtime du drapeau que Studio se contente de griser :
   * sans lui, une clé réservée écrite reste un silence total (l'app croit régler un
   * comportement, rien ne se produit, rien ne le dit). Symétrique du signalement des
   * chemins env inconnus ({@link applyEnvConfigOverrides}).
   *
   * Générique — 0 `if` par module : le JSON Schema (`Module.configSchema()`, avec les
   * flags `.meta()`) et la config résolue suffisent. Un module non migré (schéma
   * `null`) est ignoré. Appelé 1× après `onRegister` (options validées) → hors hot
   * path ; le message inclut la `description` du champ, qui nomme la remplaçante.
   */
  private warnReservedConfigKeys(): void {
    for (const name in this.modules) {
      const mod = this.modules[name];
      const schema = mod.configSchema();
      if (!schema) continue;
      const hits = findSetReservedKeys(
        schema,
        mod.options as Record<string, unknown>,
      );
      for (const hit of hits) {
        this.log(
          `Clé de config RÉSERVÉE posée sans effet : ${mod.name}.${hit.path} ` +
            `est inerte.${hit.description ? " " + hit.description : ""}`,
          "WARNING",
          "CONFIG",
        );
      }
    }
  }

  /**
   * Résout un segment de nom de module (minuscule, issu d'un `NF__<MODULE>__…`)
   * vers son instance : compare au **basename** du nom de module (après le `/`),
   * insensible à la casse (`security` → `@nodefony/security`).
   *
   * @param seg - segment module normalisé (minuscule).
   * @returns le module correspondant, ou `undefined`.
   */
  private findModuleBySegment(seg: string): Module | undefined {
    for (const name in this.modules) {
      const slash = name.lastIndexOf("/");
      const base = slash >= 0 ? name.slice(slash + 1) : name;
      if (base.toLowerCase() === seg) return this.modules[name];
    }
    return undefined;
  }

  /**
   * Basenames de tous les modules chargés (segment ciblable par `NF__<MODULE>__…`).
   * Sert au « did you mean » quand le segment module d'un override ne résout pas.
   *
   * @returns la liste des basenames (ex. `security`, `http`).
   */
  private moduleSegments(): string[] {
    const out: string[] = [];
    for (const name in this.modules) {
      const slash = name.lastIndexOf("/");
      out.push(slash >= 0 ? name.slice(slash + 1) : name);
    }
    return out;
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
    const entry = this.resolveAppEntry();
    if (entry === null) {
      return;
    }
    const mod = (await import(toImportSpecifier(entry))) as {
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
      infra: this.infra,
      appEnv,
      runtimeEnv,
      isProd: runtimeEnv === "production",
      isDev: runtimeEnv === "development",
      isTest: runtimeEnv === "test",
    };
  }

  /** Infra déclarée mémoïsés — lazy, `null` tant que non lus. */
  private _infra: IInfra | null = null;

  /**
   * Infra déclarée (`database`/`cache`/`logs`) résolus depuis
   * `process.env` (modèle « infra déclarée », Phase 0.8). Calcul 1 fois, mémoïsé —
   * consommé par le ctx `defineConfig` (`ctx.infra`) et par les briques dont
   * le store vaut `"auto"` (`resolveAutoStore`).
   *
   * @throws Error au premier accès si `NF_DATABASE_URL` a un scheme non
   *   supporté (fail-loud : jamais de repli sqlite silencieux).
   */
  get infra(): IInfra {
    if (this._infra === null) {
      this._infra = resolveInfra(process.env);
    }
    return this._infra;
  }

  /**
   * Registre des résolutions de stores — lazy (`null` tant qu'aucune brique n'a
   * résolu son store). Alloué au premier `registerStoreResolution` (au boot, une
   * fois par brique) — jamais dans le hot-path. Clé = `brick` (dernière gagne).
   */
  private _storeResolutions: Map<string, IStoreResolution> | null = null;

  /**
   * Résolutions EFFECTIVES des stores de persistance capturées au boot — la
   * vérité vécue (replis annoncés inclus). Alimente `/nodefony/kernel/api/stores`
   * et l'écran Studio « Stores ». Vide si aucune brique n'a encore résolu.
   */
  get storeResolutions(): IStoreResolution[] {
    return this._storeResolutions
      ? Array.from(this._storeResolutions.values())
      : [];
  }

  /**
   * Enregistre la résolution effective d'une brique (idempotent par `brick`).
   * La provenance est dérivée de `configured` : la sentinelle `"auto"` ⇒
   * `"infra"` (résolu depuis l'infra déclarée), un backend nommé ⇒ `"explicit"`.
   *
   * @param resolution - triplet brique/configuré/résolu + raison + nature
   *   ({@link IStoreResolution} sans `provenance`, dérivée ici).
   */
  registerStoreResolution(
    resolution: Omit<IStoreResolution, "provenance">,
  ): void {
    if (this._storeResolutions === null) {
      this._storeResolutions = new Map<string, IStoreResolution>();
    }
    this._storeResolutions.set(resolution.brick, {
      ...resolution,
      provenance: resolution.configured === AUTO_STORE ? "infra" : "explicit",
    });
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
      const options = raw.resolve(ctx) as TypeKernelOptions;
      this.surfaceAppEnvOverrides(options);
      return { options, wasDescriptor: true };
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
   * Émet au log le rapport des overrides `NF__APP__*` appliqués à la config app
   * (INFO par override, secret rédigé) + les warnings « did you mean » des chemins
   * non résolus. Appelé APRÈS `resolve()` : le logger kernel est prêt (le merge,
   * lui, tourne dans `resolve()` AVANT le logger → rapport différé, cf defineConfig).
   *
   * @param options - config app résolue (porte le rapport en clé non-énumérable).
   */
  private surfaceAppEnvOverrides(options: unknown): void {
    const report = readAppEnvOverrideReport(options);
    if (!report) return;
    for (const ov of report.applied) {
      this.log(
        `Override env app: ${ov.path.join(".")} = ${ov.secret ? "«***»" : "(env)"}`,
        "INFO",
      );
    }
    for (const w of report.warnings) {
      this.log(w, "WARNING");
    }
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
    // Entrée résolue depuis le package.json de l'app (main, fallback legacy) —
    // même résolution que isTrunk (mémoïsée), ICI a lieu l'unique import réel.
    const appEntry = this.resolveAppEntry() ?? `${this.path}/dist/index.js`;
    try {
      this.app = await this.loadModule(appEntry);
    } catch (e) {
      throw this.bootConfigError(
        "Chargement de l'application impossible",
        `Le point d'entrée \`${appEntry}\` n'a pas pu être importé/évalué.`,
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
    const appModule = (await import(toImportSpecifier(appEntry))) as {
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

  /**
   * Résout le point d'entrée de l'application depuis SON `package.json`
   * (champ `main` — la source de vérité Node), fallback legacy `dist/index.js`
   * puis `index.js`. Vérifie l'EXISTENCE du fichier, sans jamais l'importer :
   * l'exécution (side effects top-level, cache ESM) et la validation du module
   * (export default = `Module`) appartiennent à {@link loadApp}, une seule
   * fois, avec son diagnostic `bootConfigError`. Mémoïsé (stable pour le boot).
   *
   * Anti faux-positif : un projet Node QUELCONQUE (Express…) a aussi un
   * `package.json` + `main` → on exige le signal d'identité Nodefony, sans
   * import : `nodefony` déclaré dans les dépendances, OU installé
   * (`node_modules/nodefony` — couvre le monorepo self-hosted où la racine ne
   * le déclare pas mais où le workspace le symlinke).
   *
   * En production (image Docker), seuls `package.json` + `dist/` +
   * `node_modules` sont déployés : la détection ne dépend d'AUCUN source.
   *
   * @returns chemin absolu de l'entrée, ou `null` (cwd hors projet Nodefony).
   */
  resolveAppEntry(): string | null {
    if (this._appEntry !== undefined) {
      return this._appEntry;
    }
    let pkg: {
      main?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    try {
      pkg = JSON.parse(
        fs.readFileSync(path.resolve(this.path, "package.json"), "utf8"),
      );
    } catch {
      // Pas de package.json lisible = pas un projet Node.
      this._appEntry = null;
      return null;
    }
    const declaresNodefony = Boolean(
      pkg.dependencies?.nodefony ??
      pkg.devDependencies?.nodefony ??
      pkg.peerDependencies?.nodefony,
    );
    if (
      !declaresNodefony &&
      !fs.existsSync(path.resolve(this.path, "node_modules", "nodefony"))
    ) {
      this._appEntry = null;
      return null;
    }
    for (const candidate of pkg.main
      ? [pkg.main]
      : ["dist/index.js", "index.js"]) {
      const abs = path.resolve(this.path, candidate);
      if (fs.existsSync(abs)) {
        this._appEntry = abs;
        return abs;
      }
    }
    this._appEntry = null;
    return null;
  }

  async isTrunk(): Promise<trunkType> {
    const entry = this.resolveAppEntry();
    if (entry === null) {
      return null;
    }
    // Distinction purement informative (aucune logique ne la consomme) :
    // entrée compilée sous dist/ vs entrée JS à la racine.
    return entry.includes(`${path.sep}dist${path.sep}`)
      ? "typescript"
      : "javascript";
  }

  /**
   * Diagnostic fail-loud d'un PROJET Nodefony non bootable — différencie les
   * trois raisons qu'un `resolveAppEntry()` nul confond : « vraiment pas un
   * projet » (→ `null`, wizard/message générique), « dépendances non
   * installées » et « non construit ». Sans lui, un `nodefony dev` dans une
   * app fraîchement générée tombait sur le wizard de création — déroutant
   * alors qu'il ne manque que `npm install` / `npm run build` (vécu).
   *
   * @returns le message actionnable à logger CRITIC, ou `null` si ce dossier
   *   n'est pas un projet Nodefony (le flux hors-projet reste inchangé)
   */
  diagnoseUnbootableProject(): string | null {
    let pkg: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    try {
      pkg = JSON.parse(
        fs.readFileSync(path.resolve(this.path, "package.json"), "utf8"),
      );
    } catch {
      return null;
    }
    const declaresNodefony = Boolean(
      pkg.dependencies?.nodefony ??
      pkg.devDependencies?.nodefony ??
      pkg.peerDependencies?.nodefony,
    );
    if (!declaresNodefony) {
      return null;
    }
    if (!fs.existsSync(path.resolve(this.path, "node_modules"))) {
      return (
        `Projet Nodefony détecté (${this.path}) mais dépendances NON INSTALLÉES.\n` +
        `Lance :\n` +
        `  npm install\n` +
        `  npm run build\n` +
        `puis relance ta commande.`
      );
    }
    return (
      `Projet Nodefony détecté (${this.path}) mais NON CONSTRUIT ` +
      `(aucune entrée d'app : package.json \`main\`, dist/index.js ou index.js).\n` +
      `Lance :\n` +
      `  npm run build\n` +
      `puis relance ta commande.`
    );
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
    // file (fd async PAR worker → pas de contention d'inode en cluster ; garde-fou,
    // le levier mesuré étant la coalescence du ring/tick) | null (bench).
    // FileSink Node-only ; Syslog reste isomorphe.
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
    //    ≠ bus temps réel nodefony:syslog). Le driver `memory` relit le ring buffer
    //    du syslog (source injectée lazy → lit le syslog courant à la query).
    //    Défaut dev ; `file`-JSONL / `elastic`-`loki` (Node-only, LB.2+) = drivers
    //    enregistrés à part. Switch à la volée = action de contrôle dev-only (Studio).
    // Profondeur du ring de relecture : config explicite, sinon 2000 en dev
    // (trace d'une requête lisible malgré le bruit), 100 ailleurs (prod-safe).
    const maxStack =
      logCfg?.maxStack ??
      (this.environment === "development" ? 2000 : undefined);
    if (maxStack) this.syslog?.setMaxStack(maxStack);
    // Défaut `auto` = dérivé de la config : une destination distante déclarée
    // (loki/opensearch — URL montée depuis l'infra logs) impose son driver de
    // relecture (1 knob : l'URL ⇒ le driver) ; les DEUX déclarées sans choix
    // explicite = throw (fail-loud, pas d'arbitrage silencieux). Sinon la vue
    // s'adapte au mode de lancement (mono → `memory` 0 I/O ; worker de cluster
    // → `cluster-file`, vue unifiée cross-worker). Surcharge explicite
    // respectée. Résolution pure + testée (`resolveQueryDriver`).
    const queryDriver = resolveQueryDriver(
      logCfg?.queryDriver,
      cluster.isWorker,
      {
        loki: logCfg?.loki?.url,
        opensearch: logCfg?.opensearch?.url,
      },
    );
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
    // T2 (profil delta vs Express) — gate d'ENTRÉE par sévérité, posé ICI
    // (composition root : env RÉEL + debug RÉSOLU — pas dans Syslog.init(),
    // appelé tôt avec un défaut "production" pollué). En prod sans debug,
    // l'impression filtre déjà `severity <= INFO` → un DEBUG était créé +
    // poussé au ring puis jamais consommé (~1,7 % du profil CPU/req). Le gate
    // le court-circuite AVANT toute allocation. Dev/test/debug : pas de gate
    // (ring complet pour Studio + assertions). Re-résoluble à chaud
    // (syslog.setSeverityThreshold — vision « audit à chaud »).
    this.syslog?.setSeverityThreshold(
      this.environment === "production" && !this.debug ? "INFO" : null,
    );
    // Debug runtime CIBLÉ via env — lu directement comme NODE_ENV/NODEFONY_CLUSTER
    // (knob opérationnel framework, PAS config applicative → hors catalogue
    // env.ts de l'app). `NF__DEBUG=FIREWALL,SESSION:NOTICE` rallume ces modules
    // au boot ; `*` lève le gate global. Pas de TTL : un restart remet à zéro
    // (l'opérateur l'a posé sciemment, persistance souhaitée le temps du run).
    const debugSpec = process.env.NF__DEBUG;
    if (debugSpec && this.syslog) {
      const { global, overrides } = Syslog.parseDebugSpec(debugSpec);
      if (global) {
        this.syslog.setSeverityThreshold(null);
      }
      for (const ov of overrides) {
        this.syslog.setDebugOverride(ov.module, ov.level);
      }
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
   * (`production` OU erreur de **configuration** {@link BootConfigurationError})
   * → on interrompt le boot (le pod crashe, l'orchestrateur le redémarre —
   * cloud-native). Sinon **fail-soft** : WARNING, le boot continue.
   *
   * **Pourquoi la config est fatale même en dev** : le fail-soft protège la DX
   * d'un module optionnel cassé — mais une configuration EXPLICITE non
   * honorable (infra déclarée injoignable, entité non portée sur le dialecte
   * demandé) ne se répare pas en continuant : le serveur « vivant » qui en
   * résulte est un piège (briques durables mortes, login impossible, cause
   * noyée dans un WARNING — vécu). Cf {@link BootConfigurationError}.
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
    phase: "lifecycle" | "init",
  ): boolean {
    const who = owner ?? "(anonyme)";
    const configError = BootConfigurationError.is(error);
    const fatal =
      critical !== false && (this.environment === "production" || configError);
    const msg = error instanceof Error ? error.message : String(error);
    const tag = timedOut ? " [timeout]" : "";
    this.log(
      `boot lifecycle: ${
        fatal
          ? configError
            ? "erreur de CONFIGURATION (boot interrompu)"
            : "échec critique"
          : "échec non bloquant (fail-soft)"
      } de "${who}"${tag} — ${msg}`,
      fatal ? "ERROR" : "WARNING",
    );
    if (this.debug && error instanceof Error && error.stack) {
      this.log(error.stack, "DEBUG");
    }
    // Le développement ANNONCE la sanction de production. Sans cela, le même
    // code a deux comportements — toléré ici, boot interrompu là-bas — et
    // l'écart ne se découvre qu'au déploiement. On n'assouplit PAS la
    // production (un pod à moitié booté est pire qu'un pod qui redémarre) : on
    // rend la conséquence visible AU MOMENT où le code est écrit.
    // `critical === false` est une décision assumée → silence (un avertissement
    // qu'on apprend à ignorer ne protège plus personne).
    if (!fatal && critical !== false) {
      this.log(
        `boot lifecycle: en production, cet échec de "${who}" INTERROMPRAIT le boot` +
          (critical === undefined
            ? ` — ce hook ne porte aucun tag de criticité, et un hook non tagué est` +
              ` traité comme CRITIQUE. S'il vient d'un module (ou d'un de ses` +
              ` services), le poser avec \`module.hookKernel("<event>", …)\` plutôt` +
              ` que \`kernel.once(…)\` : il héritera du nom et de la criticité du` +
              ` module. \`static critical = false\` ne couvre QUE les hooks de` +
              ` classe — un hook posé à la main y échappe.`
            : `.`),
        "WARNING",
      );
    }
    // Fail-soft → agrégé dans le BootReport (le boot continue, mais on garde la
    // trace pour le verdict final : « N modules ignorés (raison) »).
    if (!fatal) {
      this.recordBootFailure({ module: who, reason: msg, phase, timedOut });
    }
    return fatal;
  }

  /**
   * Enregistre un échec de boot **non fatal** (fail-soft) dans le buffer agrégé,
   * alloué paresseusement au premier échec (0 allocation si le boot est nominal).
   *
   * @param failure - module en échec + raison + étape.
   */
  private recordBootFailure(failure: IBootFailure): void {
    (this.bootFailures ??= []).push(failure);
  }

  /**
   * Fige la liste des serveurs **réellement en écoute** à `onPostReady`
   * (`initServers()` ne retourne un serveur qu'une fois son `listen()` résolu).
   * Source de vérité de {@link getBootReport}.
   *
   * @param servers - instances de serveurs retournées par `initServers()`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private captureBootServers(servers: any[]): void {
    if (!servers.length) {
      this.bootServers = [];
      return;
    }
    this.bootServers = servers.map((s) => {
      const type = typeof s?.type === "string" ? s.type : "server";
      const port = Number(s?.port ?? 0);
      const address = typeof s?.address === "string" ? s.address : undefined;
      const scheme = SERVER_SCHEME[type] ?? type;
      // host : adresse de bind résolue (IPv6 entre crochets pour une URL valide).
      const host = address
        ? address.includes(":")
          ? `[${address}]`
          : address
        : "127.0.0.1";
      return {
        type,
        scheme,
        port,
        address,
        url: `${scheme}://${host}:${port}`,
      };
    });
  }

  /**
   * Verdict agrégé du dernier boot (vérité unique, recalculable à la demande pour
   * l'introspection Studio/IA). `healthy=false` ⇒ un profil serveur a fini sans
   * aucun serveur en écoute (garde-fou 0-serveur). Les modules ignorés seuls
   * laissent le boot `healthy` (dégradé mais vivant).
   *
   * @returns le {@link IBootReport}.
   */
  getBootReport(): IBootReport {
    // `bootServers === null` = serveurs PAS ENCORE capturés (boot en cours, `captureBootServers`
    // n'a pas tourné) — à NE PAS confondre avec `[]` = capturés, AUCUN serveur (vrai échec
    // 0-serveur). `booted` passe true dès `onBoot`, AVANT `initServers`/`captureBootServers`
    // (onReady) → sans cette distinction, `healthy` valait false pendant toute la montée des
    // serveurs et `livez.degraded` criait « dégradé » à tort (race vécue sonde DevSupervisor).
    const measured = this.bootServers !== null;
    const serversListening = this.bootServers ?? [];
    const serversExpected = Boolean(this.runProfile?.servers);
    const modulesSkipped = this.bootFailures ?? [];
    // Journal de boot : compte figé à `postReady` (après, le ring mélange boot et
    // runtime) ; à la volée tant que le boot est en cours.
    const { warnings, errors } =
      this.bootLogCounts ?? this.countBootLogIssues();
    const manifestEntries = Array.isArray(this.options.modules)
      ? this.options.modules.length
      : 0;
    return {
      durationMs: this.bootStartedAt > 0 ? Date.now() - this.bootStartedAt : 0,
      modulesLoaded: Object.keys(this.modules),
      manifestEntries,
      modulesSkipped,
      modulesGated: this.modulesGated ?? [],
      warnings,
      errors,
      serversExpected,
      serversListening,
      // Échec 0-serveur jugé UNIQUEMENT une fois la mesure faite (`measured`) : avant, on
      // n'a pas constaté d'absence → pas encore « unhealthy » (le garde-fou de `onReady`
      // lit le report APRÈS `captureBootServers`, donc `measured` y est vrai → inchangé).
      healthy: !(serversExpected && measured && serversListening.length === 0),
      remediation:
        this.bootRemediationHint(
          modulesSkipped,
          manifestEntries,
          serversExpected,
        ) ?? undefined,
    };
  }

  /**
   * Compte les WARNING (severity 4) et les ERROR-et-pire (severity 0-3 :
   * EMERGENCY/ALERT/CRITIC/ERROR) présents dans le ring buffer syslog. Pendant le
   * boot, le ring ne contient QUE des logs de boot → le compte est le « journal
   * du boot ». Borné par la capacité du ring (compte plancher, jamais gonflé).
   *
   * @returns compteurs `{ warnings, errors }`.
   */
  private countBootLogIssues(): { warnings: number; errors: number } {
    let warnings = 0;
    let errors = 0;
    const ring = this.syslog?.ringStack;
    if (ring) {
      for (const pdu of ring) {
        if (pdu.severity === 4) {
          warnings++;
        } else if (pdu.severity >= 0 && pdu.severity <= 3) {
          errors++;
        }
      }
    }
    return { warnings, errors };
  }

  /**
   * Déclare une ligne de détail à afficher SOUS une phase de boot (canal NEUTRE
   * dev-only : le `BootReporter` la rend ; le core ne connaît pas son contenu).
   * Un adapter ORM/frontend/… l'appelle à son hook de phase pour que le boot
   * RACONTE ce qu'il met en place — sans coupler le core au domaine du module.
   *
   * @param phase - libellé de la phase (cf `BootReporter` PHASES, ex. « Services & ORM »).
   * @param line - ligne lisible (ex. « drizzle → sqlite (./var/app.db) »).
   */
  reportBootLine(phase: string, line: string): void {
    const map = (this.bootLines ??= new Map());
    const lines = map.get(phase);
    if (lines) {
      lines.push(line);
    } else {
      map.set(phase, [line]);
    }
  }

  /**
   * REMPLACE les lignes de détail d'une phase (vs {@link reportBootLine} qui
   * AJOUTE). Pour un producteur idempotent invoqué plusieurs fois qui reconstruit
   * la liste complète à chaque appel (ex. le wiring ORM, déclenché par N drivers,
   * itère tout le registre → « dernier gagne »).
   *
   * @param phase - libellé de la phase.
   * @param lines - liste complète des lignes (remplace l'existant ; vide = efface).
   */
  setBootLines(phase: string, lines: string[]): void {
    if (!lines.length) {
      this.bootLines?.delete(phase);
      return;
    }
    (this.bootLines ??= new Map()).set(phase, [...lines]);
  }

  /**
   * Lignes de détail déclarées pour une phase de boot (vide si aucune).
   *
   * @param phase - libellé de la phase.
   * @returns lignes dans l'ordre de déclaration.
   */
  getBootLines(phase: string): string[] {
    return this.bootLines?.get(phase) ?? [];
  }

  /**
   * Action corrective suggérée d'après les raisons d'échec — surfacée dans le
   * verdict (écran + log). Heuristique : un `import()` qui échoue (« Cannot find
   * package/module ») pointe presque toujours un `dist/` périmé après pull/merge.
   *
   * Le manifeste VIDE est traité en premier parce qu'il ne produit aucune raison
   * d'échec : rien n'ayant été tenté, `skipped` est vide et l'heuristique
   * suivante n'a rien à lire. C'est précisément l'état qui laissait le diagnostic
   * muet — il faut donc le nommer ici, à défaut de pouvoir le déduire.
   *
   * Le manifeste vide n'est signalé que sous un profil SERVEUR : une commande
   * batch ou un test qui boote sans manifeste est un cas nominal, et une
   * remédiation posée là serait un faux diagnostic recopié partout où le rapport
   * est lu.
   *
   * @param skipped - modules ignorés.
   * @param manifestEntries - entrées déclarées au manifeste `config.modules`.
   * @param serversExpected - le profil d'exécution attendait-il des serveurs.
   * @returns une phrase d'action, ou `null`.
   */
  private bootRemediationHint(
    skipped: IBootFailure[],
    manifestEntries: number,
    serversExpected: boolean,
  ): string | null {
    if (serversExpected && manifestEntries === 0) {
      return (
        "la configuration LUE ne déclare aucun module (`modules: []`) ⇒ " +
        "vérifier `nodefony.config` et l'exécutable employé " +
        "(`nodefony inspect config` dit la config effective et sa provenance)"
      );
    }
    const moduleNotFound = skipped.some((f) =>
      /Cannot find package|Cannot find module|ERR_MODULE_NOT_FOUND/i.test(
        f.reason,
      ),
    );
    if (moduleNotFound) {
      return "dist périmé probable ⇒ npm run clean && npm run build";
    }
    return null;
  }

  /**
   * Log structuré du verdict de boot — émis **toujours** (prod incluse), donc
   * indépendant du `BootReporter` (qui n'existe qu'en dev). En non-TTY/prod c'est
   * la seule trace écran ; en dev TTY animé le sink est muté → va au backplane,
   * et le `BootReporter` rend le verdict joli (✓/⚠/⛔).
   *
   * @param report - verdict à logger.
   */
  private logBootVerdict(report: IBootReport): void {
    const skipped = report.modulesSkipped;
    if (!report.healthy) {
      const reasons = skipped
        .map((f) => `${f.module}: ${f.reason}`)
        .join(" · ");
      // Ce que la config DEMANDAIT, toujours — pas seulement ce qui a raté. Un
      // boot où rien n'a été tenté ne remplit aucune des listes d'échec : sans ce
      // décompte, le verdict décrit une absence de serveurs sans jamais dire que
      // le manifeste était vide, et l'enquête part vers les serveurs.
      this.log(
        `BOOT ÉCHEC — profil serveur mais aucun serveur en écoute` +
          ` · manifeste : ${report.manifestEntries} module(s) déclaré(s), ` +
          `${report.modulesLoaded.length} chargé(s)` +
          (skipped.length
            ? ` · ${skipped.length} module(s) en échec : ${reasons}`
            : "") +
          (report.remediation ? ` — ${report.remediation}` : ""),
        "CRITIC",
      );
      return;
    }
    if (skipped.length) {
      this.log(
        `BOOT dégradé — ${report.modulesLoaded.length} module(s) chargé(s), ` +
          `${skipped.length} en échec (fail-soft) : ` +
          skipped.map((f) => `${f.module} (${f.reason})`).join(" · "),
        "WARNING",
      );
      return;
    }
    const urls = report.serversListening.map((s) => s.url).join(", ");
    const gated = report.modulesGated.length
      ? `, ${report.modulesGated.length} ignoré(s) (policy/when)`
      : "";
    const journal =
      report.warnings || report.errors
        ? ` · journal : ${report.errors} ERROR, ${report.warnings} WARNING`
        : "";
    this.log(
      `BOOT ok — ${report.modulesLoaded.length} module(s)${gated}, ` +
        `${report.serversListening.length} serveur(s) en écoute` +
        (urls ? ` (${urls})` : "") +
        journal,
      "NOTICE",
    );
    // Garde-fou observabilité MULTI-POD (honnêteté, pas de magie) — émis ICI (boot
    // complet, logging pleinement opérationnel), pas dans initializeLog (trop tôt).
    // En Kubernetes, un driver de vue LOCAL (memory/file/cluster-file) ne relit que
    // CE pod ; le nombre de replicas n'est pas connu du process et la destination
    // d'agrégation (Loki/OpenSearch) est un secret d'infra (12-factor) → on AVERTIT,
    // on ne choisit pas. NOTICE (pas WARNING) car mono-pod = faux positif toléré.
    const logCfg = this.options.log;
    if (
      shouldWarnPerPodView(
        isInKubernetes(),
        getActiveLogDriver()?.name,
        Boolean(logCfg?.loki?.url || logCfg?.opensearch?.url),
      )
    ) {
      this.log(
        `Kubernetes détecté + log.queryDriver="${getActiveLogDriver()?.name}" ` +
          `(vue PAR POD) : la relecture des logs ne couvre que CE pod. En multi-pod ` +
          `(replicas > 1), configure log.queryDriver="loki"|"opensearch" (+ URL) ` +
          `pour une vue globale.`,
        "NOTICE",
        "SYSLOG",
      );
    }
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
  async fireLifecycle(
    event: KernelEventsType,
    // oxlint-disable-next-line typescript/no-explicit-any -- arguments variadiques d'un événement de cycle de vie — leur forme dépend de l'événement
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
          const { owner, critical, name } = readListenerTags(info.listener);
          if (
            this.isBootErrorFatal(
              error,
              // `owner` (le module) d'abord ; à défaut le nom de la fonction —
              // un hook posé à la main n'a pas de propriétaire, mais il a
              // souvent un nom, et c'est tout ce qui permettra de le retrouver.
              owner ?? name,
              critical,
              info.timedOut,
              "lifecycle",
            )
          ) {
            fatalError = error;
            hasFatal = true;
            return true; // stoppe la chaîne lifecycle (le reste ne boote pas)
          }
          return; // fail-soft : on continue les autres modules
        },
        onListenerSlow: (info: IGuardedListenerInfo) => {
          const { owner, name } = readListenerTags(info.listener);
          this.log(
            `boot lifecycle: hook "${owner ?? name ?? "(anonyme)"}" lent ` +
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
    owner: Module<unknown> | Kernel,
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
   * Applique la politique de criticité du boot à l'échec d'un service déclaré via
   * `@services([...])` — **construction (`new`) comprise**, pas seulement `init`.
   * Pendant symétrique de {@link guardServiceInitialize} pour le chemin décorateur.
   *
   * @remarks Le `catch` du décorateur `@services` avalait auparavant TOUT échec
   *   (`log(e, "ERROR")` et rien d'autre) : il n'atteignait ni cette politique —
   *   donc jamais fatal, **même en production** — ni le {@link getBootReport}, si
   *   bien qu'un boot amputé d'un service critique se déclarait « UP ». Un service
   *   qu'on ne peut pas CONSTRUIRE doit suivre exactement la règle de celui qu'on
   *   ne peut pas INITIALISER.
   *
   * @param error - l'échec remonté par `addService`/`loadService`.
   * @param serviceName - nom lisible (pour le log + le BootReport).
   * @param critical - criticité du module porteur ({@link Module.critical}).
   * @returns `true` si l'échec est fatal → l'appelant **doit** propager.
   */
  serviceBootErrorFatal(
    error: unknown,
    serviceName: string,
    critical: boolean,
  ): boolean {
    return this.isBootErrorFatal(error, serviceName, critical, false, "init");
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
      if (this.isBootErrorFatal(error, owner, critical, timedOut, "init")) {
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
   * Le drain complet (`fireAsync("onTerminate")` : bascule readiness → close WS
   * 1001 → drain HTTP → cleanup services) est borné par la deadline GLOBALE
   * `shutdownDeadline` (défaut 15 s, < grace period orchestrateur) : un listener
   * qui pend (SSE ouvert, store bloqué, module tiers) force la sortie code 1 —
   * jamais un process zombie qui attend le SIGKILL externe. `0` = filet désactivé.
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
    // Rejet du drain capturé ICI (pas dans un try du race) : si la deadline
    // gagne, un rejet ultérieur du drain serait un unhandledRejection.
    const drain = this.fireAsync("onTerminate", this, code).catch(
      (e: unknown) => {
        this.log(e, "ERROR");
        return SHUTDOWN_DRAIN_ERROR;
      },
    );
    const deadlineMs =
      (this.options as TypeKernelOptions).shutdownDeadline ??
      DEFAULT_SHUTDOWN_DEADLINE;
    let raced: unknown;
    if (deadlineMs > 0) {
      let deadlineTimer: NodeJS.Timeout | null = null;
      raced = await Promise.race([
        drain,
        new Promise((resolve) => {
          deadlineTimer = setTimeout(
            () => resolve(SHUTDOWN_DEADLINE),
            deadlineMs,
          );
          // Ne retient pas l'event-loop si le drain finit avant (clearTimeout
          // en défense, mais un one-shot CONSOLE ne doit pas rester vivant).
          deadlineTimer.unref();
        }),
      ]);
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
      }
    } else {
      raced = await drain;
    }
    if (raced === SHUTDOWN_DEADLINE) {
      this.log(
        `shutdown deadline exceeded (${deadlineMs} ms) — forcing exit, onTerminate listeners still pending`,
        "CRITIC",
      );
      code = 1;
    } else if (raced === SHUTDOWN_DRAIN_ERROR) {
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
