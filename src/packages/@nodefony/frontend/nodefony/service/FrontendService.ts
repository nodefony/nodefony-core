import {
  Service,
  Module,
  Container,
  extend,
  injectable,
  FRONTEND_CHOICES,
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
  devBasePath,
  PRIMARY_FAMILY,
} from "../src/isolationGroups";
import defaultConfig, { type IFrontendConfig } from "../config/config";
import { stripTrailingSlashes } from "nodefony";
import path from "node:path";
import { summarizeFrontendBoot } from "./bootSummary";

/**
 * Vue minimale du service statique de `@nodefony/http` (résolu par nom via le
 * Container — `@nodefony/frontend` ne peut PAS importer `@nodefony/http`, cycle).
 */
interface IStaticMountService {
  addMount(prefix: string, dir: string): void;
  hasMounts(): boolean;
}

/**
 * Vue minimale du proxy inverse de `@nodefony/http` (résolu par nom, même
 * raison). En développement, chaque famille Vite y monte `/_vite/<famille>/`
 * (#528).
 */
interface IReverseProxyService {
  mount?(
    prefix: string,
    options: {
      target: () => string | undefined;
      websocket: boolean;
      methods: string[];
      stripHeaders: string[];
    },
  ): void;
  unmount?(prefix: string): void;
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
  private readonly cfg: IFrontendConfig;

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
    // Sans config déclarée, le module peut n'avoir reçu aucune section.
    const options = module.options as object | undefined;
    const merged = extend(
      true,
      {},
      defaultConfig,
      options ?? {},
    ) as IFrontendConfig;
    super(
      "frontend",
      module.container as Container,
      module.notificationsCenter,
      merged,
    );
    this.module = module;
    this.cfg = merged;
  }

  /** Base CDN normalisée (sans slash final). `""` = origine Nodefony. */
  private get assetBase(): string {
    return stripTrailingSlashes(this.cfg.assetBaseUrl);
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

    // Hook `onServersReady` (pas `onReady`) — Vite démarre APRÈS que les
    // serveurs Nodefony écoutent : rien ne peut lui être relayé avant (le relais
    // `/_vite/` vit dans leur pipeline), et le lancer ensuite ne retarde pas
    // l'ouverture des ports — Vite compile pendant que Nodefony sert déjà.
    this.kernel?.once("onServersReady", async () => {
      // Helpers de template `frontendTags`/`frontendDocument` : injectés par
      // render dans les locals Eta (`Controller.withFrontendLocals`) — pas de
      // registre global de moteur à amorcer ici.
      const env = this.kernel?.environment;
      if (env === "development" && this.cfg.autoStartInDevelopment) {
        if (this.entries.length === 0) {
          // `INFO` en anglais, cette ligne était indiscernable d'un framework
          // SANS front : le module est installé et câblé, mais rien ne dit que
          // la capacité existe ni comment l'atteindre. Un agent en conclut
          // qu'il doit écrire ses pages à la main. Le niveau et la commande
          // font toute la valeur du message — cf `nodefony create front`.
          const engines = FRONTEND_CHOICES.filter((c) => c !== "none").join(
            "|",
          );
          this.log(
            `aucune interface web n'est déclarée — le serveur de développement Vite ne démarre pas. ` +
              `Pour en poser une : \`nodefony create front [nom] --frontend <${engines}>\``,
            "WARNING",
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
          // Bilan de démarrage (core) : une ligne par instance — bundles servis
          // et port INTERNE de Vite, jamais une adresse à ouvrir (Vite passe
          // derrière Nodefony). Poussé AVANT le fire : le bilan lit ces lignes.
          // Le mur de journaux Vite reste au buffer/backplane (`--debug`).
          const summary = summarizeFrontendBoot(
            [...this.supervisors.values()].map((sup) => sup.status()),
          );
          const ready = summary.ready;
          this.kernel?.setBootLines("Frontend (Vite)", summary.lines);
          if (summary.notice) this.kernel?.reportBootNotice(summary.notice);
          this.kernel?.fire("onFrontendReady", {
            bundles: names.length,
            names,
            ready,
          });
        }
      } else if (env !== "development") {
        // Prod / cluster / staging : pas de Vite dev. Servir les assets buildés
        // (`public/dist/`) via le serveur statique de @nodefony/http + préparer
        // le helper qui lit les manifests (+ build one-shot si absent — cf TSDoc).
        await this.setupProd();
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
      [...this.supervisors.values()].at(0);
    if (!primary) {
      return {
        state: "idle",
        host: this.cfg.devHost,
        origin: null,
        port: null,
        pid: null,
        https: false,
        restartCount: 0,
        healthFailures: 0,
        portRetries: 0,
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

    // Propage l'environnement Nodefony à Vite :
    //  - NODE_ENV = kernel.environment (lu par les plugins Vite via process.env)
    //  - extraEnv = config.viteEnv → variables VITE_* exposées au browser
    const nodeEnv = this.kernel?.environment;
    const extraEnv = this.cfg.viteEnv;

    const groups = this.groupEntriesByFamily();
    // Plan de ports : un bloc disjoint par famille (`default` reste sur 5173).
    const portPlan = familyPortPlan(
      this.cfg.devPort,
      [...groups.keys()],
      this.cfg.resilience.portRetryAttempts,
    );
    const families = [...portPlan.keys()];

    // CSP AVANT le premier spawn (#135) : une page servie pendant que Vite
    // démarre doit déjà porter ce dont son rechargement à chaud aura besoin —
    // un CSP ne se renégocie pas. Il ne dépend plus d'aucun port : tout passe
    // par l'origine de la page (#528).
    this.#registerCsp();

    this.fire("frontend:starting", { entries: this.entries });

    // Progression pour la barre de boot (core `BootReporter`). La jauge compte les
    // BUNDLES (entries, = `onFrontendStart.bundles`), PAS les familles : une famille
    // multi-entry (1 serveur Vite, N bundles) en sert N d'un coup → on incrémente de
    // `famSize` à sa résolution (ready OU échec), `onFrontendProgress` met `done/total`.
    const total = this.entries.length;
    let done = 0;
    // `portPlan` est bâti sur les clés de `groups` : chaque famille y a son
    // groupe — le repli `[]` n'existe que pour le typage, jamais à l'exécution.
    const results = await Promise.allSettled(
      [...portPlan].map(([family, port]) => {
        const familyEntries = groups.get(family) ?? [];
        const famSize = familyEntries.length;
        return this.startFamily(family, familyEntries, port, {
          nodeEnv,
          extraEnv,
        }).finally(() => {
          done += famSize;
          this.kernel?.fire("onFrontendProgress", { ready: done, total });
        });
      }),
    );

    results.forEach((res, i) => {
      if (res.status === "rejected") {
        const reason: unknown = res.reason;
        const detail =
          reason instanceof Error ? reason.message : String(reason);
        this.log(
          `frontend family "${families[i]}" failed to start (isolated): ${detail}`,
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
      nodeEnv: string | undefined;
      extraEnv: Record<string, string>;
    },
  ): Promise<void> {
    // Une famille naît de ses entrées : ce repli ne sert qu'au type.
    const [first] = entries;
    if (first === undefined) throw new FrontendNoEntriesError();
    const r = this.cfg.resilience;
    const devBase = devBasePath(family);
    const supervisor = new ViteProcessSupervisor({
      devHost: this.cfg.devHost,
      devPort: port,
      devBase,
      startupTimeoutMs: this.cfg.startupTimeoutMs,
      pipeLogs: this.cfg.pipeViteLogs,
      cwd: first.root,
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
    const helper = new TemplateHelper(supervisor, "development");
    this.templateHelpers.set(family, helper);
    this.mountDevProxy(devBase, helper);

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
   * Monte `/_vite/<famille>/` sur le proxy inverse de `@nodefony/http` (#528).
   *
   * Tout ce que la page demande à Vite — modules, images importées, `url()`
   * CSS, socket du rechargement à chaud — porte ce préfixe (`base` Vite) et
   * reste donc sur l'ORIGINE DE LA PAGE : un certificat, aucun contenu mixte,
   * et les API réservées aux contextes sécurisés (caméra, Service Workers,
   * WebAuthn) disponibles depuis un téléphone, une IP de réseau local ou un
   * navigateur en conteneur. Vite, lui, reste sur la boucle locale.
   *
   * GET/HEAD seulement (Vite ne sert que des lectures) ; `cookie` et
   * `authorization` ne lui parviennent pas — un serveur de sources n'a pas à
   * voir la session. Posé avant `start()` : tant que Vite n'est pas prêt, la
   * cible est inconnue et le relais répond `503` — à la socket de sonde du
   * client Vite comprise, AVANT tout `101` : la page ne recharge qu'une fois
   * Vite revenu, jamais sur une page blanche (#577). No-op sans proxy
   * (application sans serveur HTTP).
   *
   * @param devBase - chemin de base de la famille (`devBasePath`)
   * @param helper - helper de la famille, qui connaît son superviseur
   */
  private mountDevProxy(devBase: string, helper: TemplateHelper): void {
    const proxy = this.container?.get("reverse-proxy") as
      IReverseProxyService | undefined;
    if (!proxy) return;
    // Un `@nodefony/http` désaligné (sans proxy) donnerait une page blanche
    // sans un mot : on le dit, avec le geste.
    if (typeof proxy.mount !== "function") {
      this.log(
        `relais ${devBase} impossible : le service reverse-proxy ne sait pas monter un préfixe — ` +
          "le front ne se chargera pas en développement. " +
          "Aligner @nodefony/http sur la version de @nodefony/frontend.",
        "WARNING",
      );
      return;
    }
    proxy.mount(devBase, {
      target: () => helper.devTarget(),
      websocket: true,
      methods: ["GET", "HEAD"],
      stripHeaders: ["cookie", "authorization"],
    });
  }

  /**
   * Câblage prod (idempotent) : monte chaque `outDir` sur son `publicPath`
   * auprès du serveur statique `server-static` (résolu par nom — pas d'import
   * http) et crée le helper prod (lecture manifests). No-op si pas d'entrée.
   *
   * Une entrée SANS build servirait une page blanche : jamais en silence.
   * Cas nominal cloud-native : le build est fait à l'image (`npm run build`,
   * qui chaîne `frontend:build` dans les apps générées) → manifest présent,
   * zéro travail ici. Cas « prod essayée sur le poste » (devDeps installées →
   * vite résolvable) : build one-shot au boot — idempotent, et il supprime
   * l'écran blanc qui perd l'utilisateur, surtout en `--detach`. Sans vite
   * (image runtime sans devDependencies) : impossible de réparer ici → on
   * NOMME l'entrée, le manifest attendu et le geste, en ERROR.
   * Cf project_resilience_no_silent_degradation (fail-soft dispo, fail-loud
   * dégradation — tout fallback annoncé).
   */
  private async setupProd(): Promise<void> {
    if (this.prodHelper) return;
    if (this.entries.length === 0) {
      this.log(
        "no frontend entries declared — prod static not mounted",
        "INFO",
      );
      return;
    }
    const unbuilt = this.entries.filter(
      (e) => !fs.existsSync(path.join(e.outDir, ".vite", "manifest.json")),
    );
    if (unbuilt.length > 0) {
      const names = unbuilt.map((e) => e.entryName).join(", ");
      try {
        this.log(
          `entrée(s) frontend sans build (${names}) — construction au boot (one-shot). ` +
            `En production réelle, builde à l'image : npm run build.`,
          "WARNING",
        );
        const r = await this.build();
        if (r.failures.length > 0) {
          this.log(
            `build front en ÉCHEC au boot (${r.failures
              .map((f) => f.entryName)
              .join(", ")}) — ces pages seront servies SANS interface`,
            "ERROR",
          );
        }
      } catch (e) {
        this.log(
          `entrée(s) frontend sans build (${names}) et vite indisponible ici — ` +
            `les pages seront servies SANS interface (blanches). ` +
            `Builde AVANT de lancer : npm run build (ou nodefony frontend:build), ` +
            `puis redémarre. Si vite manque aussi en développement, il n'est pas ` +
            `une dépendance de ce module : installe-le côté application ` +
            `(npm i -D vite, plus le plugin de ton framework). ` +
            `Détail : ${e instanceof Error ? e.message : String(e)}`,
          "ERROR",
        );
      }
    }
    const stat = this.container?.get("server-static") as
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
    // Proxy : plus de Vite derrière — le préfixe redevient une URL ordinaire.
    const proxy = this.container?.get("reverse-proxy") as
      IReverseProxyService | undefined;
    for (const family of this.supervisors.keys()) {
      proxy?.unmount?.(devBasePath(family));
    }
    this.supervisors.clear();
    this.templateHelpers.clear();
    this.entryFamily.clear();
    // CSP : retirer les origines Vite du firewall (le CSP repasse au strict de base).
    (
      this.container?.get("firewall") as
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
   * ⚠️ **`NODE_ENV` est posé le temps du build, et restauré.** Vite dérive son
   * `isProduction` de `process.env.NODE_ENV`, qui **prime sur le `mode`** de la
   * configuration : une commande CLI, dont le kernel démarre en développement,
   * produisait donc un bundle de DÉVELOPPEMENT malgré `mode: "production"` —
   * `import.meta.env.DEV` vrai chez l'utilisateur final (tout code gardé par ce
   * drapeau s'exécutait en production), et les messages d'aide de Vue publiés.
   * La restauration n'est pas une précaution de style : `build()` est aussi
   * appelé par `setupProd()`, et laisser la variable retournée marquerait un
   * process de développement comme production pour le reste de sa vie.
   *
   * @param opts.force ignore le cache de fraîcheur (rebuild systématique).
   */
  async build(opts?: {
    force?: boolean | undefined;
  }): Promise<IFrontendBuildResult> {
    if (this.entries.length === 0) throw new FrontendNoEntriesError();
    const vite = (await import("vite")) as {
      build: (cfg: Record<string, unknown>) => Promise<unknown>;
    };
    const result: IFrontendBuildResult = {
      built: [],
      skipped: [],
      failures: [],
    };
    const nodeEnvBefore = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      return await this.#buildEntries(vite, result, opts);
    } finally {
      // `delete` et non `= undefined` : une variable d'environnement posée à la
      // chaîne « undefined » est LUE comme une valeur par tout ce qui la teste.
      if (nodeEnvBefore === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvBefore;
    }
  }

  /**
   * La boucle de build proprement dite — extraite pour que `build()` ne porte
   * que la garde d'environnement, et que le `finally` de restauration couvre
   * tous les chemins de sortie sans indenter cent lignes.
   */
  async #buildEntries(
    vite: { build: (cfg: Record<string, unknown>) => Promise<unknown> },
    result: IFrontendBuildResult,
    opts?: { force?: boolean | undefined },
  ): Promise<IFrontendBuildResult> {
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
    const firewall = this.container?.get("firewall") as
      | {
          registerCspOrigins?: (m: string, f: Record<string, string[]>) => void;
        }
      | undefined;
    firewall?.registerCspOrigins?.("frontend", this.#viteCspFragment());
  }

  /**
   * Fragment CSP des besoins Vite DEV — sans aucune origine : modules,
   * styles, images et socket du rechargement à chaud passent tous par
   * l'origine de la page (`/_vite/<famille>/`, #528). Deux exigences restent :
   *  1. **`'self'` dans CHAQUE directive** : `connect-src`/`style-src`/`img-src`/
   *     `font-src` n'héritent PAS de `default-src`. `'self'` couvre aussi le
   *     socket `ws(s):` de même hôte et port (CSP niveau 3).
   *  2. Tokens : `'unsafe-eval'` (React Fast Refresh — le nonce ne couvre PAS
   *     l'eval) et `'unsafe-inline'` style (styles injectés par Vite). PAS de
   *     `'unsafe-inline'` script : le preamble inline est NONCÉ.
   * Mergé par le firewall (jamais en prod : `startDev` ne tourne pas en
   * production → CSP strict same-origin).
   */
  #viteCspFragment(): Record<string, string[]> {
    return {
      "script-src": ["'self'", "'unsafe-eval'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "worker-src": ["'self'", "blob:"],
      // + avatars externes (Gravatar / Google / GitHub) — aligné sur le défaut
      // CSP de @nodefony/security.
      "img-src": [
        "'self'",
        "data:",
        "blob:",
        "https://www.gravatar.com",
        "https://*.googleusercontent.com",
        "https://avatars.githubusercontent.com",
      ],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'", "blob:", "data:"],
    };
  }
}

export default FrontendService;
