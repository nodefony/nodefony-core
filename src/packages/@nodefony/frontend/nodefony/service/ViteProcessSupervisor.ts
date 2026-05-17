import { spawn, ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
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
}

/**
 * Superviseur Vite — branche POC `poc/frontend-child`.
 *
 * Lance Vite via `child_process.spawn("npx", ["vite", ...])` dans un process
 * système isolé. Le backend Nodefony n'est jamais bloqué par la compilation
 * Vite : le child a son propre event-loop et son propre tas V8.
 *
 * Cleanup : `child.kill("SIGINT")` au `stop()` — évite les processus
 * fantômes qui bloqueraient le port 5173.
 */
export class ViteProcessSupervisor implements IViteSupervisor {
  private readonly opts: ViteSupervisorOptions;
  private readonly generator = new ViteConfigGenerator();

  private child: ChildProcess | null = null;
  private state: ViteSupervisorState = "idle";
  private resolvedPort: number | null = null;
  private lastError: string | null = null;
  private entries: ReadonlyArray<IResolvedFrontendEntry> = [];
  private configFilePath: string | null = null;

  constructor(opts: ViteSupervisorOptions) {
    this.opts = opts;
  }

  async start(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    _viteConfigUnused: Record<string, unknown>,
  ): Promise<void> {
    if (this.state === "starting" || this.state === "ready") return;
    if (entries.length === 0) {
      throw new FrontendSupervisorStartError("no entries");
    }

    this.entries = entries;
    this.state = "starting";
    this.lastError = null;

    // 1. Écrire le fichier de config généré à côté de l'index.html du module.
    const moduleRoot = entries[0]!.root;
    this.configFilePath = path.resolve(moduleRoot, "vite.config.generated.mjs");
    const content = this.generator.toMjs(entries, "development");
    writeFileSync(this.configFilePath, content, "utf8");
    this.opts.logger.debug?.(
      `vite config written: ${this.configFilePath}`,
    );

    // 2. Spawn Vite — `detached: false` pour que le SIGINT du parent
    //    propage naturellement au child (pas de zombie après crash backend).
    const args = [
      "vite",
      "--config",
      this.configFilePath,
      "--host",
      this.opts.devHost,
      "--port",
      String(this.opts.devPort),
    ];

    try {
      this.child = spawn("npx", args, {
        cwd: this.opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        // FORCE_COLOR=0 + NO_COLOR=1 — Vite/picocolors honore NO_COLOR (standard).
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      });
    } catch (e) {
      this.state = "errored";
      this.lastError = e instanceof Error ? e.message : String(e);
      throw new FrontendSupervisorStartError("spawn failed", e);
    }

    // 3. Attendre "Local:" dans stdout — c'est le marker "ready" de Vite.
    await this.waitReady();
  }

  private waitReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = this.child;
      if (!child) {
        reject(new FrontendSupervisorStartError("no child"));
        return;
      }
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.state = "errored";
          this.lastError = "startup timeout";
          reject(
            new FrontendSupervisorStartError(
              `timeout after ${this.opts.startupTimeoutMs}ms`,
            ),
          );
        }
      }, this.opts.startupTimeoutMs);

      // Pattern attendu : "Local:   http://127.0.0.1:5173/"
      // Le buffer accumulé garantit qu'on matche même si Vite split la ligne
      // sur plusieurs chunks. On strip aussi les codes ANSI : malgré
      // FORCE_COLOR=0+NO_COLOR=1, Vite 8 peut émettre des codes selon le TTY.
      const localRe = /Local:\s+https?:\/\/([^:\s]+):(\d+)/;
      const ansiRe = /\[[0-9;]*m/g;
      let buffer = "";

      const onData = (chunk: Buffer | string) => {
        const txt = chunk.toString();
        if (this.opts.pipeLogs) this.opts.logger.info(`[vite] ${txt.trimEnd()}`);
        if (resolved) return;
        buffer += txt.replace(ansiRe, "");
        const m = buffer.match(localRe);
        if (m) {
          this.resolvedPort = parseInt(m[2]!, 10);
          this.state = "ready";
          resolved = true;
          buffer = ""; // libère la mémoire
          clearTimeout(timeout);
          resolve();
        }
      };

      child.stdout?.on("data", onData);
      child.stderr?.on("data", (chunk: Buffer | string) => {
        const txt = chunk.toString();
        if (this.opts.pipeLogs) this.opts.logger.error(`[vite!] ${txt.trimEnd()}`);
      });

      child.on("exit", (code, signal) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.state = "errored";
          this.lastError = `vite exited (code=${code}, signal=${signal}) before ready`;
          reject(new FrontendSupervisorStartError(this.lastError));
        } else {
          this.state = "stopped";
          this.opts.logger.info(`[vite] exited (code=${code}, signal=${signal})`);
        }
      });

      child.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.state = "errored";
          this.lastError = err.message;
          reject(new FrontendSupervisorStartError(err.message, err));
        }
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || this.state === "stopped" || this.state === "idle") return;
    this.state = "stopped";
    return new Promise<void>((resolve) => {
      const done = () => {
        this.child = null;
        resolve();
      };
      child.once("exit", done);
      // SIGINT — Vite gère proprement (cleanup HMR, release port).
      try {
        child.kill("SIGINT");
      } catch {
        // process déjà mort — finalize immédiatement
        done();
        return;
      }
      // Filet de sécurité : SIGKILL après 3s si SIGINT ignoré.
      setTimeout(() => {
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

  status(): IViteSupervisorStatus {
    return {
      state: this.state,
      host: this.opts.devHost,
      port: this.resolvedPort ?? this.opts.devPort,
      pid: this.child?.pid ?? null,
      lastError: this.lastError,
      entries: this.entries,
    };
  }
}

export default ViteProcessSupervisor;
