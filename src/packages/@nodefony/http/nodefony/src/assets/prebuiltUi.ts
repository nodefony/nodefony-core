import fs from "node:fs";
import path from "node:path";

/**
 * Molette de livraison de l'UI embarquée d'un module (`ui` dans sa config).
 * - `auto`   : Vite si possible (dev + sources + @nodefony/frontend), sinon statique.
 * - `static` : force les assets pré-buildés shippés dans le paquet npm.
 * - `vite`   : force le dev-server Vite (repo self-hosted / contrib).
 */
export type UiDeliveryMode = "auto" | "static" | "vite";

/** Mode effectivement résolu — `none` = UI indisponible (fail-loud à l'appelant). */
export type UiDeliveryResolved = "vite" | "static" | "none";

/** Résultat de {@link resolveUiDelivery} : mode effectif + raison LOGGABLE. */
export interface IUiDeliveryResolution {
  mode: UiDeliveryResolved;
  /** Pourquoi ce mode (toujours renseigné) — à logger tel quel par le module. */
  reason: string;
}

/** Entrées de {@link resolveUiDelivery}. */
export interface IUiDeliveryOptions {
  /** Molette demandée par la config du module (défaut `auto`). */
  requested?: UiDeliveryMode;
  /** `kernel.environment` (`development`, `production`, …). */
  environment: string | undefined;
  /** Le service `frontend` (@nodefony/frontend) est-il présent dans le container ? */
  hasFrontendService: boolean;
  /** Dossier des SOURCES front du module (ex. `<module>/frontend/src`). */
  sourcesDir: string;
  /** Chemin de l'index pré-buildé shippé npm (ex. `<module>/dist/frontend/index.html`). */
  distIndex: string;
}

/**
 * Résout le mode de livraison de l'UI embarquée d'un module.
 *
 * Pattern universel des admin-UI embarquées (bull-board, GraphiQL, profiler
 * Symfony) : le consommateur ne compile JAMAIS l'UI d'un module tiers — les
 * assets sont pré-buildés au publish et servis statiques. Le mode `vite`
 * (HMR) n'a de sens que là où les sources existent (repo self-hosted, `--link`).
 *
 * PUR hormis deux `existsSync` (boot uniquement, jamais dans le hot path).
 *
 * @returns le mode effectif + la raison à logger (fail-loud si `none`)
 */
export function resolveUiDelivery(
  opts: IUiDeliveryOptions,
): IUiDeliveryResolution {
  const requested = opts.requested ?? "auto";
  const hasSources = fs.existsSync(opts.sourcesDir);
  const hasPrebuilt = fs.existsSync(opts.distIndex);

  if (requested === "vite") {
    if (!opts.hasFrontendService) {
      return {
        mode: "none",
        reason: `ui: "vite" forced but @nodefony/frontend service is not registered`,
      };
    }
    if (!hasSources) {
      return {
        mode: "none",
        reason: `ui: "vite" forced but frontend sources are missing (${opts.sourcesDir})`,
      };
    }
    return { mode: "vite", reason: `ui: "vite" forced by config` };
  }

  if (requested === "static") {
    if (!hasPrebuilt) {
      return {
        mode: "none",
        reason: `ui: "static" forced but prebuilt index is missing (${opts.distIndex})`,
      };
    }
    return { mode: "static", reason: `ui: "static" forced by config` };
  }

  // auto
  if (opts.environment === "development" && opts.hasFrontendService) {
    if (hasSources) {
      return {
        mode: "vite",
        reason: "auto → vite (development + frontend service + sources)",
      };
    }
  }
  if (hasPrebuilt) {
    return {
      mode: "static",
      reason: `auto → static (prebuilt assets ${path.dirname(opts.distIndex)})`,
    };
  }
  return {
    mode: "none",
    reason:
      `auto → none: no Vite path (dev+frontend+sources) and no prebuilt index ` +
      `(${opts.distIndex}) — did the package ship its "prepack" UI build?`,
  };
}

/**
 * Vue minimale du service `server-static` de @nodefony/http, résolue PAR NOM
 * via le Container (même pattern anti-cycle que `@nodefony/frontend.setupProd`).
 */
interface IStaticMountService {
  addMount(prefix: string, dir: string): void;
}

/** Vue minimale du Container (résolution par nom uniquement). */
interface IContainerView {
  get?(name: string): unknown;
}

/** Vue minimale du Kernel (retry du mount si `server-static` pas encore créé). */
interface IKernelView {
  once(event: "onReady", cb: () => void): unknown;
}

/** Options de {@link PrebuiltUi}. */
export interface IPrebuiltUiOptions {
  /** Préfixe public des assets (ex. `/_assets/studio/`) — normalisé `/x/`. */
  publicPath: string;
  /** Dossier ABSOLU des assets pré-buildés (ex. `<module>/dist/frontend`). */
  distDir: string;
  /** Nom de l'index dans `distDir` (défaut `index.html`). */
  indexFile?: string;
}

/**
 * Livraison STATIQUE de l'UI pré-buildée d'un module (mode `static`).
 *
 * Deux responsabilités, zéro dépendance à @nodefony/frontend :
 *  1. {@link mount} — sert `distDir` sous `publicPath` via `server-static`
 *     (assets hashés immuables produits par `vite build` au publish).
 *  2. {@link renderIndex} — document HTML d'entrée (l'`index.html` transformé
 *     par Vite, tags déjà réécrits vers `publicPath`), nonce CSP injecté par
 *     requête. Le SPA fallback reste au controller du module (routes littérales,
 *     cf. StudioController).
 *
 * Perf : l'index est lu UNE fois (lazy, caché) ; seule l'injection du nonce
 * coûte un `replaceAll` par rendu — route d'entrée UI, jamais un hot path.
 */
export class PrebuiltUi {
  readonly publicPath: string;
  readonly distDir: string;
  private readonly indexPath: string;
  /** Template HTML caché — `null` tant que non lu (lazy). */
  private template: string | null = null;

  constructor(opts: IPrebuiltUiOptions) {
    let p = opts.publicPath.trim();
    if (!p.startsWith("/")) p = `/${p}`;
    if (!p.endsWith("/")) p = `${p}/`;
    this.publicPath = p.replace(/\/{2,}/g, "/");
    this.distDir = opts.distDir;
    this.indexPath = path.join(this.distDir, opts.indexFile ?? "index.html");
  }

  /**
   * Monte `distDir` sous `publicPath` auprès de `server-static` (résolu par
   * nom). Si le service n'existe pas encore (module chargé avant http), un
   * retry unique est armé sur `onReady`.
   *
   * @returns `true` si monté immédiatement, `false` si différé/indisponible
   *          (l'appelant loggue — ce helper n'a pas de logger)
   */
  mount(
    container: IContainerView | null | undefined,
    kernel?: IKernelView | null,
  ): boolean {
    const stat = container?.get?.("server-static") as
      IStaticMountService | undefined;
    if (stat?.addMount) {
      stat.addMount(this.publicPath, this.distDir);
      return true;
    }
    kernel?.once("onReady", () => {
      const late = container?.get?.("server-static") as
        IStaticMountService | undefined;
      late?.addMount?.(this.publicPath, this.distDir);
    });
    return false;
  }

  /**
   * Document HTML d'entrée de l'UI (index pré-buildé par Vite).
   *
   * @param nonce nonce CSP de la requête (`Context.cspNonce`) — injecté sur
   *              chaque `<script>` ; les assets `src` same-origin passent déjà
   *              par `'self'`, le nonce couvre un éventuel inline Vite.
   * @returns le HTML, ou un commentaire HTML fail-loud si l'index est absent
   */
  renderIndex(nonce?: string): string {
    if (this.template === null) {
      try {
        this.template = fs.readFileSync(this.indexPath, "utf8");
      } catch {
        // Pas de cache du cas d'erreur : un build apparu ensuite sera repris.
        return `<!DOCTYPE html><!-- prebuilt UI index missing: ${this.indexPath} -->`;
      }
    }
    if (!nonce) return this.template;
    return this.template.replaceAll("<script", `<script nonce="${nonce}"`);
  }
}
