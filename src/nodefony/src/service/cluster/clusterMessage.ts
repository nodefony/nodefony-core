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
 * `kind` d'un **ordre d'enrichissement** worker → master (Phase 2 drill-down). Un worker
 * (celui qui tient la connexion navigateur) demande au master d'activer/couper la sonde
 * **riche** (GC/heap-spaces/handles/ELU/ctx — cf `RichProcessProbe`) sur le worker `pid`
 * ciblé. Routé par le {@link "./ClusterProbeAggregator"} vers ce worker via {@link
 * CLUSTER_PROBE_ENRICH_KIND}. « On paie ce qu'on regarde » : aucun rich produit hors drill.
 */
export const CLUSTER_PROBE_CTL_KIND = "nf:probe:ctl" as const;

/**
 * `kind` de l'**ordre ciblé** master → worker (Phase 2 drill-down). Dit au worker
 * d'inclure (ou non) son blob de sonde **riche** dans son report périodique
 * (`CLUSTER_PROBE_KIND`). Le rich voyage ensuite dans le snapshot agrégé EXISTANT
 * (aucun nouveau flux de données — juste un champ `rich` de plus pour ce worker).
 */
export const CLUSTER_PROBE_ENRICH_KIND = "nf:probe:enrich" as const;

/**
 * **Facette** de sonde riche ciblée par un ordre d'enrichissement (drill-down) :
 *  - `"process"` : sonde process riche (GC/heap-spaces/handles/ELU/ctx — `RichProcessProbe`) ;
 *  - `"orm"` : sonde ORM riche (diagnostic connexions + flux — `connection/health` + `flow`).
 *
 * Indépendantes : un worker peut être enrichi sur l'une, l'autre, ou les deux à la fois (deux
 * pages de drill distinctes). « On paie ce qu'on regarde » par sonde — activer le drill ORM
 * n'allume PAS la sonde process (et inversement). Absente sur le fil ⇒ `"process"` (rétro-compat).
 */
export type ClusterProbeFacet = "process" | "orm";

/**
 * Base de tout message du protocole IPC cluster — seul le `kind` est imposé. Les autres
 * champs sont opaques pour le master (il route/agrège sans les inspecter).
 */
export interface IClusterMessage {
  readonly kind: string;
}

/**
 * Ordre d'enrichissement (worker → master, {@link CLUSTER_PROBE_CTL_KIND}). `op` =
 * `"enrich"` (activer) | `"stop"` (couper) ; `pid` = worker à (dés)enrichir ; `facet` =
 * quelle sonde riche cibler (défaut `"process"` si absent → rétro-compat supervision).
 */
export interface IClusterProbeCtl extends IClusterMessage {
  readonly kind: typeof CLUSTER_PROBE_CTL_KIND;
  readonly op: "enrich" | "stop";
  readonly pid: number;
  readonly facet?: ClusterProbeFacet;
}

/**
 * Ordre ciblé (master → worker, {@link CLUSTER_PROBE_ENRICH_KIND}). `enabled` = le worker
 * doit-il joindre sa sonde riche à ses prochains reports ; `facet` = laquelle (défaut
 * `"process"`).
 */
export interface IClusterProbeEnrich extends IClusterMessage {
  readonly kind: typeof CLUSTER_PROBE_ENRICH_KIND;
  readonly enabled: boolean;
  readonly facet?: ClusterProbeFacet;
}

/** `true` si `f` est une facette valide ou absente (absente ⇒ défaut `"process"`). */
function isValidFacet(f: unknown): f is ClusterProbeFacet | undefined {
  return f === undefined || f === "process" || f === "orm";
}

/** Type-guard d'un {@link IClusterProbeCtl} — narrowing sûr du canal IPC partagé. */
export function isClusterProbeCtl(m: unknown): m is IClusterProbeCtl {
  if (!isClusterMessage(m) || m.kind !== CLUSTER_PROBE_CTL_KIND) return false;
  const c = m as IClusterProbeCtl;
  return (
    (c.op === "enrich" || c.op === "stop") &&
    typeof c.pid === "number" &&
    isValidFacet(c.facet)
  );
}

/** Type-guard d'un {@link IClusterProbeEnrich} — narrowing sûr du canal IPC partagé. */
export function isClusterProbeEnrich(m: unknown): m is IClusterProbeEnrich {
  return (
    isClusterMessage(m) &&
    m.kind === CLUSTER_PROBE_ENRICH_KIND &&
    typeof (m as IClusterProbeEnrich).enabled === "boolean" &&
    isValidFacet((m as IClusterProbeEnrich).facet)
  );
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
