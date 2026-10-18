import type { IUser } from "@nodefony/user";

/**
 * Claim d'un jeton d'accès émis par l'application qui porte l'identifiant
 * IMMUABLE du compte (`IUser.id`) — `sub` porte l'identifiant fonctionnel.
 */
export const ACCOUNT_ID_CLAIM = "uid";

/**
 * Clé, dans `metadata` d'un enregistrement de jeton (refresh, clé d'API) comme
 * dans le `metaBag` d'une session, qui porte l'identifiant immuable du compte.
 */
export const ACCOUNT_ID_KEY = "accountId";

/**
 * Dit si un artefact d'accès (jeton, session, clé) appartient bien au compte
 * qu'on vient de recharger par son identifiant fonctionnel.
 *
 * Les artefacts sont rangés sous l'`identifier`, qu'un compte RECRÉÉ peut
 * reprendre : supprimé hors du framework (`DELETE` SQL, restauration, import)
 * puis revenu sous le même nom, l'identité se rechargerait et l'artefact de
 * l'ancien titulaire ouvrirait le compte du nouveau. L'identifiant immuable
 * lève l'ambiguïté sans dépendre d'aucun événement ni d'aucun stockage : deux
 * comptes successifs portent deux `id` différents. SEULE règle de
 * comparaison — chaque authentificateur l'appelle, aucun ne la recopie.
 *
 * Un artefact SANS liaison est refusé : il a été émis avant que la règle
 * existe, et rien ne dit à qui il appartient.
 *
 * @param user - compte rechargé par l'identifiant que porte l'artefact.
 * @param boundAccountId - identifiant immuable inscrit dans l'artefact.
 * @returns `true` si l'artefact a été émis pour CE compte.
 */
export function isBoundToAccount(
  user: IUser,
  boundAccountId: unknown,
): boolean {
  return (
    typeof boundAccountId === "string" &&
    boundAccountId.length > 0 &&
    boundAccountId === user.id
  );
}
