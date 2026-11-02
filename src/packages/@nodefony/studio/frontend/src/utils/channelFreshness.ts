/**
 * Fraîcheur d'un canal temps réel — « est-il encore à l'heure ? », jugé sur SA
 * cadence et non sur un seuil fixe.
 *
 * Deux horloges se croisent dans la console : l'échantillonneur du socket recopie
 * `lastMessage` une fois par seconde, et l'horloge de l'écran avance d'un cran par
 * seconde avec un autre phasage. Un seuil fixe (1,5 s) tombait AU MILIEU de l'âge
 * observé d'un canal à 1 s ou 2 s : le libellé alternait « à l'instant » / « il y
 * a 2s » à chaque tick, et le point d'activité clignotait avec lui. Un canal reste
 * donc frais tant qu'il n'a pas manqué deux rendez-vous, latence de l'échantillon
 * comprise.
 */

/** Période de l'échantillonneur des stats du socket (`NodefonySocket`), en ms. */
export const STATS_SAMPLE_MS = 1000;

/**
 * Intervalle attendu entre deux messages d'un canal, en ms : la cadence déclarée
 * par le suffixe `:<ms>` du nom si elle existe, sinon déduite du débit mesuré
 * (moyenne de la série msg/s), sinon `null`.
 *
 * @param cadenceMs - cadence lue sur le nom du canal (`null` si absente).
 * @param series - débit échantillonné, msg/s par seconde.
 * @returns l'intervalle attendu, ou `null` s'il est inconnu.
 */
export function expectedIntervalMs(
  cadenceMs: number | null,
  series: readonly number[],
): number | null {
  if (cadenceMs !== null && cadenceMs > 0) return cadenceMs;
  if (series.length === 0) return null;
  let sum = 0;
  for (const v of series) sum += v;
  const perSecond = sum / series.length;
  return perSecond > 0 ? 1000 / perSecond : null;
}

/**
 * Âge au-delà duquel un canal n'est plus « à l'instant » : deux intervalles
 * attendus plus la latence de l'échantillonneur. Intervalle inconnu → une
 * seconde supposée.
 *
 * @param intervalMs - intervalle attendu entre deux messages (`null` = inconnu).
 * @returns la fenêtre de fraîcheur, en ms.
 */
export function freshnessWindowMs(intervalMs: number | null): number {
  return 2 * (intervalMs ?? 1000) + STATS_SAMPLE_MS;
}

/**
 * Libellé d'ancienneté STABLE : « à l'instant » dans la fenêtre de fraîcheur,
 * puis secondes, minutes ou heures ENTIÈRES — jamais de ms ni de décimale.
 *
 * @param ageMs - âge du dernier message, en ms.
 * @param windowMs - fenêtre de fraîcheur ({@link freshnessWindowMs}).
 * @returns le libellé à afficher.
 */
export function freshnessLabel(ageMs: number, windowMs: number): string {
  if (ageMs < windowMs) return "à l'instant";
  if (ageMs < 60000) return `il y a ${Math.round(ageMs / 1000)}s`;
  if (ageMs < 3600000) return `il y a ${Math.floor(ageMs / 60000)}min`;
  return `il y a ${Math.floor(ageMs / 3600000)}h`;
}
