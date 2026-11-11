/**
 * Une dépendance qui exige un Node plus récent que le NÔTRE.
 *
 * Vécu : `@inquirer/prompts` 8.8.0 a relevé son plancher à
 * `^22.22.2 || ^24.15.0 || >=26.0.0` dans une MINEURE, quand le dépôt déclarait
 * `>=24.14.0`. Sur Node 24.14, `npm i nodefony` aurait affiché `EBADENGINE`
 * (échec franc sous `engine-strict`) — et l'inventaire, qui ne lisait que les
 * versions, n'en disait rien. Une dépendance qui ne tient pas tout notre
 * plancher le relève À NOTRE PLACE, sans qu'aucune ligne du dépôt ne change.
 *
 * La règle est l'inclusion de plages, jamais une comparaison de bornes basses :
 * `>=24.16.0` contient Node 25, que `^24.15.0 || >=26.0.0` exclut.
 *
 * @usage import { enginesBelowFloor } from "./lib/engines.mjs"
 */
import semver from "semver";

/**
 * Rend les dépendances dont `engines.node` n'accepte pas TOUT le plancher.
 *
 * @param floor - plage `engines.node` du dépôt (`">=24.14.0"`).
 * @param entries - `{ name, version, node }`, `node` = `engines.node` du paquet
 *   (absent = aucune exigence, rien à signaler).
 * @returns les écarts, `unreadable` posé quand la plage du paquet est illisible
 *   — signalée plutôt que tue : on ne peut pas la dire compatible.
 */
export function enginesBelowFloor(floor, entries) {
  const out = [];
  for (const e of entries) {
    if (typeof e.node !== "string" || e.node.trim() === "") continue;
    let covered;
    let unreadable = false;
    try {
      covered = semver.subset(floor, e.node);
    } catch {
      covered = false;
      unreadable = true;
    }
    if (!covered)
      out.push({
        name: e.name,
        version: e.version,
        requires: e.node,
        unreadable,
      });
  }
  return out;
}
