import type { ContextType } from "@nodefony/http";
import type { IUserProvider } from "@nodefony/user";
import type { IAuthenticator } from "../../contracts/IAuthenticator";
import type { ISecuredArea } from "../../contracts/ISecuredArea";
import type { IToken } from "../../contracts/IToken";
import { AuthenticationError } from "../../errors/AuthenticationError";
import { resolveSessionIdentity } from "../sessionIdentity";
import { UserToken } from "../token/UserToken";

/** Credential extrait de la session — un identifiant, jamais un secret. */
interface ISessionCredentials {
  identifier: string;
}

/**
 * Authentification par **session serveur** (cookie opaque, modèle BFF) — la
 * preuve des requêtes qui SUIVENT le login (`AuthFlow.login`, qui a déjà posé
 * l'identifiant dans le blob et régénéré l'ID anti-fixation).
 *
 * `supports()` exige une session REPRISE porteuse d'un utilisateur : le
 * pipeline http démarre la session AVANT le firewall (point d'activation
 * unique, lazy — cookie entrant ou intent de route), cet authenticator ne
 * démarre jamais rien lui-même. L'identité est re-résolue à CHAQUE requête
 * via {@link resolveSessionIdentity} (rôles frais, révocation immédiate).
 *
 * Pas de `challenge()` : une session absente/expirée donne un 401 nu — le
 * client web redirige vers son écran de login, jamais de popup Basic. Si la
 * zone liste aussi `userpassword`, le firewall pose SON challenge (RFC 7235).
 */
export class SessionAuthenticator implements IAuthenticator {
  readonly name = "session";
  #provider: IUserProvider | null = null;
  readonly #resolveProvider: () => IUserProvider;

  /**
   * @param resolveProvider - résolution lazy de la source d'identité
   *   (typiquement `container.get("users")`) — appelée à la première requête.
   */
  constructor(resolveProvider: () => IUserProvider) {
    this.#resolveProvider = resolveProvider;
  }

  /**
   * Refuse une zone déclarée SANS REGISTRE — au boot, pas à la première requête.
   *
   * `stateless: true` annonce que l'identité tient tout entière dans la preuve
   * portée par chaque requête, et que la session est ignorée « même si un
   * cookie est présent ». Lister `session` dans une telle zone dit exactement
   * l'inverse : {@link supports} y rendrait vrai dès qu'un cookie ramène une
   * session porteuse d'un utilisateur, et la zone authentifierait par le
   * registre qu'elle déclare ne pas tenir.
   *
   * Cette contradiction ne se voyait NULLE PART : l'application démarrait, la
   * console d'administration affichait « aucun registre serveur », et le
   * cookie authentifiait quand même. Elle se refuse donc au démarrage — le
   * firewall en fait une erreur de configuration fail-closed, plutôt qu'une
   * requête sur deux qui se comporte autrement que ce qui est écrit.
   *
   * @param area - la zone qui liste cet authenticator.
   * @throws Error si la zone est `stateless` — le message la NOMME.
   */
  validateArea(area: ISecuredArea): void {
    if (area.stateless) {
      throw new Error(
        `area "${area.name}": l'authenticator "${this.name}" est incompatible ` +
          `avec \`stateless: true\` — une zone sans registre ne peut pas tirer ` +
          `son identité d'une session serveur. Retirer "session" de cette zone ` +
          `(l'appelant porte sa preuve : \`apikey\`, \`jwt\`, \`external-jwt\`), ` +
          `ou passer la zone à \`stateless: false\` si elle sert un navigateur.`,
      );
    }
  }

  /** La requête porte-t-elle une session reprise avec un utilisateur ? */
  supports(context: ContextType): boolean {
    const user = context.session?.user;
    return typeof user === "string" && user.length > 0;
  }

  /** Extrait l'identifiant du blob de session (jamais de secret en jeu). */
  createToken(context: ContextType): Promise<IToken> {
    const credentials: ISessionCredentials = {
      identifier: context.session?.user ?? "",
    };
    return Promise.resolve(new UserToken(this.name, credentials));
  }

  /**
   * Re-résout l'identifiant de session en utilisateur vivant et promeut le
   * token. Les contrôles d'état (existe, actif, non verrouillé) vivent dans
   * {@link resolveSessionIdentity} — partagés avec `AuthFlow.me()`.
   *
   * @throws AuthenticationError (401, message uniforme) — session orpheline,
   *   compte verrouillé ou désactivé.
   */
  async authenticate(token: IToken): Promise<IToken> {
    const credentials = token.getCredentials() as ISessionCredentials | null;
    if (!credentials?.identifier) {
      throw new AuthenticationError("Invalid session");
    }
    const provider = (this.#provider ??= this.#resolveProvider());
    const user = await resolveSessionIdentity(provider, credentials.identifier);
    return (token as UserToken).promote(user);
  }

  /**
   * Pose l'identifiant sur le contexte : la persistance de session du pipeline
   * (`saveSession`) lie le blob au principal courant (string attendu).
   */
  onSuccess(context: ContextType, token: IToken): Promise<void> {
    context.user = token.getUser().identifier;
    return Promise.resolve();
  }

  /** Slot audit (P6.14). Le 401 est posé par le firewall. */
  onFailure(_context: ContextType, _error: Error): Promise<void> {
    return Promise.resolve();
  }
}

export default SessionAuthenticator;
