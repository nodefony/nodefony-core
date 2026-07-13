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

  /**
   * Environnement du SERVEUR (`development` | `production` | `test`…), lu sur
   * `/studio/api/info`. `null` tant qu'il n'est pas connu.
   *
   * Sert à ne pas proposer une page dont le back n'existe pas dans cet
   * environnement : le data plane du **Playground** n'est monté qu'en
   * développement (il EXÉCUTE des actions depuis le navigateur) → en production,
   * l'entrée de menu mènerait à un écran mort. Masquer l'entrée est du CONFORT :
   * la vraie garde reste le serveur (l'API n'existe pas), jamais ce booléen.
   */
  env: string | null = null;

  /** Réponses des endpoints invoqués, indexées par chemin absolu. */
  invocations = new Map<string, AdminInvocation>();

  constructor(private readonly api: ApiClient) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  /** Le serveur tourne-t-il en production ? (inconnu → on suppose que NON). */
  get isProd(): boolean {
    return this.env === "production";
  }

  /**
   * Lit l'identité du serveur (nom, version, environnement). Endpoint volontairement
   * pauvre côté back (pré-login, hors firewall) : name/version/env, rien de plus.
   * Silencieux en cas d'échec — l'environnement reste `null` et le menu montre tout
   * (préférer une entrée de trop à une entrée manquante par erreur réseau).
   */
  async loadInfo(): Promise<void> {
    try {
      const info = await this.api.get<{ env?: string }>("/info");
      runInAction(() => {
        this.env = typeof info.env === "string" ? info.env : null;
      });
    } catch {
      /* identité inconnue → aucun filtrage par environnement */
    }
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

  /**
   * Purge les données admin mémorisées (catalogue + réponses d'endpoints invoqués).
   * Appelé au CHANGEMENT D'IDENTITÉ (réaction RootStore) : aucune réponse d'admin
   * d'une identité précédente ne survit dans ce store singleton (hors arbre React),
   * en complément du remontage par clé d'AuthGuard. Défense en profondeur — le
   * garant reste le RBAC serveur (403), pas ce nettoyage.
   */
  reset(): void {
    this.producers = [];
    this.invocations.clear();
    this.error = null;
    this.loading = false;
  }

  /** Total d'endpoints exposés (tous producteurs confondus). */
  get endpointCount(): number {
    return this.producers.reduce((n, p) => n + p.endpoints.length, 0);
  }
}
