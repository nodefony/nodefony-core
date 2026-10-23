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
 *
 * ⚠️ Le motif ne s'élargit PAS à tout le scope `pilotage` : `fix(pilotage)` et
 * `feat(pilotage)` sont du VRAI travail — sur les tickets qui portent
 * précisément cet outillage. Un commit de travail peut donc citer d'autres
 * tickets en passant, et le lint les croira avancés ; c'est pourquoi la
 * clôture de session REGARDE les « en cours » au lieu de s'en remettre à lui.
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

/**
 * Numéros de tickets cités par un texte (`#123`), dédoublonnés, dans l'ordre.
 *
 * Un dièse ne cite un ticket que s'il commence un mot : `PKCS#11`, `C#7` ou
 * `chemin/#12` ne sont pas des tickets. Vécu — « PKCS#11 » dans un message de
 * commit faisait citer la demande de fusion #11 à la clôture de session. SEULE
 * source de la règle : le hook qui passe les tickets en cours, la préparation de
 * clôture et la lecture du `_state` l'appellent, aucun ne la recopie.
 *
 * Un numéro d'ALERTE n'est pas un ticket non plus : la liste qui suit « CodeQL »
 * ou « alerte(s) », éventuellement après l'identifiant de règle et une parenthèse
 * (`CodeQL js/incomplete-sanitization (#245, #246)`, `alertes CodeQL #247 et
 * #249`), est retirée avant la lecture. Vécu — ces numéros d'alerte ont passé
 * trois tickets sans rapport en cours.
 *
 * @param {string} text - message de commit, ligne de mémoire…
 * @returns {number[]} les numéros cités.
 */
export function mentionedTickets(text) {
  const withoutAlerts = text.replace(ALERT_LIST, "");
  return [
    ...new Set(
      [...withoutAlerts.matchAll(/(?<![\w/])#(\d+)\b/gu)].map((m) =>
        Number(m[1]),
      ),
    ),
  ];
}

/** « CodeQL » / « alerte(s) », règle facultative, puis une liste de `#N`. */
const ALERT_LIST =
  /\b(?:CodeQL|alertes?)(?:\s+CodeQL)?(?:\s+[\w-]+\/[\w-]+)?\s*\(?\s*#\d+(?:\s*(?:,|et)\s*#\d+)*/giu;
