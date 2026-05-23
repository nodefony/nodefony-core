import type { IQueryFlow, ISlowQuery } from "../interfaces/IOrmFlow";

/**
 * Stats mutables de flux d'un connecteur. `slow` reste `null` tant qu'aucune
 * requête lente n'a été observée (lazy alloc — perf : pas de tableau « au cas où »).
 */
interface MutableFlow {
  total: number;
  sumMs: number;
  ewmaMs: number | null;
  lastMs: number | null;
  maxMs: number;
  slowTotal: number;
  slow: ISlowQuery[] | null;
}

/** Taille max du ring de requêtes lentes (borne mémoire). */
const MAX_SLOW = 20;
/** Facteur de lissage EWMA (0–1) : plus haut = suit plus vite les variations. */
const EWMA_ALPHA = 0.2;
/** Seuil « lent » par défaut (ms) — au-delà, la requête est capturée. */
const DEFAULT_SLOW_MS = 50;

/** Flux neutre d'un connecteur jamais observé (réutilisé, jamais muté). */
const EMPTY_FLOW: Omit<IQueryFlow, "connector" | "vendor"> = {
  total: 0,
  avgMs: null,
  ewmaMs: null,
  lastMs: null,
  maxMs: 0,
  slowTotal: 0,
  slow: [],
};

/**
 * **QueryFlowMonitor** — sonde de **débit ORM** per-instance (process-local),
 * agrégée et **indépendante de l'ALS** : compte les requêtes, suit leur latence
 * (moyenne + EWMA) et capture les plus lentes, pour le panneau Supervision
 * (« contrôle total » des ORM, patron sondes+hub).
 *
 * Distinct du **profiler par-requête** (debug bar, buffer de scope ALS, dev-only,
 * coût nul hors requête tracée) : ce moniteur observe le débit **global** et doit
 * donc compter en continu → il est **gaté** par {@link enabled} (OFF par défaut)
 * pour rester **coût nul en production** et ne pas pénaliser les bancs de charge
 * (qui instancient les adapters hors kernel → `enabled` reste à `false`). Le
 * module driver l'active au boot en environnement non-prod.
 *
 * Perf (règle ABSOLUE) :
 *  - structure lazy (`Map` allouée au 1ᵉʳ enregistrement, ring `slow` au 1ᵉʳ lent) ;
 *  - le hot path n'alloue rien hors cas lent et n'appelle **jamais** `toSQL()`
 *    (l'appelant ne capture le SQL que sur le chemin lent, rare) ;
 *  - le débit/s n'est pas calculé ici (dérivé du delta de `total` à la lecture)
 *    → 0 état mutable côté lecture, 0 ring de timestamps sous charge.
 *
 * Cloud-native : per-instance ; la vue multi-pod relève de l'agrégation
 * (Prometheus / fan-out Redis P13), pas de cette classe. Reset au restart.
 */
class QueryFlowMonitor {
  /** Sonde active ? OFF par défaut → coût nul tant que le driver ne l'active pas. */
  enabled = false;
  /** Seuil « lent » (ms) — modifiable par le driver/config. */
  slowMs = DEFAULT_SLOW_MS;
  /** `null` tant qu'aucune requête n'a été enregistrée (lazy). */
  #stats: Map<string, MutableFlow> | null = null;

  /** Active/désactive la sonde (appelé au boot du module driver selon l'env). */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** Crée/retourne les stats mutables d'un connecteur (alloue à la demande). */
  #ensure(connector: string): MutableFlow {
    if (this.#stats === null) {
      this.#stats = new Map();
    }
    let s = this.#stats.get(connector);
    if (s === undefined) {
      s = {
        total: 0,
        sumMs: 0,
        ewmaMs: null,
        lastMs: null,
        maxMs: 0,
        slowTotal: 0,
        slow: null,
      };
      this.#stats.set(connector, s);
    }
    return s;
  }

  /**
   * Enregistre une requête mesurée. À n'appeler **que** si {@link enabled} (le
   * tap appelant teste le drapeau pour éviter tout coût quand la sonde est OFF).
   *
   * @param connector - clé du connecteur ORM (registre).
   * @param durationMs - durée de la requête (ms).
   * @param sql - SQL paramétré+redacté, fourni **uniquement** si la requête est
   *   lente (l'appelant n'extrait le texte que sur le chemin lent — rare).
   */
  record(connector: string, durationMs: number, sql?: string): void {
    const s = this.#ensure(connector);
    s.total += 1;
    s.sumMs += durationMs;
    s.lastMs = durationMs;
    if (durationMs > s.maxMs) s.maxMs = durationMs;
    s.ewmaMs =
      s.ewmaMs === null
        ? durationMs
        : EWMA_ALPHA * durationMs + (1 - EWMA_ALPHA) * s.ewmaMs;
    if (durationMs >= this.slowMs) {
      s.slowTotal += 1;
      if (s.slow === null) s.slow = [];
      s.slow.unshift({ ts: Date.now(), durationMs, connector, sql });
      if (s.slow.length > MAX_SLOW) s.slow.length = MAX_SLOW;
    }
  }

  /**
   * Vue figée du flux d'un connecteur (ou flux neutre si jamais observé).
   *
   * @param connector - clé du connecteur ORM.
   * @param vendor - vendor de l'adapter (dérivé par l'appelant).
   */
  snapshot(connector: string, vendor: string): IQueryFlow {
    const s = this.#stats?.get(connector);
    if (s === undefined) {
      return { connector, vendor, ...EMPTY_FLOW };
    }
    const round = (v: number): number => Math.round(v * 100) / 100;
    return {
      connector,
      vendor,
      total: s.total,
      avgMs: s.total ? round(s.sumMs / s.total) : null,
      ewmaMs: s.ewmaMs === null ? null : round(s.ewmaMs),
      lastMs: s.lastMs === null ? null : round(s.lastMs),
      maxMs: round(s.maxMs),
      slowTotal: s.slowTotal,
      slow: s.slow ?? [],
    };
  }
}

/** Singleton process-wide de la sonde de flux ORM. */
export const queryFlowMonitor = new QueryFlowMonitor();
