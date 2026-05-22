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
  FrontendSupervisorStartError,
} from "../src/errors/FrontendError";
import {
  isolationGroup,
  familyPortPlan,
  PRIMARY_FAMILY,
} from "../src/isolationGroups";
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
  /** Une instance Vite par famille d'isolation (`default`, `angular`, …). */
  private readonly supervisors = new Map<string, IViteSupervisor>();
  /** Template helper par famille (route les `<script>` vers le bon port Vite). */
  private readonly templateHelpers = new Map<string, TemplateHelper>();
  /** Index inverse `entryName → famille`, pour router `renderTags`. */
  private readonly entryFamily = new Map<string, string>();

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
    const primary =
      this.supervisors.get(PRIMARY_FAMILY) ??
      [...this.supervisors.values()][0];
    if (!primary) {
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
    return primary.status();
  }

  statusAll(): ReadonlyArray<{ family: string; status: IViteSupervisorStatus }> {
    return [...this.supervisors.entries()].map(([family, s]) => ({
      family,
      status: s.status(),
    }));
  }

  /**
   * Démarre une instance Vite **par famille d'isolation** (multi-supervisor).
   *
   * Résilience : chaque famille démarre indépendamment (`Promise.allSettled`).
   * Une famille qui échoue (ex. Angular) est isolée — elle ne fait jamais
   * échouer les autres ni le backend. `startDev` ne rejette que si **aucune**
   * famille n'a pu démarrer.
   */
  async startDev(): Promise<void> {
    if (this.entries.length === 0) {
      throw new FrontendNoEntriesError();
    }
    // Idempotence : si une instance tourne déjà, no-op.
    if (
      this.supervisors.size > 0 &&
      [...this.supervisors.values()].some(
        (s) => s.status().state === "ready",
      )
    ) {
      return;
    }

    const backendOrigin =
      `${this.cfg.backendProtocol}://${this.cfg.backendHost}:${this.cfg.backendPort}`;
    const https = this.resolveHttps();
    // Propage l'environnement Nodefony à Vite :
    //  - NODE_ENV = kernel.environment (lu par les plugins Vite via process.env)
    //  - extraEnv = config.viteEnv → variables VITE_* exposées au browser
    const nodeEnv = this.kernel?.environment;
    const extraEnv = (this.cfg.viteEnv ?? {}) as Record<string, string>;

    const groups = this.groupEntriesByFamily();
    // Plan de ports : un bloc disjoint par famille (`default` reste sur 5173).
    const portPlan = familyPortPlan(
      this.cfg.devPort,
      [...groups.keys()],
      this.cfg.resilience?.portRetryAttempts ?? 3,
    );
    const families = [...portPlan.keys()];

    this.fire("frontend:starting", { backendOrigin, entries: this.entries });

    const results = await Promise.allSettled(
      families.map((family) =>
        this.startFamily(family, groups.get(family)!, portPlan.get(family)!, {
          backendOrigin,
          https,
          nodeEnv,
          extraEnv,
        }),
      ),
    );

    results.forEach((res, i) => {
      if (res.status === "rejected") {
        const reason = res.reason as { message?: string } | undefined;
        this.log(
          `frontend family "${families[i]}" failed to start (isolated): ${reason?.message ?? reason}`,
          "ERROR",
        );
      }
    });

    const ready = [...this.supervisors.values()].filter(
      (s) => s.status().state === "ready",
    );
    if (ready.length === 0) {
      const err = new FrontendSupervisorStartError(
        "no frontend family could start",
      );
      this.fire("frontend:error", err);
      throw err;
    }
    this.fire("frontend:ready", this.status());
  }

  /**
   * Résout les certificats HTTPS partagés (service `certificates` de
   * @nodefony/http) si `https: true`. Pas de duplication — mêmes PEM que
   * `server-https` (5152). Retombe sur HTTP avec un warning si indisponible.
   */
  private resolveHttps(): { keyPath: string; certPath: string } | undefined {
    if (!this.cfg.https) return undefined;
    const certs = this.container?.get?.("certificates") as
      | { privateKeyPath?: string; certPath?: string }
      | undefined;
    if (!certs?.privateKeyPath || !certs?.certPath) {
      this.log(
        "https: true requested but `certificates` service unavailable — falling back to HTTP",
        "WARNING",
      );
      return undefined;
    }
    return { keyPath: certs.privateKeyPath, certPath: certs.certPath };
  }

  /** Regroupe les entries par famille d'isolation + remplit l'index inverse. */
  private groupEntriesByFamily(): Map<string, IResolvedFrontendEntry[]> {
    const groups = new Map<string, IResolvedFrontendEntry[]>();
    this.entryFamily.clear();
    for (const entry of this.entries) {
      const family = isolationGroup(entry.type);
      this.entryFamily.set(entry.entryName, family);
      const arr = groups.get(family);
      if (arr) arr.push(entry);
      else groups.set(family, [entry]);
    }
    return groups;
  }

  /**
   * Démarre l'instance Vite d'une famille sur un port dédié. Enregistre le
   * supervisor + son template helper AVANT le `start()` (l'état dégradé reste
   * observable même si le démarrage échoue → rendu propre, pas d'exception).
   */
  private async startFamily(
    family: string,
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    port: number,
    ctx: {
      backendOrigin: string;
      https: { keyPath: string; certPath: string } | undefined;
      nodeEnv: string | undefined;
      extraEnv: Record<string, string>;
    },
  ): Promise<void> {
    const r = this.cfg.resilience ?? {};
    const supervisor = new ViteProcessSupervisor({
      devHost: this.cfg.devHost,
      devPort: port,
      startupTimeoutMs: this.cfg.startupTimeoutMs,
      pipeLogs: this.cfg.pipeViteLogs,
      cwd: entries[0]!.root,
      backendOrigin: ctx.backendOrigin,
      https: ctx.https,
      nodeEnv: ctx.nodeEnv,
      extraEnv: ctx.extraEnv,
      autoRestart: r.autoRestart,
      maxRestarts: r.maxRestarts,
      restartBackoffBaseMs: r.restartBackoffBaseMs,
      restartBackoffMaxMs: r.restartBackoffMaxMs,
      healthCheckIntervalMs: r.healthCheckIntervalMs,
      healthCheckFailureThreshold: r.healthCheckFailureThreshold,
      healthCheckTimeoutMs: r.healthCheckTimeoutMs,
      portRetryAttempts: r.portRetryAttempts,
      logger: {
        info: (m) => this.log(`[${family}] ${m}`, "INFO"),
        error: (m) => this.log(`[${family}] ${m}`, "ERROR"),
        debug: (m) => this.log(`[${family}] ${m}`, "DEBUG"),
      },
    });
    this.supervisors.set(family, supervisor);
    this.templateHelpers.set(family, new TemplateHelper(supervisor, "development"));

    // Le builder n'est pas utilisé en dev (config générée par le generator),
    // mais on passe la config (vide) pour respecter le contrat.
    const cfg = await this.builder.buildViteConfig([...entries], "development");
    await supervisor.start(entries, cfg);
    this.log(
      `vite [${family}] ready on ${supervisor.status().host}:${supervisor.status().port}`,
      "INFO",
    );
  }

  async stopDev(): Promise<void> {
    if (this.supervisors.size === 0) return;
    // allSettled : une instance qui throw au stop n'empêche pas de tuer les
    // autres (chaque supervisor fait SIGINT → SIGKILL timeout, 0 orphelin).
    await Promise.allSettled(
      [...this.supervisors.values()].map((s) => s.stop()),
    );
    this.supervisors.clear();
    this.templateHelpers.clear();
    this.entryFamily.clear();
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
    const family = this.entryFamily.get(entryName);
    const helper = family ? this.templateHelpers.get(family) : undefined;
    if (!helper) {
      return `<!-- @nodefony/frontend: helper not initialized for "${entryName}" -->`;
    }
    return helper.renderTags(entryName);
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
    // Multi-instance : autorise TOUTES les origines Vite actives (une par
    // famille, ports distincts). Sans ça, la page d'une famille servie depuis
    // un autre port que 5173 (ex. Angular sur 5177) serait bloquée par la CSP.
    const origins = this.viteOrigins();
    const httpSrc = origins.map((o) => `${scheme}://${o}`).join(" ");
    const wsSrc = origins.map((o) => `${wsScheme}://${o}`).join(" ");
    return [
      "default-src 'self'",
      // 'unsafe-inline' requis pour le preamble React Fast Refresh inliné par
      // TemplateHelper (HMR @vitejs/plugin-react). À retirer en prod — le bundle
      // production n'a pas besoin de scripts inline.
      `script-src 'self' 'unsafe-inline' ${httpSrc}`,
      // worker-src : certains modules (Vite, libs) créent un Worker depuis un
      // `blob:` → sans directive dédiée, le browser retombe sur script-src qui
      // n'autorise pas `blob:` → worker bloqué. Dev only.
      "worker-src 'self' blob:",
      `style-src 'self' 'unsafe-inline' ${httpSrc}`,
      `img-src 'self' data: blob: ${httpSrc}`,
      `font-src 'self' data: ${httpSrc}`,
      `connect-src 'self' blob: data: ${httpSrc} ${wsSrc}`,
      "object-src 'none'",
    ].join("; ");
  }

  /**
   * Origines (`host:port`) de toutes les instances Vite actives, dédupliquées.
   * Retombe sur l'origine de base si aucune instance n'a encore résolu son port.
   */
  private viteOrigins(): string[] {
    const set = new Set<string>();
    for (const s of this.supervisors.values()) {
      const st = s.status();
      if (st.port) set.add(`${st.host}:${st.port}`);
    }
    if (set.size === 0) {
      set.add(`${this.cfg.devHost}:${this.cfg.devPort}`);
    }
    return [...set];
  }
}

export default FrontendService;
