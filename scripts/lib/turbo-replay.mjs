/**
 * Ce que turbo a REJOUÉ du cache au lieu de l'exécuter — seule implémentation.
 *
 * Une tâche `test` dont les entrées n'ont pas bougé n'est pas relancée : turbo
 * réimprime son journal d'alors (« cache hit, replaying logs »), compteurs de
 * tests compris. Un rapport qui additionne ces compteurs annonce comme joués des
 * tests qui ne l'ont pas été — vécu (#472) : « 13 759 passés » en 1 s, alors
 * qu'aucune des suites intermittentes visées n'avait tourné.
 *
 * @usage import { replayedTasks } from "../lib/turbo-replay.mjs"
 */

/**
 * Nomme les paquets dont la tâche `task` a été rejouée du cache par turbo.
 *
 * Les tâches d'une autre famille (les `build` dont `task` dépend) ne comptent
 * pas : leur rejeu est le travail normal du cache, il ne fausse aucun compte.
 *
 * @param {string} output - sortie brute de `turbo run` (codes couleur admis).
 * @param {string} task - la tâche dont on veut savoir si elle a vraiment tourné.
 * @returns {string[]} les paquets rejoués, dans l'ordre d'apparition, sans doublon.
 */
export function replayedTasks(output, task) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const found = new Set();
  for (const line of clean.split("\n")) {
    const m = /^([^:\s]+):(\S+): cache hit, replaying logs\b/.exec(line.trim());
    if (m?.[2] === task) found.add(m[1]);
  }
  return [...found];
}
