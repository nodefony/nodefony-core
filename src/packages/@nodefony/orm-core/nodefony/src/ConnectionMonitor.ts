import type { IConnectionError } from "../interfaces/IOrmGraph";
import type { ILatencyWindow } from "../interfaces/IOrmProbe";

/**
 * Stats mutables d'un connecteur. `recentErrors`/`latencies` restent `null` tant
 * qu'aucune donnée n'existe (lazy alloc — perf : pas de tableau « au cas où »).
 */
interface MutableStats {
  connectedSince: number | null;
  connectCount: number;
  /** Reprises CONSTATÉES (signalées par l'adapter), pas déduites d'un compteur. */
  reconnectCount: number;
  /** Pertes constatées — un incident qui n'a pas encore trouvé sa reprise. */
  lostCount: number;
  errorCount: number;
  lastConnectMs: number | null;
  lastError: IConnectionError | null;
  recentErrors: IConnectionError[] | null;
  latencies: number[] | null;
}

/** Vue figée des compteurs du moniteur pour un connecteur. */
export interface IConnectionMonitorCore {
  connectedSince: number | null;
  uptimeMs: number | null;
  connectCount: number;
  reconnectCount: number;
  /** Pertes de connexion constatées depuis le démarrage du process. */
  lostCount: number;
  errorCount: number;
  lastConnectMs: number | null;
  lastError: IConnectionError | null;
  recentErrors: IConnectionError[];
  latency: ILatencyWindow;
}

/** Taille max du ring d'erreurs récentes (borne mémoire). */
const MAX_RECENT_ERRORS = 12;
/** Taille de la fenêtre glissante de latence (min/moy/max). */
const MAX_LATENCY_SAMPLES = 30;

/** Fenêtre de latence vide. */
const EMPTY_LATENCY: ILatencyWindow = {
  last: null,
  min: null,
  avg: null,
  max: null,
  samples: 0,
};

/** Compteurs neutres d'un connecteur jamais observé. */
const EMPTY_CORE: IConnectionMonitorCore = {
  connectedSince: null,
  uptimeMs: null,
  connectCount: 0,
  reconnectCount: 0,
  lostCount: 0,
  errorCount: 0,
  lastConnectMs: null,
  lastError: null,
  recentErrors: [],
  latency: EMPTY_LATENCY,
};

/**
 * **ConnectionMonitor** — observabilité **per-instance** (process-local) du
 * cycle de vie des connexions ORM : connexions, **reconnexions**, **erreurs**
 * (connexion + ping).
 *
 * Alimenté par la template method {@link Orm.connect} (capture latence + erreur
 * de connexion) et par le ping live de l'endpoint `connection/health`. Lecture
 * via {@link snapshot} (data plane ORM / dashboard Studio).
 *
 * **Cloud-native** : l'état d'une connexion DB est local au process (pool par
 * pod) → le moniteur est volontairement per-instance. La vue multi-pod relève
 * de l'agrégation (Prometheus par pod / fan-out Redis P13), pas de cette classe.
 *
 * **Perf** : structure lazy (`Map` allouée au 1ᵉʳ enregistrement) ; ring
 * d'erreurs alloué seulement au 1ᵉʳ incident ; aucun coût tant qu'aucun ORM ne
 * se connecte ou n'échoue. Reset au restart (diagnostic, pas d'état durable).
 */
class ConnectionMonitor {
  /** `null` tant qu'aucun connecteur n'a été observé (lazy). */
  #stats: Map<string, MutableStats> | null = null;

  /** Crée/retourne les stats mutables d'un connecteur (alloue à la demande). */
  #ensure(name: string): MutableStats {
    if (this.#stats === null) {
      this.#stats = new Map();
    }
    let s = this.#stats.get(name);
    if (s === undefined) {
      s = {
        connectedSince: null,
        connectCount: 0,
        reconnectCount: 0,
        lostCount: 0,
        errorCount: 0,
        lastConnectMs: null,
        lastError: null,
        recentErrors: null,
        latencies: null,
      };
      this.#stats.set(name, s);
    }
    return s;
  }

  /**
   * Enregistre une latence de ping live dans la fenêtre glissante (ring borné).
   *
   * @param name - clé du connecteur.
   * @param ms - latence du ping (ms).
   */
  recordPing(name: string, ms: number): void {
    const s = this.#ensure(name);
    if (s.latencies === null) {
      s.latencies = [];
    }
    s.latencies.push(ms);
    if (s.latencies.length > MAX_LATENCY_SAMPLES) {
      s.latencies.shift();
    }
  }

  /**
   * Enregistre une connexion réussie + sa latence.
   *
   * Ne compte PAS une reconnexion : une reprise du driver ne repasse jamais
   * par `Orm.connect()`, elle se signale par {@link ConnectionMonitor.recordReconnect}.
   *
   * @param name - clé du connecteur.
   * @param latencyMs - durée de l'établissement (ms).
   */
  recordConnect(name: string, latencyMs: number): void {
    const s = this.#ensure(name);
    s.connectCount += 1;
    s.connectedSince = Date.now();
    s.lastConnectMs = Math.round(latencyMs * 100) / 100;
  }

  /**
   * Enregistre une **perte** de connexion constatée par l'adapter.
   *
   * `connectedSince` retombe à `null` : un uptime qui continue de croître
   * pendant que le serveur est tombé est pire qu'absent — il se lit comme une
   * preuve de bonne santé.
   *
   * @param name - clé du connecteur.
   */
  recordLost(name: string): void {
    const s = this.#ensure(name);
    s.lostCount += 1;
    s.connectedSince = null;
  }

  /**
   * Enregistre une **reprise** de connexion constatée par l'adapter.
   *
   * @param name - clé du connecteur.
   */
  recordReconnect(name: string): void {
    const s = this.#ensure(name);
    s.reconnectCount += 1;
    s.connectedSince = Date.now();
  }

  /**
   * Enregistre une erreur (connexion échouée ou ping en échec).
   *
   * @param name - clé du connecteur.
   * @param message - message d'erreur (credential déjà retiré par l'appelant).
   */
  recordError(name: string, message: string): void {
    const s = this.#ensure(name);
    s.errorCount += 1;
    const err: IConnectionError = { message, ts: Date.now() };
    s.lastError = err;
    if (s.recentErrors === null) {
      s.recentErrors = [];
    }
    s.recentErrors.unshift(err);
    if (s.recentErrors.length > MAX_RECENT_ERRORS) {
      s.recentErrors.length = MAX_RECENT_ERRORS;
    }
  }

  /**
   * Vue figée des compteurs d'un connecteur (ou compteurs neutres si jamais
   * observé).
   *
   * @param name - clé du connecteur.
   */
  snapshot(name: string): IConnectionMonitorCore {
    const s = this.#stats?.get(name);
    if (s === undefined) {
      return EMPTY_CORE;
    }
    const lat = s.latencies;
    let latency: ILatencyWindow = EMPTY_LATENCY;
    if (lat && lat.length) {
      let min = lat[0];
      let max = lat[0];
      let sum = 0;
      for (const v of lat) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      latency = {
        last: lat[lat.length - 1],
        min: Math.round(min * 100) / 100,
        avg: Math.round((sum / lat.length) * 100) / 100,
        max: Math.round(max * 100) / 100,
        samples: lat.length,
      };
    }
    return {
      connectedSince: s.connectedSince,
      uptimeMs:
        s.connectedSince === null ? null : Date.now() - s.connectedSince,
      connectCount: s.connectCount,
      reconnectCount: s.reconnectCount,
      lostCount: s.lostCount,
      errorCount: s.errorCount,
      lastConnectMs: s.lastConnectMs,
      lastError: s.lastError,
      recentErrors: s.recentErrors ?? [],
      latency,
    };
  }
}

/** Singleton process-wide du moniteur de connexions. */
export const connectionMonitor = new ConnectionMonitor();
