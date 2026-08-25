import type { IOrmLeanHealth } from "nodefony";
import { ormRegistry } from "./OrmRegistry";
import { connectionMonitor } from "./ConnectionMonitor";
import { queryFlowMonitor } from "./QueryFlowMonitor";

/**
 * **Santé ORM lean per-instance** — somme process-wide de tous les connecteurs enregistrés,
 * destinée à voyager dans le report de sonde cluster (« ORM par worker »). C'est la fonction
 * branchée par le driver via `setOrmHealthProvider` (core) ; le framework la lit dans le report.
 *
 * Perf (règle ABSOLUE) : lecture PURE des singletons déjà alimentés (`queryFlowMonitor` +
 * `connectionMonitor`) → **0 ping**, **0 `toSQL()`**, O(N connecteurs, N petit). `isConnected()`
 * est un simple test d'état (pas une requête). `queryTotal` reste à 0 si le flux est OFF
 * (prod) — c'est voulu : la sonde ne crée aucun coût, elle agrège ce qui existe déjà.
 *
 * @returns la santé ORM agrégée du process ({@link IOrmLeanHealth}).
 */
export function buildOrmLeanHealth(): IOrmLeanHealth {
  const names = ormRegistry.list();
  let connected = 0;
  let assumed = 0;
  let queryTotal = 0;
  let slowTotal = 0;
  let errorTotal = 0;
  let reconnectTotal = 0;
  let maxEwmaMs: number | null = null;
  for (const name of names) {
    try {
      const orm = ormRegistry.get(name);
      if (orm.isConnected()) {
        connected += 1;
        // `liveness` est DÉCLARÉ par l'adapter, avec un défaut prudent. Un
        // ORM tiers qui n'étend pas `Orm` ne le porte pas du tout : dans le
        // doute on compte SUPPOSÉ, jamais constaté — l'ignorance ne doit
        // jamais se présenter comme une preuve.
        if ((orm as { liveness?: string }).liveness !== "events") {
          assumed += 1;
        }
      }
    } catch {
      /* adapter pas prêt / registre incohérent → compté non-connecté, jamais throw */
    }
    const conn = connectionMonitor.snapshot(name);
    errorTotal += conn.errorCount;
    reconnectTotal += conn.reconnectCount;
    // vendor non requis pour l'agrégat (on ne lit que les scalaires) → "".
    const flow = queryFlowMonitor.snapshot(name, "");
    queryTotal += flow.total;
    slowTotal += flow.slowTotal;
    if (
      flow.ewmaMs !== null &&
      (maxEwmaMs === null || flow.ewmaMs > maxEwmaMs)
    ) {
      maxEwmaMs = flow.ewmaMs;
    }
  }
  return {
    connectors: names.length,
    connected,
    assumed,
    queryTotal,
    slowTotal,
    errorTotal,
    reconnectTotal,
    maxEwmaMs,
  };
}

export default buildOrmLeanHealth;
