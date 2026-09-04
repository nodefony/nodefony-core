/**
 * Ce qu'un commit PROUVE au sujet des tickets qu'il cite.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Un commit de pilotage — retex de fin de session, recalage du tableau de bord,
 * consignation d'une règle — énumère des dizaines de tickets sans en faire
 * avancer un seul. Deux scripts en dépendent, aux deux bouts du même champ
 * « Status » : `ticket-progress.mjs` monte un ticket « en cours » au premier
 * commit qui le cite, `board-lint.mjs` accuse un « en cours » que plus aucun
 * commit n'adosse. Tant que chacun portait sa propre idée du pilotage, l'un
 * montait ce que l'autre condamnait : le retex du 09-04e a mis #188 « en cours »
 * deux minutes avant que le lint le déclare menteur.
 *
 * La règle vit donc ICI, une seule fois. La recopier « à l'identique » suffit à
 * la faire diverger au premier préfixe ajouté.
 */

/**
 * Préfixes de sujet qui désignent un commit de pilotage — cf #172.
 *
 * Ancrée au SUJET (première ligne), jamais au corps : c'est le corps qui cite
 * les tickets, et c'est le type du commit qui dit ce que cette citation vaut.
 */
export const PILOTAGE = /^(docs\(session\)|chore\(pilotage\)|docs\(claude\))/;

/**
 * Dit si un commit ne fait avancer aucun des tickets qu'il cite.
 *
 * @param message - le sujet seul ou le message complet ; seule la première ligne compte.
 * @returns `true` pour un commit de pilotage, dont les citations ne prouvent rien.
 */
export function isPilotageCommit(message) {
  return PILOTAGE.test(String(message ?? "").split("\n", 1)[0]);
}
