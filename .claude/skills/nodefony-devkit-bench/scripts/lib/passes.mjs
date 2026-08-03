/**
 * Retrouver LA passe à juger dans l'historique du décor.
 *
 * Le banc écrit trois sortes de commits, et deux d'entre elles se terminent par
 * les mêmes mots :
 *
 *   remise à zéro avant la tâche 26 — état initial
 *   décor de la tâche 26                 ← la prémisse, posée AVANT l'agent
 *   tâche 26                             ← le travail de l'agent
 *
 * Tant qu'une tâche n'était jouée qu'une fois, « le plus récent » suffisait et
 * l'ambiguïté ne coûtait rien. Avec des répétitions, un `endsWith("tâche 26")`
 * compte DEUX entrées par passe : le rang désigne alors un commit de décor, et
 * le banc rend un FAIL sur du travail que l'agent n'a jamais écrit — trois
 * verdicts faux, dont deux accusaient l'agent d'un diff qui était le nôtre.
 *
 * D'où une fonction PURE, qui reçoit le journal plutôt que de le lire : c'est ce
 * qui permet de l'éprouver sur un historique fabriqué, avec ses décors et ses
 * remises à zéro, sans monter la moindre application.
 */

/**
 * Indices des commits de TRAVAIL d'une tâche, du plus récent au plus ancien.
 *
 * @param {string[]} log - lignes `<hash> <message>`, ordre de `git log`.
 * @param {number|string} id - identifiant de la tâche.
 * @returns {number[]} les indices, dans l'ordre du journal.
 */
export function passesDe(log, id) {
  const attendu = `tâche ${id}`;
  return log
    .map((l, i) => (l.slice(l.indexOf(" ") + 1) === attendu ? i : -1))
    .filter((i) => i !== -1);
}

/**
 * Indice de la passe à juger.
 *
 * @param {string[]} log - lignes `<hash> <message>`.
 * @param {number|string} id - identifiant de la tâche.
 * @param {number|null} occurrence - rang CHRONOLOGIQUE (0 = la première passe).
 *   `null` = la plus récente, seul cas quand la tâche n'a été jouée qu'une fois.
 * @returns {number} l'indice, ou `-1` si cette passe n'existe pas.
 */
export function indiceDeLaPasse(log, id, occurrence = null) {
  const passes = passesDe(log, id);
  if (occurrence === null) return passes[0] ?? -1;
  // `git log` va du plus récent au plus ancien : la passe n° 0 est la DERNIÈRE
  // de la liste.
  return passes[passes.length - 1 - occurrence] ?? -1;
}
