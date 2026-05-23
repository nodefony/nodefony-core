import { nodefonyError } from "nodefony";

/**
 * Échec d'authentification — `code = 401`. Levée par un {@link IAuthenticator}
 * quand le credential est absent/invalide, ou par le firewall en Zero Trust
 * (zone protégée + visiteur anonyme + route sans `@Anonymous`).
 */
export class AuthenticationError extends nodefonyError {
  constructor(message: string | Error = "Authentication required") {
    super(message, 401);
  }
}

export default AuthenticationError;
