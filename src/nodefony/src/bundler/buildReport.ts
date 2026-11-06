/**
 * Rapport de build de rolldown — règle UNIQUE, partagée par le socle rolldown
 * (`nodefony/bundler`) et le builder Vite de `@nodefony/frontend`.
 *
 * Volontairement sans import de `rolldown` : le builder Vite la lit depuis le
 * barrel `nodefony`, qui ne doit pas charger le bundler au démarrage d'une
 * application.
 */

/** Option `devtools` de rolldown qui écrit le rapport de build. */
export interface IBuildReportDevtools {
  mode: "report";
}

/**
 * Option `devtools` qui fait écrire à rolldown son RAPPORT DE BUILD, ou
 * `undefined` pour ne rien écrire.
 *
 * Chaque build écrit sous `node_modules/.rolldown/report/<dossier de sortie>/`,
 * relatif au `cwd` : `entry.md` (le résumé, par où commencer), `delta.md`
 * (l'écart avec le build précédent et avec une base épinglée — `cp .state.json
 * baseline.json`), `chunks.md`, `packages.md`, `metrics.json` (identifiants
 * stables, à lire au `jq`) et un `AGENTS.md` pour l'agent qui les lit. Rien
 * n'est écrit en mode watch ni par le serveur de développement de Vite : seul
 * un build en écrit un. Le dossier vit dans `node_modules`, une installation
 * propre l'efface.
 *
 * Allumé par défaut : un agent ne découvre pas une option éteinte, et le coût
 * se limite à quelques petits fichiers hors du dépôt.
 *
 * @experimental L'option est expérimentale chez rolldown (1.3) : ce point
 *   unique est le seul à changer si elle évolue.
 * @param enabled - `false` coupe le rapport (défaut `true`)
 * @returns l'option à poser dans `devtools`, ou `undefined`
 */
export function buildReportDevtools(
  enabled = true,
): IBuildReportDevtools | undefined {
  return enabled ? { mode: "report" } : undefined;
}
