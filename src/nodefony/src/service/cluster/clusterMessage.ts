/**
 * Protocole de fil IPC du cluster Nodefony (mode sans PM2).
 *
 * Le master est le **gateway** : tout message worker↔worker transite par lui via IPC
 * (`process.send` côté worker / `worker.send` côté master). Ce canal IPC est **partagé**
 * par plusieurs usages (publications realtime, et — Phase 4 — remontées de sondes à
 * agréger). Un **discriminant `kind`** permet à chaque consommateur (relay realtime,
 * agrégateur de sondes) de ne traiter que ce qui le concerne.
 *
 * Ce protocole vit dans le **core** (et non dans `@nodefony/framework`) car le gateway
 * est un composant core et le core est la dépendance commune : le worker realtime
 * (`ClusterBackplane`, framework) importe `CLUSTER_RT_KIND` d'ici via `"nodefony"`, le
 * master (`ClusterRelay`, core) l'utilise aussi → **une seule source**, pas de magic
 * string dupliqué (anti-drift).
 */

/**
 * `kind` d'une publication **realtime** (port `IBackplane`). Le {@link "./ClusterRelay"}
 * rebroadcast ces messages aux **autres** workers ; le `ClusterBackplane` (framework)
 * les produit/consomme.
 */
export const CLUSTER_RT_KIND = "nf:rt" as const;

/**
 * `kind` d'une **remontée de sonde** worker → master (Phase 4c). Chaque worker envoie
 * périodiquement sa santé per-instance (opaque pour le master) ; le
 * {@link "./ClusterProbeAggregator"} les collecte. Le {@link "./ClusterRelay"} IGNORE
 * ce kind (ce n'est pas une publication realtime à rebroadcaster).
 */
export const CLUSTER_PROBE_KIND = "nf:probe" as const;

/**
 * `kind` du **snapshot agrégé** master → workers (Phase 4c). Le master diffuse
 * périodiquement la liste des sondes de TOUS les workers (`{ ts, instances }`) ; chaque
 * worker la met en cache pour servir la vue POD sur son endpoint santé (push, pas pull).
 */
export const CLUSTER_PROBE_SNAPSHOT_KIND = "nf:probe:snap" as const;

/**
 * Base de tout message du protocole IPC cluster — seul le `kind` est imposé. Les autres
 * champs sont opaques pour le master (il route/agrège sans les inspecter).
 */
export interface IClusterMessage {
  readonly kind: string;
}

/** Type-guard d'un message IPC cluster — narrowing sûr d'un message `unknown` du canal partagé. */
export function isClusterMessage(m: unknown): m is IClusterMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    typeof (m as IClusterMessage).kind === "string"
  );
}

export default CLUSTER_RT_KIND;
