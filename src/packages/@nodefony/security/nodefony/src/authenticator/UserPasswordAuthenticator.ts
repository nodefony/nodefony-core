import type { ContextType } from "@nodefony/http";
import type { IPasswordVerifier } from "@nodefony/user";
import type { IAuthenticator } from "../../contracts/IAuthenticator";
import type { IToken } from "../../contracts/IToken";
import { AuthenticationError } from "../../errors/AuthenticationError";
import { UserToken } from "../token/UserToken";

// Scheme HTTP case-insensitive (RFC 7235 §2.1) suivi d'au moins un espace.
const BASIC_SCHEME = /^basic\s+/i;

// Message UNIFORME quelle que soit la cause (identifiant inconnu, compte
// inactif/verrouillé, mot de passe faux) — anti-énumération de comptes. La
// raison fine part dans les events d'audit du verifier, jamais au client.
const INVALID_CREDENTIALS = "Invalid credentials";

/** Credential extrait de la requête, porté par le token jusqu'à vérification. */
interface IPasswordCredentials {
  identifier: string;
  password: string;
}

/**
 * Authentification par identifiant + mot de passe — schéma **HTTP Basic**
 * (RFC 7617) : `Authorization: Basic base64(identifiant:motdepasse)`, charset
 * UTF-8, split au PREMIER `:` (le mot de passe peut en contenir).
 *
 * La vérification est déléguée au {@link IPasswordVerifier} (`UserService` par
 * défaut) : hash, comparaison, leurre anti-timing et re-hash transparent restent
 * derrière la frontière user — cet authenticator ne voit que le verdict.
 *
 * Le verifier est résolu **paresseusement** au premier login (cold path) : le
 * boot ne paie rien et l'ordre de chargement des modules est indifférent.
 *
 * @remarks Le login par formulaire (body JSON) n'est PAS ici : il arrive avec la
 * session BFF (`AuthController`, J3) qui appelle le verifier directement.
 */
export class UserPasswordAuthenticator implements IAuthenticator {
  readonly name = "userpassword";
  #verifier: IPasswordVerifier | null = null;
  readonly #resolveVerifier: () => IPasswordVerifier;

  /**
   * @param resolveVerifier - résolution lazy de la source de vérification
   *   (typiquement `container.get("users")`) — appelée au premier login.
   */
  constructor(resolveVerifier: () => IPasswordVerifier) {
    this.#resolveVerifier = resolveVerifier;
  }

  /** La requête porte-t-elle un en-tête `Authorization: Basic ...` ? */
  supports(context: ContextType): boolean {
    const auth = context.request?.headers?.authorization;
    return typeof auth === "string" && BASIC_SCHEME.test(auth);
  }

  /** Décode l'enveloppe Basic — un contenu malformé donne un credential vide (échec uniforme). */
  createToken(context: ContextType): Promise<IToken> {
    const auth = context.request?.headers?.authorization as string;
    const decoded = Buffer.from(
      auth.replace(BASIC_SCHEME, ""),
      "base64",
    ).toString("utf8");
    const sep = decoded.indexOf(":");
    const credentials: IPasswordCredentials =
      sep > 0
        ? {
            identifier: decoded.slice(0, sep),
            password: decoded.slice(sep + 1),
          }
        : { identifier: "", password: "" };
    return Promise.resolve(new UserToken(this.name, credentials));
  }

  /**
   * Vérifie le credential via le verifier ou lève un 401 au message uniforme.
   * Au succès le token est promu : utilisateur posé, credential effacé.
   */
  async authenticate(token: IToken): Promise<IToken> {
    const credentials = token.getCredentials() as IPasswordCredentials | null;
    if (!credentials?.identifier || !credentials.password) {
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    const verifier = (this.#verifier ??= this.#resolveVerifier());
    const user = await verifier.authenticate(
      credentials.identifier,
      credentials.password,
    );
    if (user === null) {
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    return (token as UserToken).promote(user);
  }

  /** Slot J3 (session BFF au login) — rien à poser pour du Basic pur. */
  onSuccess(_context: ContextType, _token: IToken): Promise<void> {
    return Promise.resolve();
  }

  /** Slot J2 (throttling/lockout par identifiant). Le 401 + challenge sont posés par le firewall. */
  onFailure(_context: ContextType, _error: Error): Promise<void> {
    return Promise.resolve();
  }

  /** Challenge RFC 7235 posé par le firewall sur les 401 de la zone. */
  challenge(): string {
    return 'Basic realm="nodefony", charset="UTF-8"';
  }
}

export default UserPasswordAuthenticator;
