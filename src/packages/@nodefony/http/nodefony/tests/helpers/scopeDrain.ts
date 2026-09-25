/**
 * Attente BORNÉE du drainage des scopes `request` sur le serveur de test.
 *
 * Le kernel libère un scope quand IL traite la fin de l'échange — après que le
 * client a reçu la réponse, ou vu la fermeture. Un relevé pris juste après une
 * boucle compte donc encore les derniers scopes en cours de libération. Une
 * vraie fuite ne se draine JAMAIS ; un simple retard se draine en quelques
 * centaines de millisecondes. D'où un sondage borné, jamais un délai fixe, qui
 * mesurerait la machine et non le code.
 *
 * @param read - relève le nombre de scopes `request` ouverts (route
 * `/nodefony/test/als-test/scopes`, champ `requestScopes`)
 * @param base - relevé de référence, pris avant la boucle
 * @param target - l'attente s'arrête dès que l'écart passe SOUS ce seuil
 * @param timeoutMs - borne de l'attente
 * @returns le dernier écart observé par rapport à `base`
 */
export async function drainTo(
  read: () => Promise<number>,
  base: number,
  target = 5,
  timeoutMs = 8000,
): Promise<number> {
  const t0 = Date.now();
  let delta = (await read()) - base;
  while (delta >= target && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
    delta = (await read()) - base;
  }
  return delta;
}
