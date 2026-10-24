/**
 * Ce que le chronométrage mesure sur une requête :
 *
 * - `"off"` — rien : ni horloge, ni phases ; la ligne d'accès sort sans durée ;
 * - `"clock"` — la durée seule : une lecture d'horloge à l'entrée, une à la fin ;
 * - `"phases"` — la durée ET le détail par phase (resolve, firewall, action…).
 */
export type TimingMode = "off" | "clock" | "phases";

/**
 * Résout le mode de chronométrage d'une requête depuis `timing.enabled` et
 * l'environnement — la SEULE règle, appelée par le constructeur du `Context`.
 *
 * Défaut (`null`, pas d'avis) : la durée partout, les phases hors production.
 * La durée coûte deux lectures d'horloge, l'équivalent de quelques pourcents
 * de la ligne d'accès qu'elle complète ; les phases coûtent une lecture par
 * phase, un tableau et un index par requête — réservées au développement, ou
 * à un diagnostic à chaud (`true`). `false` coupe tout, durée comprise.
 *
 * @param enabled - valeur de `timing.enabled` (`true`, `false`, `null`)
 * @param environment - environnement normalisé du noyau (`"production"`…)
 * @returns le mode de la requête — une chaîne littérale, rien d'alloué
 */
export function resolveTimingMode(
  enabled: unknown,
  environment: string | undefined,
): TimingMode {
  if (enabled === false) return "off";
  if (enabled === true) return "phases";
  // `environment` est normalisé ("development" / "production" / "test") —
  // jamais "prod" : comparer à "prod" allumait les phases en production.
  return environment === "production" ? "clock" : "phases";
}
