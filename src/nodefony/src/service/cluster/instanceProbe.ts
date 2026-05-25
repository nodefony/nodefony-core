/**
 * Contrats de **santé per-instance NON realtime** (ORM + erreurs) qui voyagent dans le
 * report de sonde cluster, à côté de {@link IProcessHealth} (process) et de la sonde de la
 * socket. Généralise l'agrégation pod « aux 3 sondes » (process / socket / ORM+erreurs) sans
 * toucher au `ClusterProbeAggregator` (opaque) : on enrichit juste le colis remonté par chaque
 * worker, le merge pod les somme → « santé du framework » complète par pod.
 *
 * **Dépendance propre** : ces contrats vivent dans le CORE (comme `IProcessHealth`) →
 * `@nodefony/framework` (assemble le report) et `@nodefony/orm-core` (produit la lecture lean)
 * partagent UNE source de vérité sans dépendre l'un de l'autre. La lecture ORM réelle est
 * branchée par le **driver** via {@link setOrmHealthProvider} (seam, comme `setClusterProbeClient`).
 */

/**
 * Santé ORM **agrégée per-instance** (lean) — somme process-wide de tous les connecteurs
 * enregistrés, dérivée des singletons `queryFlowMonitor` + `connectionMonitor` (0 ping, 0
 * `toSQL`, O(N connecteurs)). Rejoint le report de sonde du worker à chaque tick (≥ 1 s).
 * Tous les cumuls sont **monotones** → débit/s dérivé côté lecteur (delta/ts, comme le CPU%).
 */
export interface IOrmLeanHealth {
  /** Connecteurs ORM enregistrés (registre). */
  connectors: number;
  /** Connecteurs actuellement connectés (`isConnected()`). */
  connected: number;
  /** Requêtes ORM cumulées, tous connecteurs (monotone ; 0 si flux OFF en prod). */
  queryTotal: number;
  /** Requêtes lentes cumulées (au-dessus du seuil `slowMs`) (monotone). */
  slowTotal: number;
  /** Erreurs de connexion ORM cumulées (monotone). */
  errorTotal: number;
  /** Reconnexions ORM cumulées (monotone). */
  reconnectTotal: number;
  /** Pire latence EWMA (ms) parmi les connecteurs (instantané), ou `null` si non observé. */
  maxEwmaMs: number | null;
}

/**
 * Santé **erreurs per-instance** — compteurs Syslog monotones (cf `Syslog.errorTotal` /
 * `Syslog.criticTotal`). Permet une carte « erreurs par worker » + un taux d'erreur pod
 * (delta côté lecteur). Lecture pure d'entiers, 0 scan du ring buffer.
 */
export interface IInstanceErrorHealth {
  /** Logs ERROR/CRITIC/ALERT/EMERGENCY cumulés (sévérité 0–3) (monotone). */
  errorTotal: number;
  /** Sous-ensemble CRITIQUE : CRITIC/ALERT/EMERGENCY (sévérité 0–2) (monotone). */
  criticTotal: number;
}

/**
 * Seam ORM : fournisseur de la santé ORM lean du process. Branché par le **module driver**
 * (Drizzle/Sequelize/Mongoose) à son boot ; lu par l'assembleur du report (framework).
 * `null` par défaut → 0 coût et `readOrmHealth()` renvoie `null` (pas d'ORM → champ omis).
 */
let _ormHealthProvider: (() => IOrmLeanHealth) | null = null;

/**
 * Branche (ou débranche avec `null`) le fournisseur de santé ORM lean. Idempotent
 * (dernier gagne) — plusieurs drivers branchant la même fonction globale est sûr.
 *
 * @param fn - lecture lean de la santé ORM du process, ou `null` pour débrancher.
 */
export function setOrmHealthProvider(fn: (() => IOrmLeanHealth) | null): void {
  _ormHealthProvider = fn;
}

/**
 * Lit la santé ORM lean du process via le fournisseur branché, ou `null` si aucun ORM
 * n'est branché (le champ `orm` du report est alors omis). Lecture pure, jamais throw.
 */
export function readOrmHealth(): IOrmLeanHealth | null {
  return _ormHealthProvider?.() ?? null;
}
