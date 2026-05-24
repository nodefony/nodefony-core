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
