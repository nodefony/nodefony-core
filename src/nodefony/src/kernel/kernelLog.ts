/**
 * Montage du journal du noyau — sink, drivers du Log Backplane, transports
 * d'écriture, seuils de sévérité. Famille LOG de `Kernel.ts`, détenue par
 * COMPOSITION : le Kernel porte une instance (`logSetup`), allouée au premier
 * `initializeLog` et conservée ensuite.
 *
 * **Pourquoi conservée** : `initializeLog` est ré-entrant (logger précoce dans
 * `start()`, puis re-init avec la config app dans `loadApp()`). La classe porte
 * les transports montés au passage précédent, pour les retirer AVANT d'en
 * monter de nouveaux — sinon chaque `FileTransport` s'accumule et chaque log est
 * écrit N fois dans le JSONL.
 *
 * Ce module ne porte AUCUN autre état du noyau : `syslog`, `options`, `debug`,
 * `environment`, `isTTY` et `cli` restent des champs du Kernel, lus (et, pour
 * `debug`, posé) à l'APPEL au travers de {@link ILogHost}.
 *
 * Module FEUILLE à l'exécution : le seul import de `./Kernel` est un
 * `import type`, effacé à la compilation.
 */
import path from "node:path";
import cluster from "node:cluster";
import Syslog, { NULL_LOG_SINK } from "../syslog/Syslog";
import { FileSink } from "../syslog/sinks/FileSink";
import { resolveColorEnabled, setLogColor } from "../syslog/logColor";
import {
  registerLogDriver,
  setActiveLogDriver,
  getLogDriverFactory,
  listLogDriverFactories,
  type ILogDriverContext,
} from "../syslog/drivers/logDriverRegistry";
import {
  registerBuiltinLogDrivers,
  resolveQueryDriver,
} from "../syslog/drivers/builtinLogDrivers";
import { DEFAULT_LOG_DIR } from "../service/dev/devProcess";
import type { ITransport } from "../types/ITransport";
import type { DebugType, EnvironmentType } from "../types/globals";
import type { TypeKernelOptions } from "./Kernel";

/**
 * Ce que le montage du journal demande au noyau, et rien de plus. Tout est lu à
 * l'APPEL (jamais capturé à la construction) : l'environnement, le verdict TTY
 * et la config de log peuvent changer entre deux passages. `Kernel` satisfait
 * cette forme structurellement.
 */
export interface ILogHost {
  /** Options du noyau — seule la section `log` est lue. */
  readonly options: Pick<TypeKernelOptions, "log">;
  /** Journal du noyau (hérité de `Service`) ; `null` une fois le service nettoyé. */
  readonly syslog: Syslog | null;
  /** Environnement courant — pilote la profondeur du ring, les drivers montés et le seuil. */
  readonly environment: EnvironmentType;
  /** Verdict terminal du noyau (famille SUP) — base de la couleur ANSI. */
  readonly isTTY: boolean;
  /**
   * Nom du paquet de l'application, `undefined` tant qu'il n'est pas lu — il
   * étiquette les destinations distantes (deux applications d'un même Loki ne
   * se confondent pas).
   */
  readonly appName: string | undefined;
  /**
   * Verbosité du noyau. Écrite ICI une seule fois : la config `log.debug` ne la
   * pose que sans CLI et si rien ne l'a déjà posée (la CLI prime).
   */
  debug: DebugType;
  /** CLI attachée au noyau, ou `null` en mode programmatique. */
  readonly cli: {
    initSyslog(environment?: EnvironmentType, debug?: DebugType): void | null;
  } | null;
  /** Démarrage de la sortie console du Syslog quand aucune CLI n'est attachée. */
  initSyslog(environment?: EnvironmentType, debug?: DebugType): void | null;
}

/**
 * Monte le journal du noyau, et se souvient des transports qu'il a montés.
 *
 * Verrouillé par `tests/kernelLog.test.ts`.
 */
export class KernelLogSetup {
  /**
   * Transports d'ÉCRITURE montés par {@link initialize} (drivers du Log
   * Backplane) — SEUL propriétaire. Retirés AVANT d'en monter de nouveaux : la
   * dédup d'`addTransport` se fait par nom, `removeAllListeners` ne touche pas
   * `_transports`. Lazy (`null` tant qu'aucun transport monté).
   */
  #mountedTransports: ITransport[] | null = null;

  private readonly host: ILogHost;

  /**
   * @param host - le noyau, lu à chaque appel de {@link initialize}.
   */
  constructor(host: ILogHost) {
    this.host = host;
  }

  /**
   * Monte (ou remonte) le journal : démonte d'abord les transports du passage
   * précédent, puis pose le sink, les drivers du backplane, le seuil de
   * sévérité, et termine par le démarrage de la sortie console.
   *
   * @returns le résultat de `initSyslog` (CLI si attachée, noyau sinon) ;
   *   `undefined` quand la config désactive le journal.
   */
  initialize(): void | null {
    const host = this.host;
    host.syslog?.removeAllListeners();
    // Idempotence des transports d'écriture : `removeAllListeners` ne touche QUE
    // les listeners EventEmitter, PAS le tableau `_transports`. Retirer ceux que
    // ce même montage a posés au passage précédent (cf champ doc).
    if (this.#mountedTransports !== null) {
      for (const t of this.#mountedTransports) {
        host.syslog?.removeTransport(t);
      }
      this.#mountedTransports = null;
    }

    if (host.options.log && !host.options.log.active) {
      return;
    }
    // Bufférisation de la sortie console (process-global) — coalesce les writes
    // d'un même tick en 1 syscall sous forte concurrence. "auto" (défaut) =
    // bufférise hors TTY (pipe/fichier = prod/collecteur), immédiat sur TTY
    // (dev). Cf Syslog.setOutputBuffering + config.log.buffered.
    const logCfg = host.options.log;
    Syslog.setOutputBuffering(logCfg?.buffered ?? "auto");
    // Forme des lignes (process-global, comme la bufférisation) : `json` = ce
    // qu'un collecteur transporte vers Loki/OpenSearch, et ce que leur relecture lit.
    Syslog.setLineFormat(logCfg?.format ?? "text");
    // Couleur ANSI des logs — résolue UNE fois ici (boot) à partir de `isTTY`
    // (déjà résolu, NF_NO_TTY-aware — PAS de re-lecture de process.stdout), augmenté
    // des conventions NO_COLOR (no-color.org) + FORCE_COLOR. pipe/fichier = brut →
    // 0 ANSI baké (stdout pipe + .jsonl propres). 0 test par log ensuite.
    setLogColor(resolveColorEnabled(host.isTTY));
    // Répertoire des logs — SOURCE UNIQUE : sink `.log` (LB.W) + JSONL queryable
    // (LB.2/5) + viewer Studio. Configurable `log.dir` (défaut "logs"), sous cwd.
    const logDirAbs = path.resolve(
      process.cwd(),
      logCfg?.dir ?? DEFAULT_LOG_DIR,
    );
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
      (host.environment === "development" ? 2000 : undefined);
    if (maxStack) host.syslog?.setMaxStack(maxStack);
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
    // via `registerLogDriverFactory`. Le montage ne fait que RÉSOUDRE + BRANCHER.
    registerBuiltinLogDrivers();
    const driverCtx: ILogDriverContext = {
      logCfg,
      environment: host.environment,
      logDir: logDirAbs,
      pid: process.pid,
      appName: host.appName,
      getRingStack: () => host.syslog?.ringStack ?? [],
    };
    // Drivers à monter : l'ACTIF demandé + `memory` (toujours présent = fallback sûr) +
    // en DÉVELOPPEMENT les drivers fichier (switchables à chaud depuis Studio — on les
    // ENREGISTRE en plus, l'actif reste `queryDriver`). En prod = opt-in strict (12-factor :
    // destination figée, pas d'I/O « au cas où »). `writeKey` déduplique le transport
    // d'écriture partagé (file ↔ cluster-file = même JSONL par worker → branché 1×).
    const toMount = new Set<string>(["memory", queryDriver]);
    if (host.environment === "development") {
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
          host.syslog?.addTransport(mount.transport);
          (this.#mountedTransports ??= []).push(mount.transport);
          if (key !== undefined) addedWrites.add(key);
        }
      }
    }
    // Relecture seule IMPLICITE (production sans `write` déclaré) : le dire au
    // démarrage, sinon une URL posée qui n'envoie plus rien serait inexplicable.
    if (host.environment === "production") {
      for (const name of ["loki", "opensearch"] as const) {
        const dest = logCfg?.[name];
        if (dest?.url && dest.write === undefined) {
          host.syslog?.log(
            `${name} en relecture seule (défaut de production) : l'application n'y envoie pas ses journaux, un collecteur doit lire sa sortie standard (log.format "json"). Pour qu'elle les envoie elle-même : log.${name}.write = true (NF_LOG_PUSH=true dans une application générée).`,
            "NOTICE",
            "SYSLOG",
          );
        }
      }
    }
    try {
      setActiveLogDriver(queryDriver);
    } catch {
      // Driver configuré non enregistré (ex. "elastic" sans son module) → fallback
      // "memory" (toujours présent) + avertissement. Jamais de crash au boot.
      host.syslog?.log(
        `Log query driver "${queryDriver}" introuvable — fallback "memory".`,
        "WARNING",
        "SYSLOG",
      );
      setActiveLogDriver("memory");
    }
    // CLI prend la priorité absolue sur la config.
    // La config log.debug n'est utilisée qu'en mode programmatique (sans CLI).
    if (!host.cli && !host.debug && host.options.log?.debug) {
      host.debug = host.options.log.debug;
    }
    // T2 (profil delta vs Express) — gate d'ENTRÉE par sévérité, posé ICI
    // (composition root : env RÉEL + debug RÉSOLU — pas dans Syslog.init(),
    // appelé tôt avec un défaut "production" pollué). En prod sans debug,
    // l'impression filtre déjà `severity <= INFO` → un DEBUG était créé +
    // poussé au ring puis jamais consommé (~1,7 % du profil CPU/req). Le gate
    // le court-circuite AVANT toute allocation. Dev/test/debug : pas de gate
    // (ring complet pour Studio + assertions). Re-résoluble à chaud
    // (syslog.setSeverityThreshold — vision « audit à chaud »).
    host.syslog?.setSeverityThreshold(
      host.environment === "production" && !host.debug ? "INFO" : null,
    );
    // Debug runtime CIBLÉ via env — lu directement comme NODE_ENV/NF_CLUSTER
    // (knob opérationnel framework, PAS config applicative → hors catalogue
    // env.ts de l'app). `NF__DEBUG=FIREWALL,SESSION:NOTICE` rallume ces modules
    // au boot ; `*` lève le gate global. Pas de TTL : un restart remet à zéro
    // (l'opérateur l'a posé sciemment, persistance souhaitée le temps du run).
    const debugSpec = process.env.NF__DEBUG;
    if (debugSpec && host.syslog) {
      const { global, overrides } = Syslog.parseDebugSpec(debugSpec);
      if (global) {
        host.syslog.setSeverityThreshold(null);
      }
      for (const ov of overrides) {
        host.syslog.setDebugOverride(ov.module, ov.level);
      }
    }
    if (host.cli) {
      return host.cli.initSyslog(host.environment, host.debug);
    } else {
      return host.initSyslog(host.environment, host.debug);
    }
  }
}
