/**
 * La fin d'une sortie, en DISANT ce qui manque.
 *
 * Une coupe muette a déjà caché la seule ligne utile : l'erreur d'un lint,
 * rangée au-dessus de vingt avertissements — la CI disait « 1 error » sans
 * la nommer. Toute coupe s'annonce donc, avec le nombre de lignes tues.
 *
 * @param {string} text - la sortie entière
 * @param {number} lines - combien de lignes de fin garder
 * @param {string} [hint] - comment tout relire (option, fichier conservé…)
 * @returns {string} la sortie, entière si elle tient, annoncée sinon
 */
export function tailOf(text, lines, hint = "") {
  const all = text.split("\n");
  if (all.length <= lines) return text;
  const more = hint === "" ? "" : `, ${hint}`;
  return [
    `  … ${all.length - lines} ligne(s) plus haut${more}`,
    ...all.slice(-lines),
  ].join("\n");
}
