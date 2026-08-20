import {
  ACCESS_TOKEN_VERIFIER,
  buildBearerChallenge,
  canonicalIssuer,
  protectedResourceMetadataUrl,
  type Container,
  type IAccessPrincipal,
  type IAccessTokenVerifier,
} from "nodefony";
import type { ContextType } from "@nodefony/http";
import { BaseUser, type IUser, type IUserProvider } from "@nodefony/user";
import type { IAuthenticator } from "../../contracts/IAuthenticator";
import type { ISecuredArea } from "../../contracts/ISecuredArea";
import type { IToken } from "../../contracts/IToken";
import { AuthenticationError } from "../../errors/AuthenticationError";
import { UnverifiableTokenError } from "../../errors/UnverifiableTokenError";
import { UserToken } from "../token/UserToken";
import { bearerToken } from "./bearer";
import {
  localIdentifierFor,
  type ExternalSubjectMapping,
} from "./externalSubject";
import { peekIssuer } from "./peekIssuer";

/**
 * Message UNIFORME de refus — la cause fine (expiré, audience, signature, sujet
 * inconnu) part au journal, jamais au client : un refus détaillé est un oracle
 * qui aide à fabriquer un jeton acceptable.
 */
const INVALID_TOKEN = "Invalid token";

/** Clé de transport de l'audience entre `createToken` et `authenticate`. */
const AUDIENCE = "audience";

/** Comment le sujet d'un jeton devient un utilisateur de cette application. */
export type ExternalSubjectPolicy = "require" | "ephemeral";

/** Un émetteur reconnu, et la façon dont ses sujets entrent chez nous. */
export interface IExternalIssuerBinding {
  /** Émetteur de confiance, sous sa forme canonique. */
  issuer: string;
  /** Comment le `sub` de CET émetteur devient un identifiant local. */
  subjectMapping: ExternalSubjectMapping;
}

/** Ce que la fabrique doit fournir à l'authenticator. */
export interface IExternalJwtAuthenticatorOptions {
  /**
   * Émetteurs de confiance, et leur politique de sujet.
   *
   * La liste sert à deux choses, qu'il ne faut pas confondre : reconnaître les
   * jetons qui relèvent de cet authenticator (aiguillage — elle n'accorde
   * rien, le vérificateur refait le contrôle sur sa propre liste), et savoir
   * dans quel espace de noms lire le sujet de chacun.
   */
  issuers: readonly IExternalIssuerBinding[];
  /** Politique de rattachement du sujet à un utilisateur local. */
  subjectPolicy: ExternalSubjectPolicy;
  /** Rôles accordés en mode `ephemeral`. */
  ephemeralRoles: readonly string[];
}

/**
 * Authentification par **jeton d'accès émis par un serveur d'autorisation
 * TIERS** (Keycloak, Auth0, Entra, ou l'émetteur d'une flotte d'agents).
 *
 * C'est le chaînon qui relie deux pièces déjà en place : le vérificateur de
 * jetons distants, qui sait lire un jeton dont on ne possède pas la clé, et le
 * pare-feu, qui raisonne en utilisateurs et en rôles. Le vérificateur s'arrête
 * à un sujet et des scopes — délibérément, car établir une identité
 * applicative est une décision de l'application, pas du protocole. C'est cette
 * décision-là que porte cette classe, et rien d'autre.
 *
 * ## Cohabitation avec les jetons maison
 *
 * `JwtAuthenticator` et celui-ci reconnaissent la même forme de credential.
 * Chacun ne prend donc que les jetons dont l'émetteur revendiqué est le sien
 * ({@link peekIssuer}) — lecture non vérifiée qui ne sert qu'à AIGUILLER. Sans
 * cela, en mode `first`, le premier listé capturerait les deux familles et
 * refuserait la moitié des jetons : l'ordre de la configuration deviendrait
 * une décision de sécurité, dont l'erreur ne se verrait qu'en production.
 *
 * ## Ce qui vaut garantie
 *
 * - **L'audience vient de la ZONE**, jamais du jeton, et elle est obligatoire :
 *   sans elle l'authenticator refuse de démarrer ({@link validateArea}).
 * - **Un refus est un 401 uniforme ; une PANNE est un 503** — un émetteur
 *   injoignable n'est pas un jeton invalide, et le dire autrement enverrait le
 *   client renouveler en boucle un jeton parfaitement bon.
 * - **Le sujet est revérifié localement** en mode `require` : un compte
 *   supprimé, désactivé ou verrouillé ferme l'accès sans attendre l'expiration
 *   du jeton, que l'application ne contrôle pas.
 *
 * - **Le sujet n'entre jamais nu dans l'espace de noms local** : un `sub` n'est
 *   unique que chez son émetteur, et le rattachement passe donc par
 *   {@link localIdentifierFor}, piloté par le `subjectMapping` de CET émetteur.
 * - **Le refus est apprenable** : le défi porte le pointeur `resource_metadata`
 *   (RFC 9728), qui dit au client où aller chercher de quoi obtenir un jeton.
 */
export class ExternalJwtAuthenticator implements IAuthenticator {
  readonly name = "external-jwt";
  readonly #container: Container;
  readonly #issuers: ReadonlyMap<string, ExternalSubjectMapping>;
  readonly #policy: ExternalSubjectPolicy;
  readonly #ephemeralRoles: readonly string[];
  #userProvider: IUserProvider | null = null;

  /**
   * @param container - container DI (résolution lazy du vérificateur et de `users`)
   * @param options - émetteurs reconnus et politique de rattachement
   */
  constructor(container: Container, options: IExternalJwtAuthenticatorOptions) {
    this.#container = container;
    const issuers = new Map<string, ExternalSubjectMapping>();
    for (const binding of options.issuers) {
      // Un émetteur mal formé n'empêche PAS l'aiguillage de se construire : le
      // vérificateur est l'autorité et refuse déjà cette configuration, en le
      // disant (CRITIC). Le retenir ici ne servirait qu'à faire échouer le boot
      // deux fois pour la même cause ; l'ignorer le rend simplement inconnu,
      // donc refusé.
      try {
        issuers.set(canonicalIssuer(binding.issuer), binding.subjectMapping);
      } catch {
        continue;
      }
    }
    this.#issuers = issuers;
    this.#policy = options.subjectPolicy;
    this.#ephemeralRoles = options.ephemeralRoles;
  }

  /**
   * La requête porte-t-elle un jeton se réclamant d'un émetteur de confiance ?
   *
   * Le contrôle est délibérément le MÊME que celui du vérificateur, et non un
   * simple « c'est un JWT » : un jeton maison ne doit pas être capturé ici, et
   * un jeton d'un émetteur inconnu n'a pas à provoquer le moindre travail.
   */
  supports(context: ContextType): boolean {
    const auth = context.request?.headers?.authorization;
    if (typeof auth !== "string") return false;
    const raw = bearerToken(auth);
    if (raw === null) return false;
    const issuer = peekIssuer(raw);
    if (issuer === null) return false;
    // Cas nominal : l'émetteur est écrit exactement comme en configuration —
    // aucune allocation. La normalisation ne sert qu'aux écarts de forme (barre
    // oblique terminale), et elle est GARDÉE : `canonicalIssuer` lève sur une
    // valeur qui n'est pas une URL https, et cette valeur vient d'un jeton que
    // n'importe qui peut forger. Une exception ici traverserait `supports()`,
    // que le pare-feu appelle hors de son bloc de rattrapage — soit une 500
    // provoquée par un anonyme, avec une simple chaîne dans `iss`.
    if (this.#issuers.has(issuer)) return true;
    try {
      return this.#issuers.has(canonicalIssuer(issuer));
    } catch {
      return false;
    }
  }

  /**
   * Extrait le jeton brut ET l'audience de la zone.
   *
   * L'audience transite par le token parce que `authenticate()` ne reçoit pas
   * le contexte : c'est ici, et seulement ici, qu'on sait quelle ressource est
   * visée.
   */
  createToken(context: ContextType): Promise<IToken> {
    const auth = context.request?.headers?.authorization;
    const token = new UserToken("external-jwt", bearerToken(auth) ?? "");
    const area = context.security as ISecuredArea | null | undefined;
    if (area?.resource) token.setAttribute(AUDIENCE, area.resource);
    return Promise.resolve(token);
  }

  /**
   * Vérifie le jeton auprès de son émetteur, puis rattache le sujet.
   *
   * @throws AuthenticationError (401) — jeton refusé, ou sujet sans compte
   *   local utilisable
   * @throws UnverifiableTokenError (503) — rien ne peut vérifier ce jeton, ou
   *   l'émetteur est injoignable : on ne sait pas, et on le dit
   */
  async authenticate(token: IToken): Promise<IToken> {
    const raw = token.getCredentials();
    if (typeof raw !== "string" || raw.length === 0) {
      throw new AuthenticationError(INVALID_TOKEN);
    }
    const audience = token.getAttribute<string>(AUDIENCE);
    if (!audience) {
      // Ne peut arriver que si la zone a perdu sa ressource après le boot :
      // `validateArea` l'exige. Fail-closed plutôt que de vérifier sans
      // audience, ce qui accepterait un jeton émis pour un autre service.
      throw new UnverifiableTokenError();
    }

    const verify = this.#container.get<IAccessTokenVerifier>(
      ACCESS_TOKEN_VERIFIER,
    );
    if (typeof verify !== "function") {
      // La zone se dit protégée par des jetons tiers, mais rien ne sait les
      // lire (aucun émetteur déclaré, ou configuration refusée au boot).
      // Laisser passer reviendrait à accepter n'importe quel porteur.
      throw new UnverifiableTokenError();
    }

    let principal: IAccessPrincipal | null;
    try {
      principal = await verify(raw, audience);
    } catch (error) {
      // Le contrat du vérificateur réserve l'exception aux PANNES ; un refus
      // rend `null`. La distinction ne survit que si on la conserve ici.
      throw new UnverifiableTokenError((error as Error).message);
    }
    if (principal === null) throw new AuthenticationError(INVALID_TOKEN);

    const subject = principal.subject;
    if (!subject) {
      // Sans sujet, il n'y a rien à rattacher, rien à révoquer et rien à
      // auditer — l'accès serait accordé à un porteur anonyme.
      throw new AuthenticationError(INVALID_TOKEN);
    }

    // L'espace de noms du sujet. Absent de la table d'aiguillage alors que le
    // vérificateur vient d'accepter ce jeton : les deux listes viennent pourtant
    // de la MÊME configuration. On ne sait donc pas dans quel espace lire ce
    // sujet — et deviner, ici, c'est choisir entre « compte local » et « compte
    // étranger ». PANNE (503), jamais un refus : le jeton est bon, c'est
    // l'application qui est incohérente, et le silence ferait rentrer le sujet
    // par le mode le plus permissif.
    const mapping = this.#issuers.get(principal.issuer);
    if (mapping === undefined) {
      throw new UnverifiableTokenError(
        `émetteur « ${principal.issuer} » vérifié mais absent de la table de ` +
          `rattachement des sujets — configuration incohérente.`,
      );
    }

    const user = await this.#resolveUser(principal.issuer, subject, mapping);
    const ut = token as UserToken;
    ut.promote(user);
    ut.setAttribute("scopes", [...principal.scopes]);
    // Le sujet BRUT et son émetteur voyagent séparément : c'est la paire qui
    // identifie, et l'audit doit pouvoir dire « qui, chez quel annuaire ».
    ut.setAttribute("subject", subject);
    ut.setAttribute("issuer", principal.issuer);
    // 🔴 La borne du jeton voyage avec l'identité, sous les MÊMES noms que
    // `JwtAuthenticator` (`claims`, `jti`). Ce n'est pas de la symétrie de
    // confort : c'est le contrat que lit `FirewallRealtimeAuthenticator` pour
    // savoir quand fermer une socket ouverte au nom de ce jeton. Sans ces
    // attributs, une connexion WebSocket adossée à un jeton tiers ne pouvait
    // JAMAIS être révoquée — ni à l'expiration, ni en masse : le revalidateur
    // ne trouvait aucune borne, donc n'avait aucune raison de couper.
    // Rien n'est alloué quand l'émetteur n'a fourni aucune borne.
    if (principal.expiresAt !== undefined || principal.issuedAt !== undefined) {
      ut.setAttribute("claims", {
        exp: principal.expiresAt,
        iat: principal.issuedAt,
      });
    }
    if (principal.tokenId !== undefined) {
      ut.setAttribute("jti", principal.tokenId);
    }
    return ut;
  }

  /** Slot audit — le firewall enregistre déjà succès et échec par zone. */
  onSuccess(_context: ContextType, _token: IToken): Promise<void> {
    return Promise.resolve();
  }

  /** Slot audit — le 401 et le défi sont posés par le firewall. */
  onFailure(_context: ContextType, _error: Error): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Défi RFC 6750 + pointeur RFC 9728, posé par le firewall sur les 401.
   *
   * ⭐ **C'est cet en-tête qui rend l'autorisation apprenable.** Un `Bearer` nu
   * est un mur : le client sait qu'il lui faut un jeton, mais pas où le
   * demander. `resource_metadata` nomme le document qui le lui dira — c'est le
   * seul mécanisme normalisé pour ça, et celui qu'un client MCP conforme suit.
   *
   * Aucun `error` n'est joint : le firewall pose ce défi sur TOUT 401 de la
   * zone, sans savoir si la requête portait un jeton. Or la RFC 6750 §3
   * demande de ne PAS mettre de code d'erreur quand elle n'en portait aucun —
   * un `invalid_token` ferait renouveler en boucle un jeton qui n'existe pas.
   *
   * @param area - zone refusante ; sans elle (ou sans ressource déclarée) le
   *   défi retombe sur `Bearer` nu, faute de ressource à nommer
   */
  challenge(area?: ISecuredArea): string {
    if (!area?.resource) return "Bearer";
    return buildBearerChallenge({
      resourceMetadataUrl: protectedResourceMetadataUrl(area.resource),
    });
  }

  /**
   * Refuse une zone sans ressource — au boot, pas à la première requête.
   *
   * Sans audience, la vérification accepterait un jeton émis pour un autre
   * service : le seul verrou qui lie un jeton à CE service disparaîtrait, et
   * l'application n'en saurait rien.
   */
  validateArea(area: ISecuredArea): void {
    if (!area.resource) {
      throw new Error(
        `area "${area.name}": l'authenticator "${this.name}" exige que la zone ` +
          `déclare sa ressource (\`resource\`) — c'est l'audience que le jeton ` +
          `doit porter (RFC 8707 §2). Sans elle, un jeton valide délivré au même ` +
          `porteur pour un AUTRE service serait accepté ici.`,
      );
    }
  }

  /**
   * Établit l'utilisateur applicatif à partir du sujet du jeton.
   *
   * Les deux politiques répondent à deux questions différentes : « qui, chez
   * nous, est cette personne ? » et « quel pouvoir accorde-t-on à une machine
   * que l'annuaire a authentifiée ? ».
   */
  async #resolveUser(
    issuer: string,
    subject: string,
    mapping: ExternalSubjectMapping,
  ): Promise<IUser> {
    // UNE seule composition, quelle que soit la politique. En `ephemeral` aussi
    // le sujet doit porter son émetteur : sans cela, deux annuaires distincts
    // produisent le même appelant machine — même ligne d'audit, même compteur
    // de limitation, même canal realtime privé. Aucun compte n'est pris, mais
    // deux identités se confondent, ce qui est le même défaut d'espace de noms.
    const identifier = localIdentifierFor(issuer, subject, mapping);
    if (this.#policy === "ephemeral") {
      // Identité qui ne survit pas à la requête : rien n'est écrit, rien n'est
      // à nettoyer.
      return new BaseUser({
        id: identifier,
        identifier,
        roles: [...this.#ephemeralRoles],
      });
    }
    const provider = this.#resolveUserProvider();
    let user: IUser;
    try {
      user = await provider.loadUserByIdentifier(identifier);
    } catch {
      // Sujet sans compte local : échec d'authentification, jamais une 500.
      throw new AuthenticationError(INVALID_TOKEN);
    }
    if (!user.isActive() || user.isLocked()) {
      throw new AuthenticationError(INVALID_TOKEN);
    }
    return user;
  }

  #resolveUserProvider(): IUserProvider {
    if (this.#userProvider === null) {
      const provider = this.#container.get<IUserProvider>("users");
      if (!provider) {
        throw new Error(
          `ExternalJwtAuthenticator: aucun service "users" (IUserProvider) dans ` +
            `le container — enregistrer un UserService au boot, ou passer la ` +
            `politique de sujet à "ephemeral" si l'appelant est une machine ` +
            `sans compte local.`,
        );
      }
      this.#userProvider = provider;
    }
    return this.#userProvider;
  }
}

export default ExternalJwtAuthenticator;
