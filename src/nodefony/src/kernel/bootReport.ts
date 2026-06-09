/**
 * Rapport de boot — **vérité unique** sur le résultat du démarrage du Kernel,
 * calculé une fois à `onPostReady` et consommé par N canaux (rendu écran dev via
 * `BootReporter`, log structuré prod, code de sortie pour l'orchestrateur/superviseur,
 * canal RPC dev, futur endpoint Studio `/nodefony/kernel/api/boot`).
 *
 * Objectif : **plus aucun boot qui meurt en silence**. Un profil serveur qui finit
 * sans aucun serveur en écoute est un échec VISIBLE (`healthy=false`), pas un
 * « arrêt propre (code 0) » trompeur.
 */

/**
 * Un module ignoré ou en échec **non fatal** pendant le boot (fail-soft). Agrégé
 * par le Kernel pour expliquer, en une ligne par module, pourquoi le boot est
 * dégradé — au lieu de N WARNING enterrés dans le JSONL.
 */
export interface IBootFailure {
  /** Nom du module/service en échec (tag `owner`, ou nom d'entrée du manifeste). */
  module: string;
  /** Message d'erreur condensé (1ʳᵉ ligne). */
  reason: string;
  /**
   * Étape du boot où l'échec s'est produit :
   * - `load` — `import()` du module (manifeste) a throw (ex. « Cannot find package »).
   * - `lifecycle` — un hook `onKernelRegister`/`Boot`/`Ready` a throw/timeout.
   * - `init` — l'`initialize()` d'un service/module a throw/timeout.
   */
  phase: "load" | "lifecycle" | "init";
  /** `true` si l'échec est un dépassement du timeout de boot. */
  timedOut?: boolean;
}

/** Un serveur réseau réellement en écoute à la fin du boot. */
export interface IBootServerInfo {
  /** Nom de service interne (`http` | `https` | `websocket` | `websocket-secure`). */
  type: string;
  /** Scheme d'URL court et conventionnel (`http` | `https` | `ws` | `wss`). */
  scheme: string;
  /** Port d'écoute effectif. */
  port: number;
  /** Adresse de bind (`127.0.0.1`, `0.0.0.0`…), si connue. */
  address?: string;
  /** URL complète d'accès (`scheme://host:port`) — cliquable au terminal. */
  url: string;
}

/**
 * Verdict agrégé du dernier boot. `healthy=false` ⇒ le boot est raté ou dégradé de
 * façon bloquante (typiquement : profil serveur attendu mais 0 serveur en écoute).
 */
export interface IBootReport {
  /** Durée approximative du boot (ms). */
  durationMs: number;
  /** Modules effectivement chargés et enregistrés. */
  modulesLoaded: string[];
  /** Modules ignorés/échoués en fail-soft (avec la raison). */
  modulesSkipped: IBootFailure[];
  /** `true` si le profil d'exécution attendait des serveurs réseau. */
  serversExpected: boolean;
  /** Serveurs réellement en écoute. */
  serversListening: IBootServerInfo[];
  /**
   * Verdict global : `false` si un profil serveur a fini sans aucun serveur en
   * écoute (garde-fou 0-serveur). Les modules ignorés seuls ne rendent PAS le boot
   * `unhealthy` (dégradé mais vivant) — seul le 0-serveur attendu est bloquant.
   */
  healthy: boolean;
  /**
   * Action corrective suggérée d'après les raisons d'échec (ex. « dist périmé ⇒
   * npm run clean && npm run build » quand un `import()` échoue). `undefined` si
   * aucune heuristique ne matche. Source unique partagée par le log et l'écran.
   */
  remediation?: string;
}
