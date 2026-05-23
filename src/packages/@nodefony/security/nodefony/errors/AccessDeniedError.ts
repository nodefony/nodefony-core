import { nodefonyError } from "nodefony";

/**
 * Accès refusé — `code = 403`. Levée par l'autorisation (un `@IsGranted` non
 * satisfait, un voter DENY) : l'utilisateur EST authentifié mais n'a pas le droit.
 * À distinguer d'{@link AuthenticationError} (401 = pas authentifié).
 */
export class AccessDeniedError extends nodefonyError {
  constructor(message: string | Error = "Access denied") {
    super(message, 403);
  }
}

export default AccessDeniedError;
