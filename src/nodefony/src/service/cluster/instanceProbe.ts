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

// Formes publiées : au cœur isomorphe, pour que le navigateur les lise sans recopie.
import type {
  IOrmLeanHealth,
  IInstanceErrorHealth,
} from "../../realtime/platformHealth";
export type { IOrmLeanHealth, IInstanceErrorHealth };

/**
 * Seam ORM : fournisseur de la santé ORM lean du process. Branché par le **module driver**
 * (Drizzle/Mongoose) à son boot ; lu par l'assembleur du report (framework).
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

/**
 * Seam ORM **riche** (drill-down @pid) : fournisseur du diagnostic ORM complet du process
 * (par connecteur : ping/latence/stockage/pool via `connection/health` + flux requêtes via
 * `flow`). **Opaque** côté core/framework (qui ne font que le transporter) — seul le
 * consommateur (Studio) connaît la forme `{ health, flow }`. **Async** (le `connection/health`
 * émet un ping) — branché par le **driver** (Drizzle) à son boot, lu par le worker UNIQUEMENT
 * pendant un drill (« on paie ce qu'on regarde »). `null` par défaut → 0 coût.
 */
let _ormRichProvider: (() => Promise<unknown>) | null = null;

/**
 * Branche (ou débranche avec `null`) le fournisseur de diagnostic ORM riche. Idempotent
 * (dernier gagne). Coût NUL hors drill : ce fournisseur n'est appelé que quand le master
 * a demandé l'enrichissement ORM de CE worker.
 *
 * @param fn - producteur async du blob `{ health, flow }`, ou `null` pour débrancher.
 */
export function setOrmRichProvider(fn: (() => Promise<unknown>) | null): void {
  _ormRichProvider = fn;
}

/**
 * Appelle le fournisseur ORM riche branché (async), ou `null` si aucun driver ne l'a posé.
 * Le résultat est un blob OPAQUE (forme connue de Studio seul). Ne throw pas pour son propre
 * compte : la propagation d'un rejet du provider reste à l'appelant (qui catch dans son tick).
 */
export function readOrmRich(): Promise<unknown> | null {
  return _ormRichProvider?.() ?? null;
}
