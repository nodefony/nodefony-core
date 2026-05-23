import type { ContextType } from "@nodefony/http";
import type { IToken } from "./IToken";

/**
 * Stratégie d'authentification — pattern « authenticator » (Symfony 6), pas
 * Bridge/Factory (héritage Passport/YAML abandonné).
 *
 * Une zone sécurisée ({@link ISecuredArea}) liste les noms d'authenticators à
 * exécuter. Le firewall, pour chaque requête de la zone, prend le premier dont
 * `supports()` est vrai, fabrique un token non authentifié (`createToken`), puis
 * `authenticate()` valide ou `throw` (→ 401).
 *
 * Implémentations : `AnonymousAuthenticator`, `UserPasswordAuthenticator`,
 * `JwtAuthenticator`, `OAuth2Authenticator`, `MTlsAuthenticator`.
 */
export interface IAuthenticator {
  /** Nom logique (référencé dans `area.authenticators`). */
  readonly name: string;

  /** Peut-on extraire un credential de cette requête ? (sinon authenticator suivant). */
  supports(context: ContextType): boolean;

  /** Construit un token NON authentifié depuis la requête (extraction credential). */
  createToken(context: ContextType): Promise<IToken>;

  /** Valide le token (vérifie le credential) ou `throw` une AuthenticationError. */
  authenticate(token: IToken): Promise<IToken>;

  /** Hook succès — pose le token (cookie JWT, log audit S1…). */
  onSuccess(context: ContextType, token: IToken): Promise<void>;

  /** Hook échec — réponse 401, log audit, entryPoint éventuel. */
  onFailure(context: ContextType, error: Error): Promise<void>;
}
