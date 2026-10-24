import { makeAutoObservable, runInAction } from "mobx";
import { ApiError } from "../services/ApiClient";
import type { ApiClient } from "../services/ApiClient";

import type {
  IProfileEntry,
  IProfilePhase,
  IProfileQuery,
  IProfileSecurity,
  IProfileSummary,
} from "nodefony";

// Les types du profil viennent du cœur, par le point d'entrée PRINCIPAL
// (`nodefony`) : UNE définition pour le serveur, la barre et la console. Pas
// par le sous-chemin `nodefony/debugbar` — ce fichier est un `.ts`, et le
// greffon Vite d'Angular (même instance Vite) trébuche sur un import de
// sous-chemin. Import de types : zéro octet à l'exécution.
export type ProfilePhase = IProfilePhase;
export type ProfileQuery = IProfileQuery;
export type ProfileSecurity = IProfileSecurity;
export type ProfileEntry = IProfileEntry;
export type ProfileSummary = IProfileSummary;

const BASE = "/nodefony/profiler/api";

/**
 * ProfilerStore — consomme le data plane profiler (`/nodefony/profiler/api/*`)
 * exposé par `@nodefony/http` (dev-only). Liste des dernières requêtes + détail
 * (waterfall des phases) à la sélection.
 *
 * Le rendu du waterfall réutilise `computeWaterfall` du Core isomorphe
 * (`nodefony/debugbar`) — même fonction pure que la debug bar par-page.
 */
export class ProfilerStore {
  recent: ProfileSummary[] = [];
  count = 0;
  loading = false;
  error: string | null = null;
  /**
   * `true` quand le data plane profiler renvoie 404 = profiler NON monté. Le
   * profiler est **dev-only** (`@nodefony/http` ne l'instancie pas en production :
   * overhead par requête + fuite d'info) → en prod l'onglet affiche un encart qui
   * renvoie vers l'onglet Debug, pas une erreur.
   */
  unavailable = false;

  selectedId: string | null = null;
  detail: ProfileEntry | null = null;
  detailLoading = false;
  detailError: string | null = null;

  /** Auto-refresh de la liste (poll). */
  autoRefresh = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly api: ApiClient) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  /** Charge (ou recharge) la liste des profils récents. */
  async loadRecent(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.unavailable = false;
    try {
      const res = await this.api.getAbsolute<{
        count?: number;
        entries?: ProfileSummary[];
      }>(`${BASE}/recent`);
      runInAction(() => {
        this.recent = res.entries ?? [];
        this.count = res.count ?? this.recent.length;
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

  /** Sélectionne une requête et charge son profil complet (phases). */
  async select(requestId: string): Promise<void> {
    this.selectedId = requestId;
    this.detail = null;
    this.detailLoading = true;
    this.detailError = null;
    try {
      const profile = await this.api.getAbsolute<ProfileEntry>(
        `${BASE}/${encodeURIComponent(requestId)}`,
      );
      runInAction(() => {
        // Ne pas écraser si l'utilisateur a re-sélectionné entretemps.
        if (this.selectedId === requestId) {
          this.detail = profile;
          this.detailLoading = false;
        }
      });
    } catch (e) {
      runInAction(() => {
        if (this.selectedId === requestId) {
          this.detailError = e instanceof Error ? e.message : String(e);
          this.detailLoading = false;
        }
      });
    }
  }

  /** Vide le ring buffer côté serveur + l'état local. */
  async clear(): Promise<void> {
    try {
      await this.api.deleteAbsolute(`${BASE}/recent`);
    } catch {
      /* best-effort */
    }
    runInAction(() => {
      this.recent = [];
      this.count = 0;
      this.selectedId = null;
      this.detail = null;
    });
  }

  /** Active/désactive le poll de la liste (3 s). */
  setAutoRefresh(on: boolean): void {
    this.autoRefresh = on;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (on) {
      this.timer = setInterval(() => void this.loadRecent(), 3000);
    }
  }

  /** Stoppe le timer (à appeler à l'unmount de la page). */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.autoRefresh = false;
  }
}
