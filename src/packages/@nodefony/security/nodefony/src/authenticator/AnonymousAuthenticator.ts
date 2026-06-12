import type { ContextType } from "@nodefony/http";
import type { IAuthenticator } from "../../contracts/IAuthenticator";
import type { IToken } from "../../contracts/IToken";
import { AnonymousToken } from "../token/AnonymousToken";

/**
 * Acceptation EXPLICITE de l'anonymat dans une zone — le seul authenticator
 * autorisé à produire un token non authentifié sans déclencher le Zero Trust.
 *
 * Ne le lister que volontairement : une zone `authenticators: ["jwt", "anonymous"]`
 * (mode `first`) signifie « identifié si preuve présente, sinon visiteur anonyme
 * accepté ». Sans lui, zone protégée + aucune preuve → 401. En mode `all` il
 * reste utile en DERNIER : « le canal doit être prouvé (ex. mtls), l'identité
 * utilisateur est optionnelle ».
 *
 * Zéro coût : `supports()` accepte tout, le token porte le singleton gelé
 * `anonymousUser` (aucune allocation d'utilisateur).
 */
export class AnonymousAuthenticator implements IAuthenticator {
  readonly name = "anonymous";

  supports(): boolean {
    return true;
  }

  createToken(): Promise<IToken> {
    return Promise.resolve(new AnonymousToken());
  }

  /** Toujours un succès — accepter l'anonymat ne vérifie rien. */
  authenticate(token: IToken): Promise<IToken> {
    return Promise.resolve(token);
  }

  onSuccess(_context: ContextType, _token: IToken): Promise<void> {
    return Promise.resolve();
  }

  onFailure(_context: ContextType, _error: Error): Promise<void> {
    return Promise.resolve();
  }
}

export default AnonymousAuthenticator;
