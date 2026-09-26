/**
 * Compte rendu par une écriture MongoDB (`deletedCount`, `modifiedCount`), 0 s'il manque.
 *
 * Le pilote le type `number`, mais le recopie de la réponse du serveur
 * (`res.n`) : une écriture NON acquittée (`w: 0`) n'en reçoit aucune, et le
 * compte arrive `undefined`. Sans ce repli, un `gc()` rendrait `undefined` et
 * un `> 0` conclurait « rien écrit » pour une raison qui n'est pas la bonne.
 *
 * @param count - le compte tel que le pilote le rend.
 * @returns le compte, ou 0 quand le serveur n'en a rendu aucun.
 */
export function writeCount(count: number | undefined): number {
  return count ?? 0;
}
