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
import ViteInProcSupervisor from "./ViteInProcSupervisor";
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
 * Branche POC `poc/frontend-single` : utilise `ViteInProcSupervisor`
 * (Vite lancé via `vite.createServer()` dans le process Node principal — partage
 * de l'event-loop avec le backend).
 * Pour comparaison voir branche `poc/frontend-child`.
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

    this.kernel?.once("onReady", async () => {
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
    const supervisor = new ViteInProcSupervisor({
      devHost: this.cfg.devHost,
      devPort: this.cfg.devPort,
      startupTimeoutMs: this.cfg.startupTimeoutMs,
      pipeLogs: this.cfg.pipeViteLogs,
      cwd: this.entries[0]!.root,
      logger: {
        info: (m) => this.log(m, "INFO"),
        error: (m) => this.log(m, "ERROR"),
        debug: (m) => this.log(m, "DEBUG"),
      },
    });
    this.supervisor = supervisor;
    this.templateHelper = new TemplateHelper(supervisor, "development");

    // En mode in-proc, le builder construit DIRECTEMENT la config Vite avec
    // les plugins instanciés — pas besoin de passer par un fichier .mjs.
    const cfg = await this.builder.buildViteConfig(this.entries, "development");
    await supervisor.start(this.entries, cfg);
    this.log(
      `vite dev server ready on ${supervisor.status().host}:${supervisor.status().port}`,
      "INFO",
    );
  }

  async stopDev(): Promise<void> {
    if (!this.supervisor) return;
    await this.supervisor.stop();
    this.supervisor = null;
    this.templateHelper = null;
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
}

export default FrontendService;
