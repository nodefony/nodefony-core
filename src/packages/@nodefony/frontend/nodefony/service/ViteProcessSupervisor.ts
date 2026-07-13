import { spawn, ChildProcess } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type {
  IViteSupervisor,
  IViteSupervisorStatus,
  ViteSupervisorState,
} from "../interfaces/IViteSupervisor";
import type { IResolvedFrontendEntry } from "../interfaces/IFrontBuilder";
import { FrontendSupervisorStartError } from "../src/errors/FrontendError";
import ViteConfigGenerator from "./ViteConfigGenerator";

/**
 * Résout le binaire Vite **une seule fois** (mis en cache module-level).
 *
 * Lancer le VRAI `node vite.js` en direct — au lieu du shim `npx vite` — évite le
 * process intermédiaire npm : 1 process au lieu de 2, et surtout `SIGINT`/`SIGKILL`
 * atteignent **directement** Vite (`npx`/`npm exec` relaie mal les signaux → Vite
 * orphelin → `EADDRINUSE` au restart).
 *
 * ⚠️ On passe par `vite/package.json` + son champ `bin` : la map `exports` de Vite
 * **n'expose pas** `./bin/vite.js` → `require.resolve("vite/bin/vite.js")` throw
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. `package.json`, lui, est exporté → résolvable.
 *
 * `null` = résolution impossible → fallback `npx` (jamais cassé = résilient).
 * `undefined` = pas encore tenté.
 */
let _viteBin: string | null | undefined;
function resolveViteBin(): string | null {
  if (_viteBin !== undefined) return _viteBin;
  try {
    const pkgPath = createRequire(import.meta.url).resolve("vite/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      bin?: string | { vite?: string };
    };
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.vite;
    const abs = rel ? path.join(path.dirname(pkgPath), rel) : null;
    _viteBin = abs && existsSync(abs) ? abs : null;
  } catch {
    _viteBin = null;
  }
  return _viteBin;
}

/**
 * Logger minimal — injecté par FrontendService pour piper les logs Vite
 * dans le syslog Nodefony sans dépendance dure sur Service.
 */
export interface IViteSupervisorLogger {
  info(msg: string): void;
  error(msg: string): void;
  debug?(msg: string): void;
}

export interface ViteSupervisorOptions {
  readonly devHost: string;
  readonly devPort: number;
  readonly startupTimeoutMs: number;
  readonly pipeLogs: boolean;
  readonly cwd: string;
  readonly logger: IViteSupervisorLogger;
  /**
   * Origine du serveur Nodefony pour `server.proxy` côté Vite — ex `"http://127.0.0.1:5151"`.
   * Quand fourni, les paths `apiProxyPaths` des entries sont proxifiés vers ce backend.
   */
  readonly backendOrigin?: string;
  /**
   * Certificats à utiliser si Vite doit servir en HTTPS. Paths absolus vers les
   * fichiers PEM — les mêmes que Nodefony utilise pour son `server-https` (5152).
   */
  readonly https?: {
    readonly keyPath: string;
    readonly certPath: string;
  };
  /** Valeur de `NODE_ENV` à propager au child Vite — généralement `kernel.environment`. */
  readonly nodeEnv?: string;
  /**
   * Variables d'env additionnelles passées au child Vite. Les clés `VITE_*`
   * sont automatiquement exposées au browser via `import.meta.env`.
   */
  readonly extraEnv?: Record<string, string>;
  // ─────────────────────────────────────────────────────────────────────────
  // Options de résilience
  // ─────────────────────────────────────────────────────────────────────────
  /** Auto-restart sur crash inattendu de Vite (default `true`). */
  readonly autoRestart?: boolean;
  /** Max tentatives de restart avant d'abandonner (default `5`). */
  readonly maxRestarts?: number;
  /** Délai initial du backoff exponentiel — doublé à chaque tentative (default `500ms`). */
  readonly restartBackoffBaseMs?: number;
  /** Plafond du backoff (default `8000ms` = 8s). */
  readonly restartBackoffMaxMs?: number;
  /**
   * Intervalle health check (default `30000` = 30s). `0` désactive.
   * Le supervisor fait un GET HTTP(S) sur `viteOrigin/` et compte les échecs
   * consécutifs ; au-delà du seuil, kill le child → trigger auto-restart.
   */
  readonly healthCheckIntervalMs?: number;
  /** Échecs health check consécutifs avant restart (default `3`). */
  readonly healthCheckFailureThreshold?: number;
  /** Timeout d'un health check individuel (default `5000ms`). */
  readonly healthCheckTimeoutMs?: number;
  /**
   * Tentatives de port à essayer si EADDRINUSE (default `3`).
   * Le supervisor essaie devPort, devPort+1, devPort+2.
   */
  readonly portRetryAttempts?: number;
}

interface ResolvedOptions {
  readonly autoRestart: boolean;
  readonly maxRestarts: number;
  readonly restartBackoffBaseMs: number;
  readonly restartBackoffMaxMs: number;
  readonly healthCheckIntervalMs: number;
  readonly healthCheckFailureThreshold: number;
  readonly healthCheckTimeoutMs: number;
  readonly portRetryAttempts: number;
}

const DEFAULTS: ResolvedOptions = {
  autoRestart: true,
  maxRestarts: 5,
  restartBackoffBaseMs: 500,
  restartBackoffMaxMs: 8_000,
  healthCheckIntervalMs: 30_000,
  healthCheckFailureThreshold: 3,
  healthCheckTimeoutMs: 5_000,
  portRetryAttempts: 3,
};

/**
 * Un texte (message d'erreur OU sortie brute de Vite) dénonce-t-il un port occupé ?
 *
 * **Source UNIQUE** de cette décision. Elle était dupliquée en deux regex qui ont
 * divergé : l'une cherchait `port X is in use`, alors que Vite écrit
 * `Port 5173 is ALREADY in use`. Résultat, le retry de port ne se déclenchait
 * jamais et la seconde app perdait tout son frontend — un conflit de port pourtant
 * parfaitement rattrapable. On tolère donc les deux formulations, et on ne
 * l'écrit qu'ici (deux implémentations d'une même règle = dérive garantie).
 */
export function isPortInUseMessage(text: string): boolean {
  return (
    /EADDRINUSE/i.test(text) ||
    /address already in use/i.test(text) ||
    /port\s+\d+\s+is\s+(?:already\s+)?in use/i.test(text)
  );
}

/**
 * Superviseur Vite résilient — branche POC `poc/frontend-child`.
 *
 * Garanties :
 *  - Idempotent : appels concurrents à `start()` partagent la même promesse.
 *  - Auto-restart : crash inattendu → restart avec backoff exponentiel borné.
 *  - Port conflict : retry sur port+1 jusqu'au plafond `portRetryAttempts`.
 *  - Health check : ping périodique, kill+restart sur N échecs consécutifs.
 *  - Cleanup strict : listeners + timers tracés et libérés au `stop()`.
 *
 * Tous les listeners sur `child` sont supprimés explicitement avant qu'on
 * laisse le child mourir (évite memory leak entre restarts).
 */
export class ViteProcessSupervisor implements IViteSupervisor {
  private readonly opts: ViteSupervisorOptions;
  private readonly cfg: ResolvedOptions;
  private readonly generator = new ViteConfigGenerator();

  private child: ChildProcess | null = null;
  private state: ViteSupervisorState = "idle";
  private resolvedPort: number | null = null;
  private lastError: string | null = null;
  private entries: ReadonlyArray<IResolvedFrontendEntry> = [];
  private configFilePath: string | null = null;
  private restartCount = 0;
  private healthFailures = 0;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private willingShutdown = false;
  /** Kill VOULU par le health check (recovery) : le prochain exit doit relancer. */
  private expectRestartKill = false;
  /**
   * Signal d'arrêt reçu par NOTRE process (Ctrl+C au groupe foreground, SIGTERM
   * d'un orchestrateur) → tout exit de Vite est un ARRÊT, jamais un crash.
   * Indispensable : Vite intercepte SIGINT et sort `code=130, signal=null` —
   * indiscernable d'un crash côté exit event, et `willingShutdown` (posé par le
   * stop du kernel) arrive APRÈS la mort de Vite (race sans IPC, vécu Ctrl+C :
   * « vite restart #1 failed » en ERROR sur un arrêt normal).
   */
  private readonly markShutdown = (): void => {
    this.willingShutdown = true;
  };
  /**
   * Listeners attachés au child courant — drainés à chaque mort du child.
   * Sans ça, le child gardé en référence (avant GC) accumule des handlers
   * entre restarts → MaxListenersExceededWarning + leak.
   */
  private childListeners: Array<{
    target: NodeJS.EventEmitter;
    event: string;
    fn: (...args: any[]) => void;
  }> = [];

  constructor(opts: ViteSupervisorOptions) {
    this.opts = opts;
    this.cfg = {
      autoRestart: opts.autoRestart ?? DEFAULTS.autoRestart,
      maxRestarts: opts.maxRestarts ?? DEFAULTS.maxRestarts,
      restartBackoffBaseMs:
        opts.restartBackoffBaseMs ?? DEFAULTS.restartBackoffBaseMs,
      restartBackoffMaxMs:
        opts.restartBackoffMaxMs ?? DEFAULTS.restartBackoffMaxMs,
      healthCheckIntervalMs:
        opts.healthCheckIntervalMs ?? DEFAULTS.healthCheckIntervalMs,
      healthCheckFailureThreshold:
        opts.healthCheckFailureThreshold ??
        DEFAULTS.healthCheckFailureThreshold,
      healthCheckTimeoutMs:
        opts.healthCheckTimeoutMs ?? DEFAULTS.healthCheckTimeoutMs,
      portRetryAttempts: opts.portRetryAttempts ?? DEFAULTS.portRetryAttempts,
    };
  }

  async start(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    _viteConfigUnused: Record<string, unknown>,
  ): Promise<void> {
    // Idempotence : si déjà ready, no-op. Si starting/restarting, partage la promesse.
    if (this.state === "ready") return;
    if (this.startPromise) return this.startPromise;
    if (this.state === "stopping") {
      throw new FrontendSupervisorStartError("cannot start while stopping");
    }
    if (entries.length === 0) {
      throw new FrontendSupervisorStartError("no entries");
    }

    this.entries = entries;
    this.willingShutdown = false;
    this.restartCount = 0;
    this.lastError = null;
    // `once` + retrait explicite au stop (règle listeners) : premier signal
    // d'arrêt du process serveur → willingShutdown immédiat (cf markShutdown).
    process.once("SIGINT", this.markShutdown);
    process.once("SIGTERM", this.markShutdown);
    this.startPromise = this.spawnWithPortRetry();
    try {
      await this.startPromise;
      this.startHealthCheck();
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.state === "idle" || this.state === "stopped") return;
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.doStop();
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  status(): IViteSupervisorStatus {
    return {
      state: this.state,
      host: this.opts.devHost,
      port: this.resolvedPort ?? this.opts.devPort,
      pid: this.child?.pid ?? null,
      lastError: this.lastError,
      entries: this.entries,
      https: !!this.opts.https,
      restartCount: this.restartCount,
      healthFailures: this.healthFailures,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Essaie de spawn Vite en variant le port si EADDRINUSE. Le port résolu
   * est stocké dans `resolvedPort` (utilisé par status() + TemplateHelper).
   */
  private async spawnWithPortRetry(): Promise<void> {
    const maxAttempts = this.cfg.portRetryAttempts;
    let lastErr: Error | null = null;
    for (let i = 0; i <= maxAttempts; i++) {
      const port = this.opts.devPort + i;
      try {
        await this.attemptSpawn(port);
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (this.isPortInUseError(lastErr) && i < maxAttempts) {
          this.opts.logger.info(
            `port ${port} unavailable — retrying on ${port + 1}`,
          );
          continue;
        }
        throw lastErr;
      }
    }
    throw lastErr ?? new FrontendSupervisorStartError("port retry exhausted");
  }

  private isPortInUseError(e: Error): boolean {
    return isPortInUseMessage(e.message);
  }

  /** Spawn Vite sur un port donné et attend le ready. */
  private async attemptSpawn(port: number): Promise<void> {
    this.state = "starting";

    // 1. Génère + écrit `vite.config.generated.mjs` à côté de l'index.html.
    const moduleRoot = this.entries[0]!.root;
    this.configFilePath = path.resolve(moduleRoot, "vite.config.generated.mjs");
    const scheme = this.opts.https ? "https" : "http";
    const viteOrigin = `${scheme}://${this.opts.devHost}:${port}`;
    const content = this.generator.toMjs(this.entries, "development", {
      backendOrigin: this.opts.backendOrigin,
      viteOrigin,
      https: this.opts.https,
    });
    writeFileSync(this.configFilePath, content, "utf8");
    this.opts.logger.debug?.(`vite config written: ${this.configFilePath}`);

    // 2. Spawn.
    const args = [
      "vite",
      "--config",
      this.configFilePath,
      "--host",
      this.opts.devHost,
      "--port",
      String(port),
      ...(this.opts.nodeEnv ? ["--mode", this.opts.nodeEnv] : []),
    ];

    // Spawn DIRECT du vrai Vite (résilient : fallback `npx` si non résolu). `detached:
    // false` = Vite reste dans le groupe de process du serveur → un Ctrl+C terminal
    // (SIGINT au groupe foreground) l'atteint AUSSI directement (kill propre, 0 orphelin).
    const viteBin = resolveViteBin();
    const spawnCmd = viteBin ? process.execPath : "npx";
    const spawnArgs = viteBin ? [viteBin, ...args.slice(1)] : args;
    // Titre lisible dans `ps` : sinon `node …/vite/bin/vite.js --config <long path>`,
    // impossible de distinguer les familles d'un coup d'œil. `argv0` = argv[0] du child
    // (cosmétique : node lance quand même `viteBin` via argv[1]).
    const psLabel = `nodefony-vite[${this.entries
      .map((e) => e.entryName)
      .join("+")}]`;
    this.opts.logger.debug?.(
      viteBin
        ? `vite spawn direct (node ${viteBin})`
        : "vite spawn via npx (fallback — résolution directe indisponible)",
    );
    try {
      this.child = spawn(spawnCmd, spawnArgs, {
        cwd: this.opts.cwd,
        argv0: psLabel,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        env: {
          ...process.env,
          ...(this.opts.nodeEnv ? { NODE_ENV: this.opts.nodeEnv } : {}),
          ...(this.opts.extraEnv ?? {}),
          FORCE_COLOR: "0",
          NO_COLOR: "1",
        },
      });
    } catch (e) {
      this.state = "errored";
      this.lastError = e instanceof Error ? e.message : String(e);
      throw new FrontendSupervisorStartError("spawn failed", e);
    }

    // 3. Attendre "Local:" dans stdout — marker "ready" de Vite.
    await this.waitReady(port);
    this.opts.logger.debug?.(`vite ready on port ${port}`);
  }

  private waitReady(_expectedPort: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = this.child;
      if (!child) {
        reject(new FrontendSupervisorStartError("no child"));
        return;
      }
      let resolved = false;
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.state = "errored";
        this.lastError = "startup timeout";
        reject(
          new FrontendSupervisorStartError(
            `timeout after ${this.opts.startupTimeoutMs}ms`,
          ),
        );
      }, this.opts.startupTimeoutMs);

      const localRe = /Local:\s+https?:\/\/([^:\s]+):(\d+)/;
      const ansiRe = /\x1b\[[0-9;]*m/g;
      const viteOwnPrefixRe = /^\d{1,2}:\d{2}:\d{2}\s+\[vite\]\s*|^\[vite\]\s*/;
      let buffer = "";

      const pipeClean = (raw: string, level: "info" | "error") => {
        if (!this.opts.pipeLogs) return;
        for (const line of raw.split(/\r?\n/)) {
          const stripped = line
            .replace(ansiRe, "")
            .replace(viteOwnPrefixRe, "")
            .trim();
          if (!stripped) continue;
          if (level === "error") this.opts.logger.error(`[vite] ${stripped}`);
          else this.opts.logger.info(`[vite] ${stripped}`);
        }
      };

      const onStdout = (chunk: Buffer | string) => {
        const txt = chunk.toString();
        pipeClean(txt, "info");
        if (resolved) return;
        buffer += txt.replace(ansiRe, "");
        const m = buffer.match(localRe);
        if (m) {
          this.resolvedPort = parseInt(m[2]!, 10);
          this.state = "ready";
          this.healthFailures = 0;
          resolved = true;
          buffer = "";
          clearTimeout(timeout);
          resolve();
        }
      };

      const onStderr = (chunk: Buffer | string) => {
        const txt = chunk.toString();
        pipeClean(txt, "error");
        if (resolved) return;
        // 🐛 Le conflit de port arrive par ICI, pas par stdout. `onExit` décide de
        // retenter en cherchant « Port X is in use » dans `buffer` — que seul
        // `onStdout` alimentait. Résultat : `buffer` vide, aucun retry, et la
        // famille Vite de la 2ᵉ app mourait alors que `spawnWithPortRetry` était
        // là, prêt à décaler le port. On alimente donc le MÊME buffer.
        buffer += txt.replace(ansiRe, "");
        // Vite en `strictPort: false` se décale tout seul et annonce la nouvelle
        // URL : si elle sort ici, on la prend (même lecture que sur stdout).
        const m = buffer.match(localRe);
        if (m) {
          this.resolvedPort = parseInt(m[2]!, 10);
          this.state = "ready";
          this.healthFailures = 0;
          resolved = true;
          buffer = "";
          clearTimeout(timeout);
          resolve();
        }
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          // Conflit de port → `spawnWithPortRetry` réessaiera sur port+1. MÊME
          // détecteur que `isPortInUseError` (une 2ᵉ regex divergeait : celle-ci
          // cherchait « Port X is in use » quand Vite écrit « Port X is ALREADY
          // in use » → elle ne matchait jamais, et la famille Vite mourait).
          const msg = `vite exited (code=${code}, signal=${signal}) before ready`;
          this.state = "errored";
          this.lastError = msg;
          if (isPortInUseMessage(buffer)) {
            reject(new FrontendSupervisorStartError("EADDRINUSE: " + msg));
          } else {
            reject(new FrontendSupervisorStartError(msg));
          }
        }
      };

      const onError = (err: Error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        this.state = "errored";
        this.lastError = err.message;
        reject(new FrontendSupervisorStartError(err.message, err));
      };

      this.trackListener(child.stdout!, "data", onStdout);
      this.trackListener(child.stderr!, "data", onStderr);
      this.trackListener(child, "exit", onExit);
      this.trackListener(child, "error", onError);
    }).then(() => {
      // Une fois ready : remplace `onExit` initial par le handler runtime
      // (auto-restart sur crash). Le précédent onExit ne sert qu'au boot.
      this.attachRuntimeExitHandler();
    });
  }

  /**
   * Après que Vite est ready, on attache un handler qui distingue :
   *  - shutdown volontaire (willingShutdown=true → state=stopped, no restart)
   *  - crash inattendu (state=ready au moment du exit → scheduleRestart)
   */
  private attachRuntimeExitHandler(): void {
    if (!this.child) return;
    const onRuntimeExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      this.cleanupChildListeners();
      this.opts.logger.info(`[vite] exited (code=${code}, signal=${signal})`);
      if (this.willingShutdown) {
        this.state = "stopped";
        this.child = null;
        return;
      }
      // Kill VOULU (health check → recovery) : relancer, c'est le but.
      if (this.expectRestartKill) {
        this.expectRestartKill = false;
      } else if (
        signal === "SIGINT" ||
        signal === "SIGTERM" ||
        signal === "SIGHUP"
      ) {
        // Mort par SIGNAL D'ARRÊT non voulu par nous : Ctrl+C au groupe
        // foreground, group-kill du DevSupervisor, kill externe. JAMAIS un
        // crash : relancer pendant un shutdown spawnait un Vite qui mourait
        // aussitôt → « vite restart #1 failed » en ERROR sur un arrêt NORMAL
        // (vécu Ctrl+C). Le cas Vite-intercepte-SIGINT (`code=130,
        // signal=null`) est couvert par les hooks signaux (cf markShutdown).
        this.state = "stopped";
        this.child = null;
        this.opts.logger.info(
          `[vite] arrêté (${signal} — signal d'arrêt) : pas de relance`,
        );
        return;
      }
      this.state = "crashed";
      this.lastError = `crashed (code=${code}, signal=${signal})`;
      this.child = null;
      if (this.cfg.autoRestart) {
        this.scheduleRestart();
      } else {
        this.state = "errored";
      }
    };
    this.trackListener(this.child, "exit", onRuntimeExit);
  }

  private scheduleRestart(): void {
    if (this.restartCount >= this.cfg.maxRestarts) {
      this.state = "errored";
      this.lastError = `max restarts (${this.cfg.maxRestarts}) reached`;
      this.opts.logger.error(this.lastError);
      this.stopHealthCheck();
      return;
    }
    const delay = Math.min(
      this.cfg.restartBackoffBaseMs * 2 ** this.restartCount,
      this.cfg.restartBackoffMaxMs,
    );
    this.restartCount++;
    this.state = "restarting";
    this.opts.logger.info(
      `vite restart #${this.restartCount}/${this.cfg.maxRestarts} in ${delay}ms`,
    );
    this.stopHealthCheck();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.willingShutdown) return;
      this.spawnWithPortRetry()
        .then(() => {
          this.opts.logger.info(`vite restart #${this.restartCount} succeeded`);
          this.startHealthCheck();
        })
        .catch((e) => {
          this.opts.logger.error(
            `vite restart #${this.restartCount} failed: ${e?.message ?? e}`,
          );
          // Tentative suivante (récursif, jusqu'à maxRestarts).
          this.state = "crashed";
          this.scheduleRestart();
        });
    }, delay);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Health check
  // ───────────────────────────────────────────────────────────────────────

  private startHealthCheck(): void {
    if (this.cfg.healthCheckIntervalMs <= 0) return;
    this.stopHealthCheck();
    this.healthFailures = 0;
    this.healthCheckTimer = setInterval(() => {
      this.pingVite()
        .then(() => {
          if (this.healthFailures > 0) {
            this.opts.logger.info(
              `vite healthcheck recovered after ${this.healthFailures} failure(s)`,
            );
          }
          this.healthFailures = 0;
        })
        .catch((e) => {
          this.healthFailures++;
          this.opts.logger.error(
            `vite healthcheck failed (${this.healthFailures}/${this.cfg.healthCheckFailureThreshold}): ${e?.message ?? e}`,
          );
          if (
            this.healthFailures >= this.cfg.healthCheckFailureThreshold &&
            this.state === "ready"
          ) {
            this.opts.logger.error(
              `vite unhealthy — killing child to trigger restart`,
            );
            // Kill de RECOVERY : marquer l'intention AVANT le SIGTERM, sinon
            // l'exit handler le lirait comme un signal d'arrêt (pas de relance).
            this.expectRestartKill = true;
            this.killChild();
            // L'exit handler enchaîne sur scheduleRestart.
          }
        });
    }, this.cfg.healthCheckIntervalMs);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Ping HTTP(S) GET sur la racine de Vite. Considère réussi si réception de
   * headers (même 4xx — Vite ne renvoie pas forcément 200 à `/`).
   */
  private pingVite(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const port = this.resolvedPort ?? this.opts.devPort;
      const scheme = this.opts.https ? https : http;
      const req = scheme.request(
        {
          hostname: this.opts.devHost,
          port,
          path: "/",
          method: "GET",
          rejectUnauthorized: false,
          timeout: this.cfg.healthCheckTimeoutMs,
        },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", (e) => reject(e));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("healthcheck timeout"));
      });
      req.end();
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Lifecycle helpers
  // ───────────────────────────────────────────────────────────────────────

  /** Stop volontaire — n'enclenche PAS l'auto-restart. */
  private async doStop(): Promise<void> {
    this.willingShutdown = true;
    // Les hooks signaux de start() ne servent plus (retrait explicite — pas de
    // listener process accumulé entre les cycles start/stop).
    process.removeListener("SIGINT", this.markShutdown);
    process.removeListener("SIGTERM", this.markShutdown);
    this.state = "stopping";
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.stopHealthCheck();

    const child = this.child;
    if (!child) {
      this.state = "stopped";
      return;
    }
    return new Promise<void>((resolve) => {
      const done = () => {
        this.cleanupChildListeners();
        this.child = null;
        this.state = "stopped";
        if (sigKillTimer) clearTimeout(sigKillTimer);
        resolve();
      };
      child.once("exit", done);
      try {
        child.kill("SIGINT");
      } catch {
        done();
        return;
      }
      const sigKillTimer = setTimeout(() => {
        if (this.child && !this.child.killed) {
          try {
            this.child.kill("SIGKILL");
          } catch {
            /* déjà mort */
          }
        }
      }, 3_000);
    });
  }

  /** Force kill du child (pour les health checks failing). Le exit handler gère le restart. */
  private killChild(): void {
    if (!this.child) return;
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* déjà mort */
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Listener tracking — évite memory leak entre restarts
  // ───────────────────────────────────────────────────────────────────────

  private trackListener(
    target: NodeJS.EventEmitter,
    event: string,
    fn: (...args: any[]) => void,
  ): void {
    target.on(event, fn);
    this.childListeners.push({ target, event, fn });
  }

  private cleanupChildListeners(): void {
    for (const { target, event, fn } of this.childListeners) {
      try {
        target.removeListener(event, fn);
      } catch {
        /* target peut-être déjà GC */
      }
    }
    this.childListeners = [];
  }
}

export default ViteProcessSupervisor;
