import { AuthenticationError } from "./AuthenticationError";

/**
 * Session PÉRIMÉE — elle ne désigne plus personne de valide : compte supprimé,
 * verrouillé, désactivé, recréé sous le même identifiant, mot de passe changé
 * depuis son ouverture, ou blob vidé. C'est un ÉTAT à purger, pas une preuve
 * fausse présentée par un tiers : le `SessionAuthenticator` la détruit côté
 * serveur ET côté navigateur (cookie expiré, RFC 6265 §5.3), puis le firewall
 * poursuit comme si aucune session n'avait été présentée — une page ouverte
 * aux anonymes s'affiche, une zone fermée redemande la connexion.
 *
 * Jamais levée pour une PANNE de la source d'identité : une base injoignable
 * ne dit rien de la session, qui doit survivre à l'incident.
 */
export class StaleSessionError extends AuthenticationError {
  constructor(message: string | Error = "Invalid session") {
    super(message);
  }
}

export default StaleSessionError;
