import { UserNotFoundError } from "@nodefony/user";
import type { IUser, IUserProvider } from "@nodefony/user";
import { AuthenticationError } from "../errors/AuthenticationError";
import { isBoundToAccount } from "./accountBinding";

// Message UNIFORME quelle que soit la cause (identifiant disparu, compte
// désactivé/verrouillé) — une session périmée ne doit pas révéler POURQUOI.
const INVALID_SESSION = "Invalid session";

/**
 * Résout l'identité portée par une session (l'identifiant stocké dans le blob)
 * en utilisateur VIVANT — re-fetch systématique auprès du provider.
 *
 * C'est LE choix structurant de la session BFF : la session ne stocke que
 * l'identifiant, jamais l'utilisateur sérialisé. Rôles toujours frais, et un
 * compte verrouillé/désactivé entre deux requêtes est rejeté immédiatement
 * (révocation effective — l'argument décisif face au JWT côté web).
 *
 * Partagé par le `SessionAuthenticator` (requêtes en zone) et `AuthFlow.me()`
 * (hors zone) : une seule source de vérité des contrôles d'état du compte.
 *
 * @param provider - source d'identité (`UserService` via le container).
 * @param identifier - identifiant fonctionnel stocké en session.
 * @returns l'utilisateur actif.
 * @throws AuthenticationError (401, message uniforme) — identifiant inconnu,
 *   compte verrouillé ou désactivé.
 */
export async function resolveSessionIdentity(
  provider: IUserProvider,
  identifier: string,
): Promise<IUser> {
  let user: IUser;
  try {
    user = await provider.loadUserByIdentifier(identifier);
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      throw new AuthenticationError(INVALID_SESSION);
    }
    throw error;
  }
  if (user.isLocked() || !user.isActive()) {
    throw new AuthenticationError(INVALID_SESSION);
  }
  return user;
}

/**
 * Résout l'identité d'une session DÉJÀ ouverte, en exigeant qu'elle ait été
 * ouverte pour CE compte — {@link resolveSessionIdentity} plus la liaison à
 * l'identifiant immuable (`isBoundToAccount`).
 *
 * La session range son principal sous l'`identifier`, qu'un compte recréé
 * (suppression hors framework, restauration, import) peut reprendre : sans la
 * liaison, la session de l'ancien titulaire ouvrirait le compte du nouveau.
 * Une session sans liaison est refusée au même titre.
 *
 * @param provider - source d'identité (`UserService` via le container).
 * @param identifier - identifiant fonctionnel stocké en session.
 * @param boundAccountId - identifiant immuable inscrit à l'ouverture
 *   (`metaBag`, clé `ACCOUNT_ID_KEY`).
 * @param boundCredentialsVersion - version des identifiants inscrite à
 *   l'ouverture (`metaBag`, clé `CREDENTIALS_VERSION_KEY`).
 * @returns l'utilisateur actif, titulaire de la session.
 * @throws AuthenticationError (401, message uniforme) — identifiant inconnu,
 *   compte verrouillé ou désactivé, session ouverte pour un autre compte ou
 *   avant le dernier changement de mot de passe.
 */
export async function resolveBoundSessionIdentity(
  provider: IUserProvider,
  identifier: string,
  boundAccountId: unknown,
  boundCredentialsVersion: unknown,
): Promise<IUser> {
  const user = await resolveSessionIdentity(provider, identifier);
  if (!isBoundToAccount(user, boundAccountId, boundCredentialsVersion)) {
    throw new AuthenticationError(INVALID_SESSION);
  }
  return user;
}
