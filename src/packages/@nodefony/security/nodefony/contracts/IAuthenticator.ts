import type { ContextType } from "@nodefony/http";
import type { IToken } from "./IToken";
import type { ISecuredArea } from "./ISecuredArea";

/**
 * Stratégie d'authentification — pattern « authenticator » : une classe = une
 * façon de prouver qui on est. Pas de Bridge/Factory (héritage Passport/YAML
 * abandonné).
 *
 * Une zone sécurisée ({@link ISecuredArea}) liste les noms d'authenticators à
 * exécuter selon son `mode` : `"first"` (le premier dont `supports()` est vrai
 * authentifie) ou `"all"` (tous doivent passer — MFA, le dernier porte
 * l'identité). Cycle : `createToken()` extrait le credential (token non
 * authentifié), `authenticate()` valide et promeut ou `throw` (→ 401).
 *
 * Implémentations : `AnonymousAuthenticator`, `UserPasswordAuthenticator`,
 * `SessionAuthenticator`, `JwtAuthenticator`, `ApiKeyAuthenticator`.
 *
 * Le login social ne passe **pas** par un authenticator : `OAuth2Service`
 * échange le code, provisionne l'utilisateur et ouvre une session BFF — c'est
 * ensuite `SessionAuthenticator` qui ré-authentifie les requêtes suivantes.
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

  /** Hook échec — log audit, throttling (J2)… Le 401 + challenge sont posés par le firewall. */
  onFailure(context: ContextType, error: Error): Promise<void>;

  /**
   * Challenge `WWW-Authenticate` (RFC 7235 : tout 401 DOIT en porter un).
   * Le firewall pose celui du premier authenticator de la zone qui en déclare.
   * Ex. `'Basic realm="nodefony", charset="UTF-8"'`, `'Bearer'`.
   */
  challenge?(): string;

  /**
   * Vérifie AU BOOT que la zone qui référence cet authenticator lui donne ce
   * dont il a besoin — sinon `throw`, et la configuration n'existe pas.
   *
   * Appelée une fois par zone qui le liste, avant la première requête. C'est
   * l'authenticator qui dit ce qu'il exige, jamais le firewall : celui-ci ne
   * connaît aucun nom en dur, et un plugin tiers doit pouvoir poser ses propres
   * exigences sans qu'on touche au cœur.
   *
   * Le contrôle vaut d'être fait ici plutôt qu'à la première requête, où il se
   * manifesterait par un 401 sans cause visible, chez un seul appelant, un jour
   * quelconque.
   *
   * @param area - la zone qui référence cet authenticator
   * @throws Error si la zone ne remplit pas les conditions d'emploi
   */
  validateArea?(area: ISecuredArea): void;
}
