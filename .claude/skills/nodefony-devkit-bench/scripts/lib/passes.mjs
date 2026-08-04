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
 * L'auteur sous lequel le HARNAIS commite. Un agent commite, lui, sous
 * l'identité git de la machine — c'est ce qui les distingue.
 */
export const AUTEUR_HARNAIS = "bench";

/**
 * Ne garder que les commits ÉCRITS PAR LE HARNAIS.
 *
 * Un agent peut committer lui-même — et il le fait : lâché dans un dépôt dont
 * l'historique est fait de « tâche 10 », « tâche 11 », il IMITE la convention
 * qu'il lit. Mesuré sur une passe complète : un agent a écrit un commit
 * `tâche 10`, portant donc exactement le message que le banc emploie pour
 * repérer ses propres passes.
 *
 * L'effet est silencieux et faux dans les deux sens : le banc compte QUATRE
 * passes là où il en a joué trois, les rangs se décalent, une passe est jugée
 * sur le commit partiel de l'agent, une autre est comptée deux fois, et la
 * dernière n'est jamais jugée. Le verdict qui en sort a l'allure d'une mesure —
 * sur T10, un `FAIL 0/3` dont le gate d'état disait pourtant `exit 0`, la
 * contradiction étant le seul indice.
 *
 * Le message ne peut donc pas suffire à identifier une passe : l'agent a le
 * droit d'écrire ce qu'il veut dans le sien. L'AUTEUR, lui, ne se devine pas —
 * le harnais pose le sien explicitement à chaque commit.
 *
 * @param {string[]} log - lignes `<hash>\t<auteur>\t<message>`.
 * @param {string} [auteur] - l'auteur du harnais.
 * @returns {string[]} les lignes retenues, au format `<hash> <message>` attendu
 *   par le reste du banc.
 */
export function commitsDuHarnais(log, auteur = AUTEUR_HARNAIS) {
  const retenus = [];
  for (const ligne of log) {
    const [hash, an, ...reste] = ligne.split("\t");
    // Ligne sans auteur (journal d'un ancien run, relu par `--analyze-only`) :
    // on la garde telle quelle plutôt que de la jeter — un rapport d'archive
    // doit rester lisible, quitte à porter le défaut de son époque.
    if (reste.length === 0) {
      retenus.push(ligne);
      continue;
    }
    if (an === auteur) retenus.push(`${hash} ${reste.join("\t")}`);
  }
  return retenus;
}

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
