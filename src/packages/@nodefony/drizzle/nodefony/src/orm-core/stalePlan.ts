/**
 * SQLSTATE `feature_not_supported` : PostgreSQL le lève, entre autres, quand
 * une requête préparée rendrait un autre type de ligne que celui appris.
 */
const STALE_PLAN_CODE = "0A000";

/**
 * La fonction du serveur qui revalide un plan en cache. Elle se lit dans le
 * champ `routine` de l'erreur, qui ne dépend pas de la langue du serveur — le
 * message, lui, est traduit (`lc_messages`).
 */
const STALE_PLAN_ROUTINE = "RevalidateCachedQuery";

/** Profondeur maximale de la chaîne `cause` parcourue : Drizzle enveloppe une fois. */
const CAUSE_DEPTH_MAX = 4;

/**
 * Dit si `error` est le refus d'un plan périmé : `cached plan must not change
 * result type`. Une table a changé sous une requête préparée NOMMÉE — une
 * migration lancée à côté du serveur a changé le type d'une colonne lue — et
 * chaque connexion du pool qui l'avait apprise la refuse désormais.
 *
 * Remonte la chaîne `cause` : Drizzle enveloppe l'erreur du pilote dans une
 * `DrizzleQueryError`.
 *
 * @param error - ce qu'une exécution a levé.
 * @returns `true` pour ce refus-là seulement.
 */
export function isStalePlanError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH_MAX; depth++) {
    if (!(current instanceof Error)) return false;
    if (
      "code" in current &&
      current.code === STALE_PLAN_CODE &&
      "routine" in current &&
      current.routine === STALE_PLAN_ROUTINE
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
