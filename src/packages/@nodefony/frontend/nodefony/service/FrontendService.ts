import { Service, Module, Container, Event, extend, injectable } from "nodefony";
import type {
  IFrontendService,
} from "../interfaces/IFrontendService";
import type {
  IFrontendModuleDeclaration,
  IResolvedFrontendEntry,
} from "../interfaces/IFrontBuilder";
import type {
  IViteSupervisor,
  IViteSupervisorStatus,
} from "../interfaces/IViteSupervisor";
import ViteBuilder from "../src/builders/ViteBuilder";
import ViteProcessSupervisor from "./ViteProcessSupervisor";
import TemplateHelper from "../src/template/TemplateHelper";
import {
  FrontendNoEntriesError,
} from "../src/errors/FrontendError";
import defaultConfig, { type FrontendConfig } from "../config/config";
import path from "node:path";

/**
 * Service injectable du module `@nodefony/frontend`.
 *
 * Cycle de vie :
 *  1. construction : merge options par défaut + surcharge app (`module-frontend`).
 *  2. `onKernelReady` : si dev + `autoStartInDevelopment` → start superviseur.
 *  3. modules consommateurs appellent `registerEntry(...)` dans leur init.
 *  4. terminate kernel : `stop()` superviseur.
 *
 * Branche POC `poc/frontend-child` : utilise `ViteProcessSupervisor` (spawn).
 * Branche POC `poc/frontend-single` : remplacera par `ViteInProcSupervisor`.
 */
@injectable()
class FrontendService extends Service implements IFrontendService {
  module: Module;
  private readonly cfg: FrontendConfig;

  private readonly builder = new ViteBuilder();
  private readonly entries: IResolvedFrontendEntry[] = [];
  private supervisor: IViteSupervisor | null = null;
  private templateHelper: TemplateHelper | null = null;

  constructor(module: Module) {
    const merged = extend(
      true,
      {},
      defaultConfig,
      module.options ?? {},
    ) as FrontendConfig;
    super(
      "frontend",
      module.container as Container,
      module.notificationsCenter as Event,
      merged,
    );
    this.module = module;
    this.cfg = merged;
  }

  async initialize(): Promise<this> {
    this.log(`MODULE frontend service init`, "DEBUG");

    // Hook `onServersReady` (pas `onReady`) — Vite ne doit spawner qu'APRÈS que
    // les 4 serveurs Nodefony (HTTP/HTTPS/WS/WSS) écoutent, sinon le proxy Vite
    // tape un backend qui n'est pas encore prêt et les premiers fetch échouent.
    this.kernel?.once("onServersReady", async () => {
      const env = this.kernel?.environment;
      if (env === "development" && this.cfg.autoStartInDevelopment) {
        if (this.entries.length === 0) {
          this.log(
            "no frontend entries declared — Vite supervisor not started",
            "INFO",
          );
          return;
        }
        try {
          await this.startDev();
        } catch (e) {
          this.log(e, "ERROR");
        }
      }
    });

    this.kernel?.once("onTerminate", async () => {
      try {
        await this.stopDev();
      } catch {
        /* shutdown — silencieux */
      }
    });

    return this;
  }

  /**
   * Enregistre une déclaration frontend d'un module consommateur.
   *
   * À appeler dans le `initialize()` ou `onKernelReady()` du module
   * consommateur — toujours AVANT `onReady` du kernel (sinon le supervisor
   * démarre sans cette entrée).
   */
  registerEntry(
    consumerModule: Module,
    declaration: IFrontendModuleDeclaration,
  ): IResolvedFrontendEntry {
    const moduleRoot = (consumerModule as unknown as { path?: string }).path
      ?? process.cwd();
    const root = path.resolve(
      moduleRoot,
      declaration.root ?? this.cfg.defaultRoot,
    );
    const outDir = path.resolve(
      moduleRoot,
      declaration.outDir ?? this.cfg.defaultOutDir,
    );
    // `declaration.entry` est relatif au moduleRoot (ex: "./frontend/src/main.tsx").
    // On le stocke relatif au `root` (ex: "src/main.tsx") pour que le generator
    // produise `path.resolve(root, entryFile)` correctement et que le TemplateHelper
    // construise l'URL Vite (`${baseUrl}/src/main.tsx`) sans manipulation.
    const absEntry = path.resolve(moduleRoot, declaration.entry);
    const relEntry = path.relative(root, absEntry);
    const entry: IResolvedFrontendEntry = {
      moduleName: consumerModule.name,
      entryName: declaration.name ?? consumerModule.name,
      type: declaration.type,
      root,
      entryFile: relEntry,
      outDir,
      apiProxyPaths: declaration.apiProxyPaths ?? [],
    };
    this.entries.push(entry);
    this.log(
      `registered entry: ${entry.entryName} (${entry.type}) from "${entry.moduleName}"`,
      "INFO",
    );
    return entry;
  }

  listEntries(): ReadonlyArray<IResolvedFrontendEntry> {
    return this.entries;
  }

  status(): IViteSupervisorStatus {
    if (!this.supervisor) {
      return {
        state: "idle",
        host: this.cfg.devHost,
        port: null,
        pid: null,
        https: !!this.cfg.https,
        restartCount: 0,
        healthFailures: 0,
        lastError: null,
        entries: this.entries,
      };
    }
    return this.supervisor.status();
  }

  async startDev(): Promise<void> {
    if (this.entries.length === 0) {
      throw new FrontendNoEntriesError();
    }
    if (this.supervisor && this.supervisor.status().state === "ready") {
      return;
    }
    const backendOrigin =
      `${this.cfg.backendProtocol}://${this.cfg.backendHost}:${this.cfg.backendPort}`;
    // Si HTTPS demandé, récupère les certs Nodefony via DI (service `certificates`
    // exposé par @nodefony/http). Pas de duplication — on partage les mêmes PEM
    // que `server-https` (5152).
    let https: { keyPath: string; certPath: string } | undefined;
    if (this.cfg.https) {
      const certs = this.container?.get?.("certificates") as
        | { privateKeyPath?: string; certPath?: string }
        | undefined;
      if (!certs?.privateKeyPath || !certs?.certPath) {
        this.log(
          "https: true requested but `certificates` service unavailable — falling back to HTTP",
          "WARNING",
        );
      } else {
        https = { keyPath: certs.privateKeyPath, certPath: certs.certPath };
      }
    }
    // Propage l'environnement Nodefony à Vite :
    //  - NODE_ENV = kernel.environment (lu par les plugins Vite via process.env)
    //  - extraEnv = config.viteEnv → variables VITE_* exposées au browser
    const nodeEnv = this.kernel?.environment;
    const extraEnv = (this.cfg.viteEnv ?? {}) as Record<string, string>;
    const r = this.cfg.resilience ?? {};
    const supervisor = new ViteProcessSupervisor({
      devHost: this.cfg.devHost,
      devPort: this.cfg.devPort,
      startupTimeoutMs: this.cfg.startupTimeoutMs,
      pipeLogs: this.cfg.pipeViteLogs,
      cwd: this.entries[0]!.root,
      backendOrigin,
      https,
      nodeEnv,
      extraEnv,
      autoRestart: r.autoRestart,
      maxRestarts: r.maxRestarts,
      restartBackoffBaseMs: r.restartBackoffBaseMs,
      restartBackoffMaxMs: r.restartBackoffMaxMs,
      healthCheckIntervalMs: r.healthCheckIntervalMs,
      healthCheckFailureThreshold: r.healthCheckFailureThreshold,
      healthCheckTimeoutMs: r.healthCheckTimeoutMs,
      portRetryAttempts: r.portRetryAttempts,
      logger: {
        info: (m) => this.log(m, "INFO"),
        error: (m) => this.log(m, "ERROR"),
        debug: (m) => this.log(m, "DEBUG"),
      },
    });
    this.supervisor = supervisor;
    this.templateHelper = new TemplateHelper(supervisor, "development");

    this.fire("frontend:starting", { backendOrigin, entries: this.entries });

    // Le builder n'est pas utilisé en dev (config générée par le generator),
    // mais on passe la config (vide) pour respecter le contrat.
    const cfg = await this.builder.buildViteConfig(this.entries, "development");
    try {
      await supervisor.start(this.entries, cfg);
    } catch (e) {
      this.fire("frontend:error", e);
      throw e;
    }
    this.log(
      `vite dev server ready on ${supervisor.status().host}:${supervisor.status().port}`,
      "INFO",
    );
    this.fire("frontend:ready", supervisor.status());
  }

  async stopDev(): Promise<void> {
    if (!this.supervisor) return;
    await this.supervisor.stop();
    this.supervisor = null;
    this.templateHelper = null;
    this.fire("frontend:stopped");
  }

  async build(): Promise<void> {
    // Mode production — appel programmatique à `vite.build()`.
    if (this.entries.length === 0) throw new FrontendNoEntriesError();
    const cfg = await this.builder.buildViteConfig(this.entries, "production");
    const vite = (await import("vite")) as {
      build: (cfg: Record<string, unknown>) => Promise<unknown>;
    };
    await vite.build(cfg);
    this.log("vite production build complete", "INFO");
  }

  renderTags(entryName: string): string {
    if (!this.templateHelper) {
      return `<!-- @nodefony/frontend: helper not initialized (supervisor not started) -->`;
    }
    return this.templateHelper.renderTags(entryName);
  }

  /**
   * Retourne la valeur du header `Content-Security-Policy` à poser sur les
   * pages qui chargent du JS depuis le dev server Vite (cross-origin).
   * Sans ça, helmet pose `script-src 'self'` par défaut et le browser bloque
   * `http://127.0.0.1:5173/@vite/client` → page blanche.
   *
   * À appeler dans le controller AVANT `render()` :
   *   this.context.response.setHeader("Content-Security-Policy", svc.getCspDirectives())
   *
   * Inclut `ws://host:port` dans `connect-src` pour le canal HMR.
   */
  getCspDirectives(): string {
    const scheme = this.cfg.https ? "https" : "http";
    const wsScheme = this.cfg.https ? "wss" : "ws";
    const origin = `${this.cfg.devHost}:${this.cfg.devPort}`;
    return [
      "default-src 'self'",
      // 'unsafe-inline' requis pour le preamble React Fast Refresh inliné par
      // TemplateHelper (HMR @vitejs/plugin-react). À retirer en prod — le bundle
      // production n'a pas besoin de scripts inline.
      `script-src 'self' 'unsafe-inline' ${scheme}://${origin}`,
      `style-src 'self' 'unsafe-inline' ${scheme}://${origin}`,
      `img-src 'self' data: ${scheme}://${origin}`,
      `font-src 'self' data: ${scheme}://${origin}`,
      `connect-src 'self' ${scheme}://${origin} ${wsScheme}://${origin}`,
      "object-src 'none'",
    ].join("; ");
  }
}

export default FrontendService;
