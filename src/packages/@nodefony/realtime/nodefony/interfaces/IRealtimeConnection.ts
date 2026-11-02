/**
 * Une connexion temps réel servie par CE processus — la poignée qu'un
 * gestionnaire `@RealtimeInbound` reçoit, et que les gestes du hub sur les
 * membres d'un canal désignent (`RealtimeHub.subscribeConnection`,
 * `RealtimeHub.evictConnection`, `RealtimeHub.channelMembers`).
 *
 * Elle n'existe que dans la mémoire du processus qui a accepté la socket : elle
 * ne traverse pas le backplane, et un autre exemplaire (pod, `nodefony cluster
 * -w N`) ne la connaît pas. Une poignée fermée, ou venue d'ailleurs, fait rendre
 * `false` aux gestes du hub — jamais un geste muet.
 */
export interface IRealtimeConnection {
  /**
   * Identifiant du compte connecté (`RealtimeIdentity.id`) — la clé des canaux
   * personnels et de `RealtimeHub.evictUser`, qui l'atteint sur tous les
   * exemplaires ; `null` pour l'anonyme (qu'aucun ordre par compte n'atteint),
   * et pour un authentificateur qui ne produit pas d'identité d'admission.
   */
  readonly userId: string | null;
  /** `false` une fois la socket fermée : la poignée ne désigne plus rien. */
  readonly open: boolean;
}
