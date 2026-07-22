import {
  clusterProbeRequestEnrich,
  clusterProbeInstance,
  type RealtimePublish,
  type IRealtimeHealth,
} from "@nodefony/realtime";
import type { AppMeta } from "./providers";

/**
 * Mappe la santé d'UN worker du snapshot pod ({@link IRealtimeHealth} : lean `process` +
 * sonde riche `rich` jointe pendant le drill) vers le **format du canal
 * `nodefony:supervision`** — de sorte que le composant front de Supervision soit réutilisé
 * tel quel, qu'il s'agisse du worker local (ticker direct) ou d'un worker distant (drill cluster).
 *
 * Pur (aucune I/O). Tolère l'absence de `rich` (enrich pas encore propagé cross-process) :
 * publie alors la partie lean avec `richPending: true` → le front peut afficher un état « warming »
 * le temps (≤ 1 cycle de snapshot) que la sonde riche du worker ciblé remonte.
 */
export function mapInstanceToSupervision(
  inst: IRealtimeHealth,
  meta?: AppMeta,
): Record<string, unknown> {
  const p = inst.process;
  const r = inst.rich;
  return {
    ts: r?.ts ?? p?.ts ?? Date.now(),
    app: meta,
    instanceId: inst.instanceId,
    uptime: p?.uptime ?? 0,
    pid: p?.pid ?? (Number(inst.instanceId) || 0),
    cpuPercent: p?.cpuPercent ?? 0,
    cpuCount: r?.cpuCount ?? 0,
    eventLoopMs: p?.eventLoopMs ?? 0,
    elu: {
      utilization: p?.eluUtilization ?? 0,
      active: r?.elu?.active ?? 0,
      idle: r?.elu?.idle ?? 0,
    },
    ctx: r?.ctx ?? { voluntary: 0, involuntary: 0 },
    loadavg: r?.loadavg ?? [0, 0, 0],
    memory: {
      rss: p?.rss ?? 0,
      heapUsed: p?.heapUsed ?? 0,
      heapTotal: p?.heapTotal ?? 0,
      heapLimit: r?.heapLimit ?? 0,
      external: p?.external ?? 0,
    },
    gc: r?.gc ?? null,
    heapSpaces: r?.heapSpaces ?? [],
    handles: r?.handles ?? { total: 0, byType: {} },
    // true tant que la sonde riche du worker ciblé n'est pas encore arrivée (enrich en cours
    // de propagation cross-process) → le front affiche un état « warming », pas un écran vide.
    richPending: r === undefined,
  };
}

/**
 * Provider du canal **drill-down cluster** `nodefony:supervision@<pid>` — supervision RICHE
 * d'UN worker DISTANT du pod (≠ le worker qui tient la connexion navigateur). Réutilise le
 * snapshot pod déjà diffusé par le master (voie B1) : aucun nouveau flux de données.
 *
 * Cycle « on paie ce qu'on regarde » :
 *  1. au subscribe → {@link clusterProbeRequestEnrich}`(pid, true)` : ordonne au master d'activer
 *     la sonde riche du worker `pid` (qui joint alors `rich` à son report → au snapshot suivant) ;
 *  2. tick → lit {@link clusterProbeInstance}`(pid)` du dernier snapshot, mappe et publie ;
 *  3. au dispose (unsubscribe / close) → coupe l'enrichissement (`requestEnrich(pid, false)`)
 *     → le worker `pid` cesse de produire le rich. Plus personne ne paie.
 *
 * Perf : 1 `setInterval` `unref` ; lecture O(1) du cache snapshot (aucun appel système au tick).
 *
 * @param publish - sink du canal (fan-out hub).
 * @param channel - nom complet du canal (`nodefony:supervision@<pid>[:<ms>]`).
 * @param pid - worker distant ciblé.
 * @param intervalMs - cadence de republication (granularité `:<ms>`).
 * @param meta - métadonnées app statiques (env, version, branche).
 * @returns `dispose()` — clear l'interval + coupe l'enrichissement. OBLIGATOIRE.
 */
export function createClusterSupervisionTicker(
  publish: RealtimePublish,
  channel: string,
  pid: number,
  intervalMs: number,
  meta?: AppMeta,
): () => void {
  clusterProbeRequestEnrich(pid, true);
  const tick = (): void => {
    const inst = clusterProbeInstance(pid);
    if (inst) publish(channel, mapInstanceToSupervision(inst, meta));
  };
  tick(); // 1er paint immédiat (lean tant que l'enrich ne s'est pas propagé : richPending)
  const timer = setInterval(tick, intervalMs);
  (timer as { unref?: () => void }).unref?.();
  return () => {
    clearInterval(timer);
    clusterProbeRequestEnrich(pid, false);
  };
}
