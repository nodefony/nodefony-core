import type { IUser, IUserProvider } from "@nodefony/user";

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
 * Claim d'un jeton d'accès émis par l'application qui porte la version des
 * identifiants du compte à l'émission (`IUser.credentialsVersion`).
 */
export const CREDENTIALS_VERSION_CLAIM = "cv";

/**
 * Clé, dans `metadata` d'un enregistrement de jeton comme dans le `metaBag`
 * d'une session, qui porte la version des identifiants lue à l'émission.
 */
export const CREDENTIALS_VERSION_KEY = "credentialsVersion";

/**
 * La version des identifiants à inscrire dans un artefact qu'on émet pour ce
 * compte — 0 quand le compte n'en porte pas encore.
 *
 * @param user - compte pour lequel l'artefact est émis.
 * @returns la version courante, jamais `null`.
 */
export function credentialsVersionOf(user: IUser): number {
  return user.credentialsVersion ?? 0;
}

/**
 * Dit si un artefact d'accès (jeton, session, clé) appartient bien au compte
 * qu'on vient de recharger par son identifiant fonctionnel, ET s'il a été émis
 * depuis le dernier changement de mot de passe.
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
 * La version des identifiants fait de la coupure au changement de mot de passe
 * un ÉTAT du compte, et non une suppression : si la cascade de révocation
 * échoue, ou si une requête en vol sur un autre processus réécrit la session
 * qu'on vient d'effacer, l'artefact porte toujours l'ancienne version, et il
 * tombe ici. Un artefact émis avant cette règle n'en porte pas : il vaut 0,
 * comme un compte qui n'a jamais changé de mot de passe — le déploiement ne
 * déconnecte personne. Une valeur d'un autre type est refusée.
 *
 * ⚠️ Chemin chaud — appelée sur CHAQUE requête authentifiée : deux comparaisons
 * de chaîne et d'entier, aucune allocation.
 *
 * @param user - compte rechargé par l'identifiant que porte l'artefact.
 * @param boundAccountId - identifiant immuable inscrit dans l'artefact.
 * @param boundCredentialsVersion - version des identifiants inscrite dans
 *   l'artefact ({@link CREDENTIALS_VERSION_KEY}), `undefined` si absente.
 *   Obligatoire dans la signature pour qu'aucune porte ne l'oublie.
 * @returns `true` si l'artefact a été émis pour CE compte, à sa version courante.
 */
export function isBoundToAccount(
  user: IUser,
  boundAccountId: unknown,
  boundCredentialsVersion: unknown,
): boolean {
  return (
    typeof boundAccountId === "string" &&
    boundAccountId.length > 0 &&
    boundAccountId === user.id &&
    (boundCredentialsVersion ?? 0) === (user.credentialsVersion ?? 0)
  );
}

/**
 * Recharge le compte qu'un jeton d'accès de CETTE application désigne, ou
 * `null` : sujet inconnu, compte inactif ou verrouillé, jeton émis pour un
 * autre compte du même nom ou avant un changement de mot de passe.
 *
 * SEULE implémentation de la règle « ce jeton ouvre-t-il encore ce compte ? »
 * pour un jeton maison : la zone `jwt` (`JwtAuthenticator`) et le résolveur de
 * compte d'une ressource protégée l'appellent, aucun ne la recopie. Un refus
 * est `null`, jamais une exception : chaque appelant le traduit dans son
 * propre contrat (401 uniforme, outil en `isError`).
 *
 * @param provider - annuaire des comptes de l'application.
 * @param identifier - identifiant fonctionnel porté par le jeton (`sub`).
 * @param boundAccountId - identifiant immuable inscrit dans le jeton ({@link ACCOUNT_ID_CLAIM}).
 * @param boundCredentialsVersion - version des identifiants inscrite ({@link CREDENTIALS_VERSION_CLAIM}).
 * @returns le compte, ou `null` s'il n'est pas (ou plus) celui du jeton.
 */
export async function loadBoundAccount(
  provider: IUserProvider,
  identifier: string,
  boundAccountId: unknown,
  boundCredentialsVersion: unknown,
): Promise<IUser | null> {
  let user: IUser;
  try {
    user = await provider.loadUserByIdentifier(identifier);
  } catch {
    // Sujet inexistant : un refus, jamais une 500 ni une fuite.
    return null;
  }
  if (!user.isActive() || user.isLocked()) return null;
  // Émis pour CE compte : un compte recréé sous le même `sub` (suppression
  // hors framework) porte un autre `id` — le jeton de l'ancien est refusé.
  return isBoundToAccount(user, boundAccountId, boundCredentialsVersion)
    ? user
    : null;
}
