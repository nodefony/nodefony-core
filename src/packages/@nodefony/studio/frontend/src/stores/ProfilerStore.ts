import { makeAutoObservable, runInAction } from "mobx";
import { ApiError } from "../services/ApiClient";
import type { ApiClient } from "../services/ApiClient";

import type {
  IErrorSample,
  INPlusOne,
  IProfileEntry,
  IProfilePhase,
  IProfileQuery,
  IProfileReport,
  IProfileSecurity,
  IProfileSummary,
  IRouteStats,
  ISqlShapeStats,
} from "nodefony";

// Les types du profil et de son rapport viennent du cœur, par le point d'entrée
// PRINCIPAL (`nodefony`) : UNE définition pour le serveur, la barre, l'outil de
// l'agent et la console. Import de types : zéro octet à l'exécution.
export type ProfilePhase = IProfilePhase;
export type ProfileQuery = IProfileQuery;
export type ProfileSecurity = IProfileSecurity;
export type ProfileEntry = IProfileEntry;
export type ProfileSummary = IProfileSummary;
export type ProfileReport = IProfileReport;
export type RouteStats = IRouteStats;
export type NPlusOne = INPlusOne;
export type SqlShapeStats = ISqlShapeStats;
export type ErrorSample = IErrorSample;

const BASE = "/nodefony/profiler/api";

/**
 * ProfilerStore — le rapport du profileur PAR ROUTE (`/nodefony/profiler/api/summary`,
 * dev-only) : où part le temps de l'application. Chaque requête, une par une,
 * se lit dans les Journaux ; ici, les mêmes requêtes regroupées.
 */
export class ProfilerStore {
  summary: ProfileReport | null = null;
  loading = false;
  error: string | null = null;
  /**
   * `true` quand le data plane profiler renvoie 404 = profiler NON monté. Le
   * profiler est **dev-only** (`@nodefony/http` ne l'instancie pas en production :
   * overhead par requête + fuite d'info) → en prod l'onglet affiche un encart qui
   * renvoie vers l'onglet Debug, pas une erreur.
   */
  unavailable = false;

  /** Rafraîchissement automatique du rapport (poll). */
  autoRefresh = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly api: ApiClient) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  /** Charge (ou recharge) le rapport agrégé. */
  async loadSummary(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.unavailable = false;
    try {
      const report = await this.api.getAbsolute<ProfileReport>(
        `${BASE}/summary`,
      );
      runInAction(() => {
        this.summary = report;
        this.loading = false;
      });
    } catch (e) {
      runInAction(() => {
        // 404 = data plane profiler absent (dev-only → non monté en prod). Ce n'est
        // pas une erreur : on bascule sur l'encart « désactivé en prod » (ProfilingTab).
        if (e instanceof ApiError && e.status === 404) {
          this.unavailable = true;
        } else {
          this.error = e instanceof Error ? e.message : String(e);
        }
        this.loading = false;
      });
    }
  }

  /**
   * Vide l'anneau côté serveur puis relit : de quoi mesurer l'effet d'une
   * modification sur les seules requêtes qui la suivent.
   */
  async clear(): Promise<void> {
    try {
      await this.api.deleteAbsolute(`${BASE}/recent`);
    } catch {
      /* best-effort */
    }
    await this.loadSummary();
  }

  /** Active/désactive le poll du rapport (3 s). */
  setAutoRefresh(on: boolean): void {
    this.autoRefresh = on;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (on) {
      this.timer = setInterval(() => void this.loadSummary(), 3000);
    }
  }

  /** Stoppe le timer (à appeler à l'unmount de la page). */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.autoRefresh = false;
  }
}
