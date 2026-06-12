import { nodefonyError } from "nodefony";

/**
 * Utilisateur introuvable dans la source d'identité — levée par les méthodes
 * {@link IUserProvider} (contrat : jamais `null`, l'absence d'identité est un
 * échec explicite).
 *
 * `code = 404` (sémantique interne). Les authenticators de `@nodefony/security`
 * la convertissent en `AuthenticationError` générique : le détail (identifiant
 * inconnu vs mauvais mot de passe) ne doit JAMAIS atteindre le client
 * (anti-énumération de comptes) — il reste réservé aux logs/audit serveur.
 */
export class UserNotFoundError extends nodefonyError {
  constructor(detail: string) {
    super(`User not found: ${detail}`, 404);
  }
}

export default UserNotFoundError;
