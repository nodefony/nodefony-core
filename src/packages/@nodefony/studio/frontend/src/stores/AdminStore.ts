import { makeAutoObservable, runInAction } from "mobx";
import type { ApiClient } from "../services/ApiClient";

/** Un endpoint admin tel que décrit par le catalogue `/framework/api/admin`. */
export interface AdminEndpointMeta {
  method: string;
  path: string;
  role: string;
  summary: string | null;
}

/** Un producteur (module) du data plane admin + son descriptor. */
export interface AdminProducer {
  namespace: string;
  label: string;
  icon: string | null;
  order: number;
  role: string | null;
  endpoints: AdminEndpointMeta[];
}

/** Résultat d'une invocation d'endpoint (pour l'explorer). */
export interface AdminInvocation {
  loading: boolean;
  data?: unknown;
  error?: string;
  at?: number;
}

const CATALOG_PATH = "/nodefony/framework/api/admin";

/**
 * AdminStore — consomme le **catalogue** du data plane admin (discovery P10.2)
 * exposé par `@nodefony/framework`.
 *
 * Charge la liste des producteurs (`kernel`, `http`, `framework`, `syslog`, …)
 * + leurs endpoints depuis `/nodefony/framework/api/admin`, puis permet
 * d'invoquer n'importe quel endpoint GET (explorer générique). Aucune URL
 * codée en dur : la nav admin se génère depuis le catalogue.
 */
export class AdminStore {
  producers: AdminProducer[] = [];
  loading = false;
  error: string | null = null;

  /** Réponses des endpoints invoqués, indexées par chemin absolu. */
  invocations = new Map<string, AdminInvocation>();

  constructor(private readonly api: ApiClient) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  /** Charge (ou recharge) le catalogue des producteurs admin. */
  async loadCatalog(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const cat = await this.api.getAbsolute<{ producers: AdminProducer[] }>(
        CATALOG_PATH,
      );
      runInAction(() => {
        this.producers = cat.producers ?? [];
        this.loading = false;
      });
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
        this.loading = false;
      });
    }
  }

  /** Invoque un endpoint GET et mémorise sa réponse (indexée par `path`). */
  async invoke(path: string): Promise<void> {
    this.invocations.set(path, { loading: true });
    try {
      const data = await this.api.getAbsolute(path);
      runInAction(() => {
        this.invocations.set(path, { loading: false, data, at: Date.now() });
      });
    } catch (e) {
      runInAction(() => {
        this.invocations.set(path, {
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          at: Date.now(),
        });
      });
    }
  }

  /** Total d'endpoints exposés (tous producteurs confondus). */
  get endpointCount(): number {
    return this.producers.reduce((n, p) => n + p.endpoints.length, 0);
  }
}
