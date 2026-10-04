import type { IBootNotice } from "nodefony";

/** Le geste qui rend le temps réel partagé entre processus et pods. */
const REDIS_BACKPLANE_FIX =
  'use("@nodefony/realtime", { backplane: { driver: "redis" } }) + NF_REDIS_URL=redis://…';

/**
 * Le temps réel ne dépasse pas ce processus : aucun backplane actif (driver
 * `loopback`, `cluster` hors d'un worker, ou fabrique inactive ici).
 *
 * Simple information en développement mono-processus — c'est le cas normal —
 * mais à savoir avant de déployer plusieurs exemplaires : un message publié
 * sur l'un n'atteindrait pas les clients connectés aux autres.
 *
 * @param driver - le driver déclaré.
 * @returns le point à déclarer.
 */
export function realtimeLocalOnlyNotice(driver: string): IBootNotice {
  return {
    code: "REALTIME_LOCAL_ONLY",
    level: "info",
    message: `Temps réel limité à ce processus (backplane « ${driver} » inactif ici)`,
    fix: REDIS_BACKPLANE_FIX,
  };
}

/**
 * Le backplane déclaré n'a pas pu démarrer — le hub est retombé en local.
 *
 * Distinct de {@link realtimeLocalOnlyNotice} : ici, l'application a DEMANDÉ
 * un fan-out entre exemplaires et ne l'a pas. Deux pods servent alors deux
 * mondes temps réel disjoints, sans erreur visible.
 *
 * @param driver - le driver déclaré.
 * @param reason - la cause (message de l'échec).
 * @returns le point à déclarer.
 */
export function realtimeBackplaneDownNotice(
  driver: string,
  reason: string,
): IBootNotice {
  return {
    code: "REALTIME_BACKPLANE_DOWN",
    level: "warning",
    message: `Backplane temps réel « ${driver} » indisponible (${reason}) — retombé sur ce seul processus`,
    fix:
      driver === "redis"
        ? "vérifier NF_REDIS_URL et que Redis répond"
        : undefined,
  };
}
