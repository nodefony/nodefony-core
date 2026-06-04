/**
 * RÉACTIVITÉ déclarée de chaque champ de config (pilier #2 du chantier).
 *
 * Certaines options s'appliquent À CHAUD (sans redémarrer — niveau de log, format
 * de requête, sources debug) ; d'autres sont FIGÉES AU BOOT (ports, protocole,
 * liste modules, TLS, cluster). Le dev et Studio doivent le savoir sans deviner.
 *
 * Ce module porte la **vérité déclarée** (quel champ est `hot`), co-localisée au
 * schéma et aussi taggée `@reactivity` en TSDoc sur {@link AppConfigInput} (hover
 * éditeur). L'APPLICATION live (`Kernel.applyConfigPatch` + setters services + UI
 * Studio avec badge `🔥 à chaud` / `🔒 redémarrage requis`) est un follow-up : ici
 * on ne fait que CLASSER, pas appliquer.
 *
 * Défaut SÛR : un champ non listé = `boot` (conservateur — on ne prétend jamais
 * `hot` par erreur).
 */

/** Réactivité d'un champ de config. */
export type Reactivity = "hot" | "boot";

/**
 * Champs applicables À CHAUD (chemin en dot-notation). Tout champ absent est `boot`.
 *
 * `log.active` / `log.debug` / `log.requestFormat` = exactement le cadre de la
 * « fenêtre d'audit » (élever la verbosité prod temporairement sans reboot).
 */
export const configReactivity = {
  "log.active": "hot",
  "log.debug": "hot",
  "log.requestFormat": "hot",
} as const satisfies Record<string, Reactivity>;

/**
 * Réactivité d'un champ par son chemin dot-notation ; `boot` par défaut (sûr).
 *
 * @param path - chemin du champ, ex. `"log.debug"` ou `"servers.http.port"`.
 * @returns `"hot"` si le champ peut s'appliquer à chaud, sinon `"boot"`.
 */
export function getConfigReactivity(path: string): Reactivity {
  return (configReactivity as Record<string, Reactivity>)[path] ?? "boot";
}
