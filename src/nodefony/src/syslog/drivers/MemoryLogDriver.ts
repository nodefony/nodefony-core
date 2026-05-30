import type Pdu from "../Pdu";
import type { ILogDriver, ILogQueryCriteria } from "./ILogDriver";
import { filterPdus } from "./filterPdus";

/**
 * Driver `memory` (LB.1) — le **ring buffer du Syslog EST le stockage**. Aucun
 * write dédié : le ring est alimenté par `Syslog.pushStack` sur le hot path. Le
 * driver n'ajoute que la **relecture** (`query`) = {@link filterPdus} sur un
 * snapshot du ring.
 *
 * Défaut en développement : volatile (perdu au restart), borné (`maxStack`), mais
 * **0 dépendance, isomorphe** (pas de `node:*` → utilisable côté navigateur plus
 * tard pour un Log Backplane front). Pour persister/agréger en prod → drivers
 * `file` (LB.2) / `elastic`-`loki` (LB.4).
 *
 * La **source** est injectée (provider `() => Pdu[]`, comme `Pdu.requestIdProvider`)
 * → le driver ne dépend pas de `Syslog` ni du `Kernel` (le wiring fournit
 * `() => kernel.syslog.ringStack`). Découplé + testable avec un tableau en dur.
 *
 * @param source - fournit le snapshot courant des Pdu (ex. `() => syslog.ringStack`).
 * @returns un `ILogDriver` `memory` queryable.
 */
export function createMemoryLogDriver(source: () => Pdu[]): ILogDriver {
  return {
    name: "memory",
    // write:false = volatile (le ring n'est pas une persistance) ; query:true =
    // relecture filtrée ; stream:true = alimente le tap temps réel `syslog:stream`.
    capabilities: { write: false, query: true, stream: true },
    query: (criteria: ILogQueryCriteria) =>
      Promise.resolve(filterPdus(source(), criteria)),
  };
}
