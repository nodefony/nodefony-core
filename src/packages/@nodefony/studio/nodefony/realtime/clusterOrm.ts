import {
  clusterProbeRequestEnrich,
  clusterProbeInstance,
  type RealtimePublish,
} from "@nodefony/framework";

/**
 * Provider du canal **drill ORM cluster** `orm:rich@<pid>` — diagnostic ORM RICHE
 * (par connecteur : ping/latence/stockage/pool + flux requêtes) d'UN worker DISTANT du
 * pod (≠ celui qui tient la connexion navigateur). Réutilise le snapshot pod déjà diffusé
 * par le master (voie B1) : aucun nouveau flux de données — juste un champ `ormRich` joint
 * au report du worker drillé.
 *
 * C'est le pendant ORM de `createClusterSupervisionTicker` (facette `"orm"` au lieu de
 * `"process"`). Il SUPPRIME l'alerte « fourni par un autre worker » du drill `/nodefony/orm/<pid>`
 * en cluster : le diagnostic riche provient désormais du pid EXACT, pas d'un worker round-robin.
 *
 * Cycle « on paie ce qu'on regarde » :
 *  1. au subscribe → {@link clusterProbeRequestEnrich}`(pid, true, "orm")` : ordonne au master
 *     d'activer la sonde ORM riche du worker `pid` (qui joint alors `ormRich` à son report) ;
 *  2. tick → lit {@link clusterProbeInstance}`(pid).ormRich` du dernier snapshot, publie ;
 *  3. au dispose (unsubscribe / close) → coupe l'enrichissement (`requestEnrich(pid, false, "orm")`)
 *     → le worker `pid` cesse de pinger sa base. Plus personne ne paie.
 *
 * Perf : 1 `setInterval` `unref` ; lecture O(1) du cache snapshot (aucun ping au tick — le ping
 * est fait UNE fois par cycle sur le worker drillé, pas par abonné). Tant que `ormRich` n'est pas
 * encore propagé (≤ 1 cycle) → `richPending: true` → le front affiche « préparation du diagnostic ».
 *
 * @param publish - sink du canal (fan-out hub).
 * @param channel - nom complet du canal (`orm:rich@<pid>[:<ms>]`).
 * @param pid - worker distant ciblé.
 * @param intervalMs - cadence de republication (granularité `:<ms>`).
 * @returns `dispose()` — clear l'interval + coupe l'enrichissement ORM. OBLIGATOIRE.
 */
export function createClusterOrmTicker(
  publish: RealtimePublish,
  channel: string,
  pid: number,
  intervalMs: number,
): () => void {
  clusterProbeRequestEnrich(pid, true, "orm");
  const tick = (): void => {
    const inst = clusterProbeInstance(pid);
    if (!inst) return; // pas (encore) de snapshot pour ce pid → rien à publier
    const rich = inst.ormRich;
    if (rich === undefined) {
      // enrich ORM pas encore propagé cross-process (≤ 1 cycle) → état « warming ».
      publish(channel, { pid, ts: Date.now(), richPending: true });
      return;
    }
    // rich = blob OPAQUE { health, flow } produit par le driver sur le worker `pid`.
    publish(channel, {
      pid,
      ts: Date.now(),
      richPending: false,
      ...(rich as Record<string, unknown>),
    });
  };
  tick(); // 1er paint immédiat (richPending tant que l'enrich ne s'est pas propagé)
  const timer = setInterval(tick, intervalMs);
  (timer as { unref?: () => void }).unref?.();
  return () => {
    clearInterval(timer);
    clusterProbeRequestEnrich(pid, false, "orm");
  };
}
