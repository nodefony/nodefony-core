import type {
  IViteSupervisor,
  IViteSupervisorStatus,
  ViteSupervisorState,
} from "../interfaces/IViteSupervisor";
import type { IResolvedFrontendEntry } from "../interfaces/IFrontBuilder";
import { FrontendSupervisorStartError } from "../src/errors/FrontendError";

/**
 * Logger minimal — injecté par FrontendService pour piper les logs Vite
 * dans le syslog Nodefony.
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
 * Superviseur Vite — branche POC `poc/frontend-single`.
 *
 * Lance Vite via `vite.createServer()` dans le process Node principal.
 * Vite partage l'event-loop avec le backend Nodefony — le coût des
 * transformations Vite (esbuild, plugin-react, optimizeDeps) impacte
 * potentiellement la latence backend.
 *
 * Mêmes contrats publics que `ViteProcessSupervisor` (branche child) :
 * c'est volontairement le SEUL fichier qui change entre les deux branches POC.
 */
export class ViteInProcSupervisor implements IViteSupervisor {
  private readonly opts: ViteSupervisorOptions;
  // Vite ne fournit pas de types stables import-only sans tirer toute sa
  // surface — on type le serveur localement en structural typing.
  private viteServer: {
    listen(): Promise<unknown>;
    close(): Promise<void>;
    config: { server: { port: number; host: string | boolean } };
    httpServer: { address(): { port: number } | string | null } | null;
    printUrls(): void;
  } | null = null;
  private state: ViteSupervisorState = "idle";
  private resolvedPort: number | null = null;
  private lastError: string | null = null;
  private entries: ReadonlyArray<IResolvedFrontendEntry> = [];

  constructor(opts: ViteSupervisorOptions) {
    this.opts = opts;
  }

  async start(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    viteConfig: Record<string, unknown>,
  ): Promise<void> {
    if (this.state === "starting" || this.state === "ready") return;
    if (entries.length === 0) {
      throw new FrontendSupervisorStartError("no entries");
    }
    this.entries = entries;
    this.state = "starting";
    this.lastError = null;

    try {
      const vite = (await import("vite")) as unknown as {
        createServer: (cfg: Record<string, unknown>) => Promise<unknown>;
      };

      // Surcharge host/port côté config Vite — on respecte ce que demande
      // FrontendService (cfg.server est déjà partiellement rempli par le builder).
      const cfg = {
        ...viteConfig,
        server: {
          ...(viteConfig.server as Record<string, unknown>),
          host: this.opts.devHost,
          port: this.opts.devPort,
          strictPort: false,
        },
        logLevel: "info",
        customLogger: this.opts.pipeLogs ? this.buildCustomLogger() : undefined,
        clearScreen: false,
      };

      // `createServer` charge esbuild + plugin-react + scanne deps —
      // tâche CPU-intensive. C'est exactement ici qu'on mesure l'impact
      // event-loop côté backend (à comparer avec la branche child).
      const raw = await vite.createServer(cfg);
      if (!raw) {
        throw new FrontendSupervisorStartError("createServer returned null");
      }
      const server = raw as {
        listen(): Promise<unknown>;
        close(): Promise<void>;
        config: { server: { port: number; host: string | boolean } };
        httpServer: { address(): { port: number } | string | null } | null;
        printUrls(): void;
      };
      await server.listen();
      this.viteServer = server;

      // Récupère le port réel — Vite peut avoir incrémenté si occupé.
      const addr = server.httpServer?.address();
      this.resolvedPort =
        typeof addr === "object" && addr ? addr.port : this.opts.devPort;
      this.state = "ready";
      this.opts.logger.info(
        `vite in-proc dev server listening on ${this.opts.devHost}:${this.resolvedPort}`,
      );
    } catch (e) {
      this.state = "errored";
      this.lastError = e instanceof Error ? e.message : String(e);
      throw new FrontendSupervisorStartError("createServer failed", e);
    }
  }

  /**
   * Vite expose un point d'extension `customLogger` pour intercepter ses logs.
   * Comme on n'a pas accès au TTY, on les redirige vers le logger Nodefony.
   */
  private buildCustomLogger(): Record<string, unknown> {
    const log = this.opts.logger;
    return {
      info: (msg: string) => log.info(`[vite] ${stripAnsi(msg)}`),
      warn: (msg: string) => log.info(`[vite] WARN ${stripAnsi(msg)}`),
      warnOnce: (msg: string) => log.info(`[vite] WARN1 ${stripAnsi(msg)}`),
      error: (msg: string) => log.error(`[vite!] ${stripAnsi(msg)}`),
      clearScreen: () => {},
      hasErrorLogged: () => false,
      hasWarned: false,
    };
  }

  async stop(): Promise<void> {
    if (!this.viteServer || this.state === "stopped") return;
    this.state = "stopped";
    try {
      await this.viteServer.close();
    } finally {
      this.viteServer = null;
    }
  }

  status(): IViteSupervisorStatus {
    return {
      state: this.state,
      host: this.opts.devHost,
      port: this.resolvedPort ?? this.opts.devPort,
      pid: process.pid,
      lastError: this.lastError,
      entries: this.entries,
    };
  }
}

// eslint-disable-next-line no-control-regex
const ansiRe = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ansiRe, "");
}

export default ViteInProcSupervisor;
