import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { IAdminApi, IAdminDescriptor, IAdminEndpoint } from "nodefony";
import type { IViteSupervisorStatus } from "../interfaces/IViteSupervisor";
import type FrontendService from "../service/FrontendService";

// Résolveur relatif au package frontend → trouve les deps hoistées au root du
// workspace (react/vue/@angular/core/vite). SERVEUR uniquement (node:module/fs).
const requireFrom = createRequire(import.meta.url);
// Cache des versions lues — invariant au runtime (lu 1× par package, best-effort).
const versionCache = new Map<string, string | null>();

/**
 * Lit la `version` d'un package installé (best-effort, jamais throw). Tente d'abord
 * `<pkg>/package.json` (la plupart l'exportent), sinon remonte depuis le main résolu
 * jusqu'au `package.json` du package. Résultat caché (lu une seule fois).
 */
function pkgVersion(pkg: string): string | undefined {
  const cached = versionCache.get(pkg);
  if (cached !== undefined) return cached ?? undefined;
  let v: string | null = null;
  try {
    const p = requireFrom.resolve(`${pkg}/package.json`);
    v = (JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? null;
  } catch {
    try {
      let dir = path.dirname(requireFrom.resolve(pkg));
      for (let i = 0; i < 6 && dir; i++) {
        const cand = path.join(dir, "package.json");
        if (existsSync(cand)) {
          const j = JSON.parse(readFileSync(cand, "utf8")) as {
            name?: string;
            version?: string;
          };
          if (j.name === pkg) {
            v = j.version ?? null;
            break;
          }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      v = null;
    }
  }
  versionCache.set(pkg, v);
  return v ?? undefined;
}

/** Package npm du framework UI derrière un type de preset (pour la version). */
function frameworkPkg(type: string): string | null {
  switch (type) {
    case "react19":
      return "react";
    case "vue3":
      return "vue";
    case "angular":
      return "@angular/core";
    default:
      return null;
  }
}

/**
 * Producteur `IAdminApi` du builder frontend — exposé sous `/nodefony/frontend/api/*`.
 * Surface l'état du **superviseur Vite** (dev) pour la visibilité Studio : process Vite
 * (pid), port réel résolu, état (donc HMR actif), bundles servis.
 *
 * Vite est un outil **DEV-only** : en production le superviseur ne tourne pas (état
 * `idle`, pid `null`) — l'UI vient alors du bundle compilé (`manifest.json`). L'endpoint
 * répond dans les deux cas (best-effort, jamais throw) : le front en déduit l'affichage.
 */

/** Vue SÛRE d'une instance Vite — sans chemins FS absolus (anti info-leak). */
export interface IViteInstanceView {
  /** Famille d'isolation (`default`, `angular`, …). */
  family: string;
  /** État du superviseur (`ready` = HMR actif). */
  state: string;
  /** Hôte du serveur Vite (dev). */
  host: string;
  /** Port RÉEL résolu (Vite incrémente si occupé) — `null` si non démarré. */
  port: number | null;
  /** PID du process enfant Vite — `null` hors dev. */
  pid: number | null;
  /** Vite servi en HTTPS (suit la config du serveur). */
  https: boolean;
  /** Redémarrages du superviseur depuis le boot. */
  restartCount: number;
  /** Échecs de health-check du superviseur. */
  healthFailures: number;
  /** Entrées servies — nom logique + type + version du framework UI. */
  entries: { entryName: string; type: string; version?: string }[];
}

/** Snapshot frontend servi par l'endpoint `vite`. */
export interface IFrontendStatusView {
  /** Au moins une instance Vite `ready` (HMR actif). */
  available: boolean;
  /** Version de Vite (le builder), si résolue. */
  vite?: string;
  /** Instance principale (famille `default` ou la première). */
  primary: IViteInstanceView;
  /** Toutes les instances (multi-bundle). */
  bundles: IViteInstanceView[];
}

/** Mappe un statut superviseur vers la vue sûre (sans paths) + versions framework. */
function toView(family: string, status: IViteSupervisorStatus): IViteInstanceView {
  return {
    family,
    state: status.state,
    host: status.host,
    port: status.port,
    pid: status.pid,
    https: status.https,
    restartCount: status.restartCount,
    healthFailures: status.healthFailures,
    entries: status.entries.map((e) => {
      const pkg = frameworkPkg(e.type);
      return {
        entryName: e.entryName,
        type: e.type,
        version: pkg ? pkgVersion(pkg) : undefined,
      };
    }),
  };
}

/**
 * Construit le snapshot frontend (état Vite) — lecture pure, jamais throw.
 *
 * @param service - le {@link FrontendService} (résolu du container).
 * @returns la vue sûre prête à `renderJson` / push realtime.
 */
export function buildFrontendStatus(
  service: FrontendService,
): IFrontendStatusView {
  const all = service.statusAll();
  const bundles = all.map((b) => toView(b.family, b.status));
  const primary = toView("default", service.status());
  return {
    available: bundles.some((b) => b.state === "ready"),
    vite: pkgVersion("vite"),
    primary,
    bundles,
  };
}

const descriptor: IAdminDescriptor = {
  label: "Frontend",
  icon: "bolt",
  order: 6,
};

/**
 * Construit le producteur `IAdminApi` du frontend (namespace `"frontend"`).
 *
 * @param service - le {@link FrontendService} à introspecter.
 * @returns le contrat admin, prêt à `broker.register()`.
 */
export function createFrontendAdminApi(service: FrontendService): IAdminApi {
  const endpoints: IAdminEndpoint[] = [
    {
      path: "vite",
      summary:
        "État du superviseur Vite (dev) : process (pid), port réel, état (HMR actif si ready), bundles servis. Vide en prod (Vite ne tourne pas — UI servie par le bundle compilé).",
      handler: () => buildFrontendStatus(service),
    },
  ];

  return {
    adminNamespace: "frontend",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}
