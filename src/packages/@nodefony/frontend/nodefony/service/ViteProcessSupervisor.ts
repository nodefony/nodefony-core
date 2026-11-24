import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import {
  DEV_VITE_PREFIX,
  GENERATED_VITE_CONFIG_FILE,
  HeldHost,
  type HeldOutputStream,
  type IHeldHostStatus,
} from "nodefony";
import type {
  IViteSupervisor,
  IViteSupervisorStatus,
} from "../interfaces/IViteSupervisor";
import type { IResolvedFrontendEntry } from "../interfaces/IFrontBuilder";
import { FrontendSupervisorStartError } from "../src/errors/FrontendError";
import ViteConfigGenerator from "./ViteConfigGenerator";
import { parseViteHostLine, type IViteHostSpec } from "./viteHost";

/**
 * Hôte JOIGNABLE pour une adresse d'écoute : `0.0.0.0`/`::` désignent toutes
 * les interfaces, pas une destination — s'y connecter échoue sous Windows. Le
 * proxy inverse joint Vite depuis la machine qui le lance : la boucle locale
 * est alors toujours juste.
 *
 * @param listenHost - adresse d'écoute (`devHost`)
 * @returns l'hôte à joindre
 */
export function browserReachableHost(listenHost: string): string {
  return listenHost === "0.0.0.0" ||
    listenHost === "::" ||
    listenHost === "[::]" ||
    listenHost === ""
    ? "127.0.0.1"
    : listenHost;
}

/**
 * Le module hôte, à côté de ce fichier : `viteHost.js` dans le paquet bâti,
 * `viteHost.ts` sous les tests (Node le lance en retirant ses types). Décidé
 * sur l'extension de CE module — sans lecture disque.
 */
const VITE_HOST_MODULE = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".ts") ? "./viteHost.ts" : "./viteHost.js",
    import.meta.url,
  ),
);

/**
 * Logger minimal — injecté par FrontendService pour piper les logs Vite
 * dans le syslog Nodefony sans dépendance dure sur Service.
 */
export interface IViteSupervisorLogger {
  info(msg: string): void;
  error(msg: string): void;
  /** Avertissement de Vite. Absent → la ligne part en `info`, jamais en `error`. */
  warn?(msg: string): void;
  debug?(msg: string): void;
}

export interface ViteSupervisorOptions {
  readonly devHost: string;
  readonly devPort: number;
  /**
   * Famille d'isolation (`default`, `angular`) : clé du service tenu et préfixe
   * des journaux de son hôte. Défaut `default`.
   */
  readonly family?: string | undefined;
  /**
   * Chemin de base Vite de l'instance (`devBasePath(famille)`) — émis comme
   * `base` dans la config générée, rendu par `status().base`.
   */
  readonly devBase?: string | undefined;
  readonly startupTimeoutMs: number;
  readonly pipeLogs: boolean;
  readonly cwd: string;
  readonly logger: IViteSupervisorLogger;
  /**
   * Certificats à utiliser si Vite doit servir en HTTPS. Paths absolus vers les
   * fichiers PEM — les mêmes que Nodefony utilise pour son `server-https` (5152).
   */
  readonly https?:
    | {
        readonly keyPath: string;
        readonly certPath: string;
      }
    | undefined;
  /** Valeur de `NODE_ENV` et mode Vite — généralement `kernel.environment`. */
  readonly nodeEnv?: string | undefined;
  /**
   * Variables d'env additionnelles passées à l'hôte. Les clés `VITE_*` sont
   * exposées au navigateur via `import.meta.env`.
   */
  readonly extraEnv?: Record<string, string>;
  // ─────────────────────────────────────────────────────────────────────────
  // Résilience — portée par le teneur `HeldHost` (cœur)
  // ─────────────────────────────────────────────────────────────────────────
  /** Relance après un plantage (défaut `true`) ; `false` = aucune relance. */
  readonly autoRestart?: boolean;
  /** Relances avant d'abandonner (défaut `5`). */
  readonly maxRestarts?: number;
  /** Recul initial, doublé à chaque relance (défaut `500` ms). */
  readonly restartBackoffBaseMs?: number;
  /** Plafond du recul (défaut `8000` ms). */
  readonly restartBackoffMaxMs?: number;
  /**
   * Période de la preuve de vie (défaut `30000` ms) ; `0` la coupe. Le teneur
   * envoie un `ping` par le canal : une boucle d'évènements gelée — celle de
   * Vite, puisqu'il tourne DANS l'hôte — ne répond plus.
   */
  readonly healthCheckIntervalMs?: number;
  /** Preuves manquées d'affilée avant de tuer l'hôte (défaut `3`). */
  readonly healthCheckFailureThreshold?: number;
  /** Une réponse plus tardive compte comme manquée (défaut `5000` ms). */
  readonly healthCheckTimeoutMs?: number;
  /** Replis sur le port suivant quand le port est pris (défaut `3`). */
  readonly portRetryAttempts?: number;
}

/** Un titre de process sûr : imprimable, sans espace, borné (cf `viteHost.ts`). */
function processTitle(entries: ReadonlyArray<IResolvedFrontendEntry>): string {
  const names = entries
    .map((e) => e.entryName)
    .join("+")
    .replace(/[^\x21-\x7e]/g, "_");
  return `${DEV_VITE_PREFIX}[${names}]`.slice(0, 200);
}

/** Lit un entier d'une donnée d'état rapportée par l'hôte. */
function readCount(data: IHeldHostStatus["data"], key: string): number | null {
  const value = data?.[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

/**
 * Le superviseur Vite d'une famille — ADAPTATEUR `IViteSupervisor` sur le
 * teneur `HeldHost` du cœur (ADR-0030 §D2).
 *
 * Vite tourne dans un HÔTE (`viteHost.ts`) qui le pilote par son API : « prêt »
 * et le port réel arrivent par le canal `nf-held`, jamais en lisant la sortie de
 * Vite. Lancement, recul de relance, preuve de vie, arrêt de l'arbre et attente
 * de sa mort sont ceux du teneur — SEULE implémentation de ce cycle. Il reste
 * ici : écrire la config, composer la spécification, rendre un instantané au
 * format `IViteSupervisorStatus`, relayer les journaux.
 */
export class ViteProcessSupervisor implements IViteSupervisor {
  readonly #opts: ViteSupervisorOptions;
  readonly #family: string;
  readonly #generator = new ViteConfigGenerator();
  #held: HeldHost | null = null;
  #entries: ReadonlyArray<IResolvedFrontendEntry> = [];
  #portRetries = 0;
  /** L'hôte a-t-il été prêt depuis le dernier `start()` ? (journal des pannes) */
  #wasReady = false;
  #startPromise: Promise<void> | null = null;
  /** Instantané figé, remplacé en bloc à chaque changement d'état du teneur. */
  #snapshot: IViteSupervisorStatus;

  constructor(opts: ViteSupervisorOptions) {
    this.#opts = opts;
    this.#family = opts.family ?? "default";
    this.#snapshot = this.#compose(null);
  }

  /**
   * Démarre l'hôte et attend Vite prêt. Idempotent : prêt → rien ; démarrage en
   * cours → la même promesse.
   *
   * @throws FrontendSupervisorStartError si Vite n'a pas pu démarrer.
   */
  start(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    _viteConfigUnused: Record<string, unknown>,
  ): Promise<void> {
    const state = this.#snapshot.state;
    if (state === "ready") return Promise.resolve();
    if (this.#startPromise) return this.#startPromise;
    if (state === "stopping") {
      return Promise.reject(
        new FrontendSupervisorStartError("cannot start while stopping"),
      );
    }
    if (entries.length === 0) {
      return Promise.reject(new FrontendSupervisorStartError("no entries"));
    }
    this.#startPromise = this.#start(entries).finally(() => {
      this.#startPromise = null;
    });
    return this.#startPromise;
  }

  /** Arrête l'hôte et attend la mort de son arbre. Idempotent. */
  async stop(): Promise<void> {
    const state = this.#snapshot.state;
    if (this.#held === null || state === "idle" || state === "stopped") return;
    await this.#held.stop();
  }

  /** L'instantané courant — lecture de champ, sans allocation (ADR-0030 §D5). */
  status(): IViteSupervisorStatus {
    return this.#snapshot;
  }

  async #start(entries: ReadonlyArray<IResolvedFrontendEntry>): Promise<void> {
    this.#entries = entries;
    this.#portRetries = 0;
    this.#wasReady = false;
    const configFile = await this.#writeConfig(entries);
    // Un teneur par démarrage : sa spécification (config, titre) en dépend. Le
    // précédent (démarrage raté, relances épuisées) n'a plus d'hôte vivant —
    // l'arrêter ne coûte rien et ne laisse rien derrière.
    await this.#held?.stop();
    const spec = {
      family: this.#family,
      configFile,
      host: this.#opts.devHost,
      port: this.#opts.devPort,
      portRetryAttempts: this.#opts.portRetryAttempts ?? 3,
      mode: this.#opts.nodeEnv ?? null,
      title: processTitle(entries),
    } satisfies IViteHostSpec;
    const held = new HeldHost({
      key: `vite:${this.#family}`,
      module: VITE_HOST_MODULE,
      spec,
      cwd: this.#opts.cwd,
      env: {
        ...process.env,
        ...(this.#opts.nodeEnv ? { NODE_ENV: this.#opts.nodeEnv } : {}),
        ...this.#opts.extraEnv,
        // Le journal part au syslog : ni couleur (picocolors en met même
        // dans un tube sous Windows), ni séquence à assainir.
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      startupTimeoutMs: this.#opts.startupTimeoutMs,
      maxRestarts:
        this.#opts.autoRestart === false ? 0 : (this.#opts.maxRestarts ?? 5),
      restartBackoffBaseMs: this.#opts.restartBackoffBaseMs ?? 500,
      restartBackoffMaxMs: this.#opts.restartBackoffMaxMs ?? 8_000,
      livenessIntervalMs: this.#opts.healthCheckIntervalMs ?? 30_000,
      livenessMissedLimit: this.#opts.healthCheckFailureThreshold ?? 3,
      livenessTimeoutMs: this.#opts.healthCheckTimeoutMs ?? 5_000,
      // Sans lecteur, le teneur FERME les sorties de l'hôte (un tube jamais lu
      // se remplit et bloque l'écrivain) : rien n'est lu pour rien.
      ...(this.#opts.pipeLogs ? { onOutput: this.#relay } : {}),
      onStatus: (status) => this.#onStatus(status),
    });
    this.#held = held;
    try {
      await held.start();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new FrontendSupervisorStartError(reason, error);
    }
  }

  /**
   * Écrit `vite.config.generated.mjs` à côté de l'`index.html` — SEULEMENT si
   * son texte change. Vite surveille son fichier de config et redémarre à la
   * moindre écriture, même identique : réécrire à chaque démarrage relancerait
   * un Vite qu'on cherche justement à garder chaud.
   *
   * @returns le chemin absolu du fichier.
   */
  async #writeConfig(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
  ): Promise<string> {
    // `start()` refuse une liste vide : ce repli ne sert qu'au type.
    const [first] = entries;
    if (first === undefined)
      throw new FrontendSupervisorStartError("no entries");
    const file = path.resolve(first.root, GENERATED_VITE_CONFIG_FILE);
    const content = this.#generator.toMjs(entries, "development", {
      devBase: this.#opts.devBase,
      https: this.#opts.https,
    });
    const current = await readFile(file, "utf8").catch(() => null);
    if (current !== content) {
      await writeFile(file, content, "utf8");
      this.#opts.logger.debug?.(`vite config written: ${file}`);
    }
    return file;
  }

  /** Recompose l'instantané et journalise ce qui mérite de l'être. */
  #onStatus(status: IHeldHostStatus): void {
    const log = this.#opts.logger;
    if (status.state === "ready") {
      this.#portRetries = readCount(status.data, "portRetries") ?? 0;
      const port = readCount(status.data, "port");
      if (status.restartCount > 0) {
        log.info(`vite relancé (#${status.restartCount}) sur le port ${port}`);
      } else if (this.#portRetries > 0) {
        log.info(
          `port ${this.#opts.devPort} déjà occupé — Vite sur le port ${port}`,
        );
      }
      this.#wasReady = true;
    } else if (this.#wasReady) {
      // Avant le premier `ready`, l'échec appartient à `start()`, qui le lève
      // et que l'appelant journalise : le dire aussi ici le dirait deux fois.
      if (status.state === "crashed" || status.state === "errored") {
        log.error(status.lastError ?? `vite ${status.state}`);
      } else if (status.state === "restarting") {
        log.info(`vite : relance #${status.restartCount}`);
      }
    }
    this.#snapshot = this.#compose(status);
  }

  /** L'instantané au format `IViteSupervisorStatus`, figé. */
  #compose(status: IHeldHostStatus | null): IViteSupervisorStatus {
    const ready = status?.state === "ready";
    // 🔴 Le port qui SERT, jamais celui qu'on espère : `null` tant que Vite
    // n'est pas prêt. Rendre le port demandé faisait annoncer à une 2ᵉ
    // application le port de la 1ʳᵉ.
    const port = ready ? readCount(status.data, "port") : null;
    const scheme = this.#opts.https ? "https" : "http";
    return Object.freeze({
      state: status?.state ?? "idle",
      host: this.#opts.devHost,
      origin:
        port === null
          ? null
          : `${scheme}://${browserReachableHost(this.#opts.devHost)}:${port}`,
      ...(this.#opts.devBase ? { base: this.#opts.devBase } : {}),
      port,
      pid: status?.pid ?? null,
      lastError: status?.lastError ?? null,
      entries: this.#entries,
      https: !!this.#opts.https,
      restartCount: status?.restartCount ?? 0,
      healthFailures: status?.missedPongs ?? 0,
      portRetries: this.#portRetries,
    });
  }

  /**
   * Relaie les lignes de l'hôte au logger. Le niveau se LIT sur la marque que
   * pose le logger de l'hôte ; une ligne sans marque (un greffon qui écrit
   * lui-même sur la console) prend celui de son flux.
   */
  readonly #relay = (stream: HeldOutputStream, lines: Buffer): void => {
    const log = this.#opts.logger;
    for (const raw of lines.toString("utf8").split("\n")) {
      const line = stripVTControlCharacters(raw).trim();
      if (line === "") continue;
      const parsed = parseViteHostLine(line);
      const level = parsed?.level ?? (stream === "out" ? "info" : "error");
      const text = `[vite] ${parsed?.text ?? line}`;
      if (level === "info") log.info(text);
      else if (level === "error") log.error(text);
      else if (log.warn) log.warn(text);
      else log.info(text);
    }
  };
}

export default ViteProcessSupervisor;
