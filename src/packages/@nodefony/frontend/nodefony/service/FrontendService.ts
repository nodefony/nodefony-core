import {
  Service,
  Module,
  Container,
  Event,
  extend,
  injectable,
} from "nodefony";
import type {
  IFrontendService,
  IFrontendBuildResult,
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
import fs from "node:fs";
import {
  isolationGroup,
  familyPortPlan,
  PRIMARY_FAMILY,
} from "../src/isolationGroups";
import defaultConfig, { type FrontendConfig } from "../config/config";
import path from "node:path";

/**
 * Vue minimale du service statique de `@nodefony/http` (résolu par nom via le
 * Container — `@nodefony/frontend` ne peut PAS importer `@nodefony/http`, cycle).
 */
interface IStaticMountService {
  addMount(prefix: string, dir: string): void;
  hasMounts(): boolean;
}

/**
 * Normalise un préfixe public : garantit un `/` en tête et en queue.
 * `"_assets/x"` → `"/_assets/x/"`, `"/"` → `"/"`.
 */
const normalizePublicPath = (p: string): string => {
  let s = p.trim();
  if (!s.startsWith("/")) s = `/${s}`;
  if (!s.endsWith("/")) s = `${s}/`;
  return s.replace(/\/{2,}/g, "/");
};

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
  /** Helper prod unique (lit les manifests) — `null` tant qu'on n'est pas en prod. */
  private prodHelper: TemplateHelper | null = null;

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

  /** Base CDN normalisée (sans slash final). `""` = origine Nodefony. */
  private get assetBase(): string {
    return (this.cfg.assetBaseUrl ?? "").replace(/\/+$/, "");
  }

  /**
   * Résout l'URL publique d'un asset. Préfixe `p` par `assetBaseUrl` (CDN) si
   * renseigné, sinon le renvoie tel quel (origine, chemin relatif). Les URLs
   * absolues (`http(s)://…`) sont renvoyées inchangées. Helper template :
   * `asset('/test/logo.png')` → `https://cdn.example.com/test/logo.png` ou
   * `/test/logo.png` (assetBaseUrl vide).
   */
  assetUrl(p: string): string {
    if (/^https?:\/\//i.test(p)) return p;
    const base = this.assetBase;
    if (!base) return p;
    return base + (p.startsWith("/") ? p : `/${p}`);
  }

  async init(): Promise<this> {
    this.log(`MODULE frontend service init`, "DEBUG");

    // Hook `onServersReady` (pas `onReady`) — Vite ne doit spawner qu'APRÈS que
    // les 4 serveurs Nodefony (HTTP/HTTPS/WS/WSS) écoutent, sinon le proxy Vite
    // tape un backend qui n'est pas encore prêt et les premiers fetch échouent.
    this.kernel?.once("onServersReady", async () => {
      // Helpers de template `frontendTags`/`frontendDocument` : injectés par
      // render dans les locals Eta (`Controller.withFrontendLocals`) — pas de
      // registre global de moteur à amorcer ici.
      const env = this.kernel?.environment;
      if (env === "development" && this.cfg.autoStartInDevelopment) {
        if (this.entries.length === 0) {
          this.log(
            "no frontend entries declared — Vite supervisor not started",
            "INFO",
          );
          return;
        }
        // Pont UI de boot (core `BootReporter`) : la compilation Vite vit HORS du
        // cycle Kernel (spawn async qui finit après `onPostReady`). On émet deux
        // events Kernel pour que la checklist de boot dev affiche la ligne Vite
        // AVANT le « ✓ Prêt ». `onFrontendStart` est SYNCHRONE (avant le `await`
        // ci-dessous → donc avant `onPostReady`) ; `onFrontendReady` en `finally`
        // débloque toujours le récap (succès comme échec). Dev-only (autre env →
        // branche prod). Aucun listener (boot direct/prod) → `fire` no-op.
        const names = this.entries.map((e) => e.entryName);
        this.kernel?.fire("onFrontendStart", { bundles: names.length });
        try {
          await this.startDev();
        } catch (e) {
          this.log(e, "ERROR");
        } finally {
          // Récap boot (core `BootReporter`) : une ligne par entrée servie =
          // « nom  URL HMR  framework » (l'URL que le dev ouvre). Poussé AVANT le
          // fire (le reporter lit ces lignes au « ✓ Prêt »). Dev-only ; le mur de
          // logs Vite reste au buffer/backplane (visible en `--debug`).
          let ready = 0;
          for (const [, sup] of this.supervisors) {
            const st = sup.status();
            if (st.state !== "ready") continue;
            ready++;
            const scheme = st.https ? "https" : "http";
            const url = `${scheme}://${st.host}:${st.port}/`;
            for (const e of st.entries) {
              const fw = e.type.replace(/[0-9]+$/, ""); // react19 → react
              this.kernel?.reportBootLine(
                "Frontend (Vite)",
                `${e.entryName.padEnd(24)}${url}${fw ? `   ${fw}` : ""}`,
              );
            }
          }
          this.kernel?.fire("onFrontendReady", {
            bundles: names.length,
            names,
            ready,
          });
        }
      } else if (env !== "development") {
        // Prod / cluster / staging : pas de Vite. Servir les assets buildés
        // (`public/dist/`) via le serveur statique de @nodefony/http + préparer
        // le helper qui lit les manifests.
        this.setupProd();
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
    const moduleRoot =
      (consumerModule as unknown as { path?: string }).path ?? process.cwd();
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
    const entryName = declaration.name ?? consumerModule.name;
    const entry: IResolvedFrontendEntry = {
      moduleName: consumerModule.name,
      entryName,
      type: declaration.type,
      root,
      entryFile: relEntry,
      outDir,
      // Défaut `/_assets/<entryName>/` : isole chaque bundle (pas de collision
      // multi-module) + sert de `base` Vite ET de mount prefix statique.
      publicPath: normalizePublicPath(
        declaration.publicPath ?? `/_assets/${entryName}`,
      ),
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
      this.supervisors.get(PRIMARY_FAMILY) ?? [...this.supervisors.values()][0];
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

  statusAll(): ReadonlyArray<{
    family: string;
    status: IViteSupervisorStatus;
  }> {
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
      [...this.supervisors.values()].some((s) => s.status().state === "ready")
    ) {
      return;
    }

    const backendOrigin = `${this.cfg.backendProtocol}://${this.cfg.backendHost}:${this.resolveBackendPort()}`;
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

    // Progression pour la barre de boot (core `BootReporter`). La jauge compte les
    // BUNDLES (entries, = `onFrontendStart.bundles`), PAS les familles : une famille
    // multi-entry (1 serveur Vite, N bundles) en sert N d'un coup → on incrémente de
    // `famSize` à sa résolution (ready OU échec), `onFrontendProgress` met `done/total`.
    const total = this.entries.length;
    let done = 0;
    const results = await Promise.allSettled(
      families.map((family) => {
        const famSize = groups.get(family)!.length;
        return this.startFamily(
          family,
          groups.get(family)!,
          portPlan.get(family)!,
          { backendOrigin, https, nodeEnv, extraEnv },
        ).finally(() => {
          done += famSize;
          this.kernel?.fire("onFrontendProgress", { ready: done, total });
        });
      }),
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
    // CSP (P6 J5 étape B) : déclarer les origines Vite au firewall (UN seul CSP émis
    // par security ensuite). Après ready → ports Vite résolus (viteOrigins à jour).
    this.#registerCsp();
    this.fire("frontend:ready", this.status());
  }

  /**
   * Port backend que Vite doit proxifier — le port RÉELLEMENT écouté, pas celui
   * qu'on espérait.
   *
   * `config.backendPort` (5151) n'est qu'une intention : avec
   * `servers.portPolicy: "auto"`, un port occupé fait glisser l'écoute du backend
   * (5151 → 5153). Un proxy figé sur 5151 enverrait alors les appels API du front
   * vers le serveur d'une AUTRE app — au mieux des 404, au pire les données du
   * voisin. On lit donc le port sur le serveur lui-même.
   *
   * Résolution par NOM (`server-http`), jamais par import : `@nodefony/frontend`
   * ne dépend pas de `@nodefony/http` (cycle via la config d'app).
   */
  private resolveBackendPort(): number {
    const server = this.container?.get?.("server-http") as
      { port?: number; active?: boolean } | undefined;
    const real = server?.active && server.port ? server.port : 0;
    if (real > 0 && real !== this.cfg.backendPort) {
      this.log(
        `backend à l'écoute sur ${real} (et non ${this.cfg.backendPort}) — ` +
          `le proxy Vite suit le port réel`,
        "INFO",
      );
    }
    return real > 0 ? real : this.cfg.backendPort;
  }

  /**
   * Résout les certificats HTTPS partagés (service `certificates` de
   * @nodefony/http) si `https: true`. Pas de duplication — mêmes PEM que
   * `server-https` (5152). Retombe sur HTTP avec un warning si indisponible.
   */
  private resolveHttps(): { keyPath: string; certPath: string } | undefined {
    if (!this.cfg.https) return undefined;
    const certs = this.container?.get?.("certificates") as
      { privateKeyPath?: string; certPath?: string } | undefined;
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
    this.templateHelpers.set(
      family,
      new TemplateHelper(supervisor, "development"),
    );

    // Le builder n'est pas utilisé en dev (config générée par le generator),
    // mais on passe la config (vide) pour respecter le contrat.
    const cfg = await this.builder.buildViteConfig([...entries], "development");
    await supervisor.start(entries, cfg);
    this.log(
      `vite [${family}] ready on ${supervisor.status().host}:${supervisor.status().port}`,
      "INFO",
    );
  }

  /**
   * Câblage prod (idempotent) : monte chaque `outDir` sur son `publicPath`
   * auprès du serveur statique `server-static` (résolu par nom — pas d'import
   * http) et crée le helper prod (lecture manifests). No-op si pas d'entrée.
   */
  private setupProd(): void {
    if (this.prodHelper) return;
    if (this.entries.length === 0) {
      this.log(
        "no frontend entries declared — prod static not mounted",
        "INFO",
      );
      return;
    }
    const stat = this.container?.get?.("server-static") as
      IStaticMountService | undefined;
    if (stat?.addMount) {
      for (const e of this.entries) {
        stat.addMount(e.publicPath, e.outDir);
        this.log(`prod static mount ${e.publicPath} → ${e.outDir}`, "INFO");
      }
    } else {
      this.log(
        "server-static service unavailable — assets won't be served by Nodefony (expecting a frontal proxy)",
        "WARNING",
      );
    }
    this.prodHelper = new TemplateHelper(
      null,
      "production",
      this.entries,
      this.assetBase,
    );
    this.fire("frontend:ready", this.status());
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
    // CSP : retirer les origines Vite du firewall (le CSP repasse au strict de base).
    (
      this.container?.get?.("firewall") as
        { unregisterCspOrigins?: (m: string) => void } | undefined
    )?.unregisterCspOrigins?.("frontend");
    this.fire("frontend:stopped");
  }

  /**
   * Build production — `vite.build()` **par entry** (chaque bundle a son propre
   * `root`/`outDir`/`base`/`manifest` : multi-module + isolation Angular).
   *
   * Idempotent : une entrée dont le `manifest.json` est plus récent que ses
   * sources est **ignorée** (`skipped`) — relance prod console rapide. `force`
   * rebuild tout. Les échecs sont **collectés** (un bundle KO n'arrête pas les
   * autres) et remontés dans `failures` → la commande CLI casse l'exit code.
   *
   * @param opts.force ignore le cache de fraîcheur (rebuild systématique).
   */
  async build(opts?: { force?: boolean }): Promise<IFrontendBuildResult> {
    if (this.entries.length === 0) throw new FrontendNoEntriesError();
    const vite = (await import("vite")) as {
      build: (cfg: Record<string, unknown>) => Promise<unknown>;
    };
    const result: IFrontendBuildResult = {
      built: [],
      skipped: [],
      failures: [],
    };
    for (const entry of this.entries) {
      if (!opts?.force && this.isBuildFresh(entry)) {
        result.skipped.push(entry.entryName);
        this.log(
          `build skip "${entry.entryName}" (à jour — --force pour forcer)`,
          "INFO",
        );
        continue;
      }
      try {
        const cfg = await this.builder.buildViteConfig(
          [entry],
          "production",
          this.assetBase,
        );
        await vite.build(cfg);
        result.built.push(entry.entryName);
        this.log(`build ok "${entry.entryName}" → ${entry.outDir}`, "INFO");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result.failures.push({ entryName: entry.entryName, message });
        this.log(`build FAILED "${entry.entryName}": ${message}`, "ERROR");
      }
    }
    this.log(
      `frontend build: ${result.built.length} built, ${result.skipped.length} skipped, ${result.failures.length} failed`,
      result.failures.length ? "WARNING" : "INFO",
    );
    return result;
  }

  /**
   * Une entrée est « fraîche » si son `manifest.json` existe ET qu'aucun fichier
   * source (sous `root`, hors `node_modules`/`outDir`/`.vite`) n'est plus récent.
   * Scan disque borné (dossier front petit) — évite un rebuild Vite inutile.
   */
  private isBuildFresh(entry: IResolvedFrontendEntry): boolean {
    let manifestMtime: number;
    try {
      manifestMtime = fs.statSync(
        path.join(entry.outDir, ".vite", "manifest.json"),
      ).mtimeMs;
    } catch {
      return false;
    }
    return this.newestSourceMtime(entry.root, entry.outDir) <= manifestMtime;
  }

  /** Mtime du fichier le plus récent sous `dir` (récursif borné). */
  private newestSourceMtime(dir: string, outDir: string): number {
    let newest = 0;
    const walk = (d: string): void => {
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of items) {
        if (it.name === "node_modules" || it.name === ".vite") continue;
        const full = path.join(d, it.name);
        if (full === outDir) continue;
        if (it.isDirectory()) walk(full);
        else {
          try {
            const m = fs.statSync(full).mtimeMs;
            if (m > newest) newest = m;
          } catch {
            /* fichier disparu entre readdir et stat — ignore */
          }
        }
      }
    };
    walk(dir);
    return newest;
  }

  /**
   * Document HTML complet pour une entrée — lit l'`index.html` du module
   * (le dev y met meta/polices/scripts externes) + injecte les tags Nodefony.
   * Le controller renvoie : `this.render(svc.renderDocument("x", this.context.cspNonce))`.
   * @param nonce nonce CSP de la requête (`Context.cspNonce`) — propagé aux `<script>`.
   */
  renderDocument(entryName: string, nonce?: string): string {
    if (this.prodHelper) {
      return this.prodHelper.renderDocument(entryName, nonce);
    }
    const family = this.entryFamily.get(entryName);
    const helper = family ? this.templateHelpers.get(family) : undefined;
    if (!helper) {
      return `<!-- @nodefony/frontend: helper not initialized for "${entryName}" -->`;
    }
    return helper.renderDocument(entryName, nonce);
  }

  renderTags(entryName: string, nonce?: string): string {
    // Prod : helper unique qui lit les manifests (Vite ne tourne pas).
    if (this.prodHelper) {
      return this.prodHelper.renderTags(entryName, nonce);
    }
    const family = this.entryFamily.get(entryName);
    const helper = family ? this.templateHelpers.get(family) : undefined;
    if (!helper) {
      return `<!-- @nodefony/frontend: helper not initialized for "${entryName}" -->`;
    }
    return helper.renderTags(entryName, nonce);
  }

  /**
   * Déclare les origines Vite dev au firewall `@nodefony/security` (résolution PAR
   * NOM = anti-cycle, comme `setupProd`/`server-static`). Le firewall émet alors UN
   * seul CSP (nonce + origines mergées) → remplace le hack `setHeader` des controllers.
   * No-op si security absent (app sans firewall).
   */
  #registerCsp(): void {
    const firewall = this.container?.get?.("firewall") as
      | {
          registerCspOrigins?: (m: string, f: Record<string, string[]>) => void;
        }
      | undefined;
    firewall?.registerCspOrigins?.("frontend", this.#viteCspFragment());
  }

  /**
   * Fragment CSP des besoins Vite DEV. Deux exigences :
   *  1. **`'self'` dans CHAQUE directive** : `connect-src`/`style-src`/`img-src`/
   *     `font-src` n'héritent PAS de `default-src` → sans `'self'`, tout le
   *     same-origin (fetch API, styles, images, fonts) serait bloqué.
   *  2. **Origines Vite sur tous les hosts de dev** : loopback + `kernel.domain`
   *     + la liste `trustedHosts` du module http (vhosts comme `nodefony.com`) ×
   *     ports Vite. Sans ça, accéder via un vhost bloque les ressources Vite.
   * Tokens : `'unsafe-eval'` (React Fast Refresh — le nonce ne couvre PAS l'eval)
   * et `'unsafe-inline'` style (styles injectés par Vite). PAS de `'unsafe-inline'`
   * script : le preamble inline est NONCÉ. Mergé par le firewall (jamais en prod :
   * `startDev` ne tourne pas en production → CSP strict same-origin).
   */
  #viteCspFragment(): Record<string, string[]> {
    const scheme = this.cfg.https ? "https" : "http";
    const wsScheme = this.cfg.https ? "wss" : "ws";
    // Ports Vite réels (un par famille) — réutilise `viteOrigins` (host:port).
    const ports = new Set(
      this.viteOrigins().map((o) => o.slice(o.lastIndexOf(":") + 1)),
    );
    // Hosts par lesquels le dev accède LÉGITIMEMENT : loopback + domaine canonique
    // + `trustedHosts` du http (résolu PAR NOM, anti-cycle — comme firewall/static).
    const hosts = new Set<string>(["127.0.0.1", "localhost"]);
    if (this.kernel?.domain) hosts.add(this.kernel.domain);
    const th = (
      this.container?.get?.("HttpKernel") as
        { trustedHosts?: boolean | string | string[] } | undefined
    )?.trustedHosts;
    if (typeof th === "string") hosts.add(th);
    else if (Array.isArray(th)) for (const h of th) hosts.add(h);
    const httpSrc: string[] = [];
    const wsSrc: string[] = [];
    for (const h of hosts)
      for (const p of ports) {
        httpSrc.push(`${scheme}://${h}:${p}`);
        wsSrc.push(`${wsScheme}://${h}:${p}`);
      }
    return {
      "script-src": ["'self'", "'unsafe-eval'", ...httpSrc],
      "style-src": ["'self'", "'unsafe-inline'", ...httpSrc],
      "worker-src": ["'self'", "blob:"],
      // + avatars externes (Gravatar / Google / GitHub) — aligné sur le défaut
      // CSP de @nodefony/security (en dev, le studio override le CSP via ce
      // helper pour autoriser les hosts Vite cross-origin).
      "img-src": [
        "'self'",
        "data:",
        "blob:",
        "https://www.gravatar.com",
        "https://*.googleusercontent.com",
        "https://avatars.githubusercontent.com",
        ...httpSrc,
      ],
      "font-src": ["'self'", "data:", ...httpSrc],
      "connect-src": ["'self'", "blob:", "data:", ...httpSrc, ...wsSrc],
    };
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
