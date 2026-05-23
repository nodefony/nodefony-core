/**
 * Sonde **flux ORM** — débit de requêtes vers la base, agrégé process-wide et
 * **indépendant de l'ALS** (≠ profiler par-requête de la debug bar).
 *
 * Observe « combien de requêtes/s, à quelle latence, et lesquelles sont lentes »
 * pour le panneau Supervision Studio (patron sondes+hub). Alimenté par le même
 * tap que le profiler ({@link IOrm} adapters), mais via un compteur global
 * ({@link QueryFlowMonitor}) au lieu du buffer de scope — donc visible sans
 * requête HTTP en cours.
 *
 * Perf : le débit instantané (queries/s) n'est **pas** stocké ici ; il est dérivé
 * côté consommateur à partir du delta de {@link IQueryFlow.total} entre deux
 * lectures (même technique que le CPU%) → 0 état mutable à la lecture, robuste
 * même quand l'event-loop dérape (le delta couvre alors une fenêtre plus large).
 */

/**
 * Une requête « lente » capturée (au-delà du seuil). Le SQL est **paramétré**
 * (placeholders, jamais les valeurs) et redacté → 0 credential. Capturé
 * uniquement sur le chemin lent (rare) pour ne rien coûter au cas nominal.
 */
export interface ISlowQuery {
  /** Horodatage de la requête (ms epoch). */
  ts: number;
  /** Durée mesurée (ms). */
  durationMs: number;
  /** Connecteur ORM (clé du registre). */
  connector: string;
  /** SQL paramétré et redacté (absent si l'adapter ne sait pas l'extraire). */
  sql?: string;
}

/**
 * Compteurs de flux d'UN connecteur ORM. Cumuls depuis le boot (le débit/s se
 * dérive du delta de `total`). Latence en deux vues : moyenne sur la vie du
 * process (`avgMs`) et EWMA lissée (`ewmaMs`, suit les variations récentes).
 */
export interface IQueryFlow {
  /** Connecteur ORM (clé du registre, ex. `"default"`). */
  connector: string;
  /** Vendor de l'adapter (`drizzle`, `sequelize`, `mongoose`), `""` si inconnu. */
  vendor: string;
  /** Requêtes mesurées depuis le boot (le débit/s = Δtotal / Δts côté lecteur). */
  total: number;
  /** Latence moyenne sur la vie du process (ms), `null` si aucune requête. */
  avgMs: number | null;
  /** Latence EWMA lissée (ms) — suit les variations récentes, `null` si aucune. */
  ewmaMs: number | null;
  /** Dernière latence mesurée (ms), `null` si aucune. */
  lastMs: number | null;
  /** Pire latence observée (ms), `0` si aucune. */
  maxMs: number;
  /** Requêtes classées lentes depuis le boot (≥ seuil). */
  slowTotal: number;
  /** Ring borné des requêtes lentes récentes (la plus récente en tête). */
  slow: ISlowQuery[];
}

/**
 * Rapport de flux complet — un par instance (cloud-native : per-process). Le
 * débit/s n'y figure pas (dérivé du delta de `total` entre deux `ts`).
 */
export interface IOrmFlowReport {
  /** La sonde est-elle active ? `false` en production par défaut (coût nul). */
  enabled: boolean;
  /** Horodatage du rapport (ms epoch) — sert au calcul du débit (Δts). */
  ts: number;
  /** Identifiant de l'instance (pid, ou `NODEFONY_INSTANCE_ID`). */
  instanceId: string;
  /** Seuil « lent » courant (ms) — au-delà, la requête est capturée. */
  slowMs: number;
  /** Flux par connecteur ORM enregistré. */
  connectors: IQueryFlow[];
}
