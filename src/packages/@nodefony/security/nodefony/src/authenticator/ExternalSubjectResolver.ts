import { canonicalIssuer, type Container } from "nodefony";
import {
  BaseUser,
  type IOAuthUserProvisioner,
  type IUser,
  type IUserProvider,
} from "@nodefony/user";
import type { ISecuredArea } from "../../contracts/ISecuredArea";
import { AuthenticationError } from "../../errors/AuthenticationError";
import { UnverifiableTokenError } from "../../errors/UnverifiableTokenError";
import {
  localIdentifierFor,
  type ExternalSubjectMapping,
} from "./externalSubject";
import type { ISecurityConfig } from "../../config/defineModuleConfig";
import {
  compileProviderRoleMapping,
  mapProviderRoles,
  type IProviderRoleMapping,
} from "../oauth/providerRoles";

/**
 * Message UNIFORME de refus — la cause fine (sujet inconnu, compte verrouillé)
 * part au journal, jamais au client : un refus détaillé est un oracle.
 */
const INVALID_TOKEN = "Invalid token";

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
  /**
   * Fournisseurs de CONNEXION (`oauth2.providers`) qui déclarent leur émetteur.
   *
   * Quand l'émetteur d'un jeton est celui d'un fournisseur de connexion, la
   * même personne a pu se connecter par le navigateur : son compte local porte
   * alors le lien `(fournisseur, sub)`. Le chercher d'abord évite qu'un jeton
   * d'API désigne un AUTRE compte que la session de son porteur.
   */
  oauthProviders?: readonly {
    name: string;
    issuer: string;
    /**
     * Table de correspondance des rôles du fournisseur, compilée — absente ou
     * `null` : les rôles du compte lié restent locaux.
     */
    roleMapping?: IProviderRoleMapping | null;
  }[];
}

/**
 * Les options de rattachement des sujets externes, lues dans la configuration
 * de sécurité — UNE lecture, pour la zone `external-jwt` comme pour le
 * résolveur de compte d'une ressource protégée.
 *
 * @param config - configuration de sécurité validée
 * @returns émetteurs, politique de sujet, fournisseurs de connexion liables
 */
export function externalSubjectOptions(
  config: ISecurityConfig,
): IExternalJwtAuthenticatorOptions {
  // La liste d'émetteurs sert à DEUX choses : reconnaître les jetons qui
  // relèvent de la règle (elle n'accorde rien, le vérificateur refait le
  // contrôle sur sa propre liste), et dire dans quel espace de noms lire le
  // sujet de chaque émetteur — un `sub` n'est unique que chez le sien.
  const rs = config.resourceServer;
  return {
    issuers: rs.issuers.map((i) => ({
      issuer: i.issuer,
      subjectMapping: i.subjectMapping,
    })),
    subjectPolicy: rs.subjectPolicy,
    ephemeralRoles: rs.ephemeralRoles,
    // Seuls les fournisseurs qui DÉCLARENT leur émetteur peuvent être liés :
    // c'est l'émetteur, pas le nom, qui fait l'identité d'un `sub`.
    oauthProviders: Object.entries(config.oauth2.providers).flatMap(
      ([name, p]) =>
        p.issuer
          ? [
              {
                name,
                issuer: p.issuer,
                roleMapping: compileProviderRoleMapping(p),
              },
            ]
          : [],
    ),
  };
}

/**
 * Établit l'utilisateur applicatif que désigne le sujet d'un jeton TIERS —
 * la décision qui transforme « un annuaire a authentifié ce sujet » en « ce
 * compte agit chez nous ».
 *
 * UNE implémentation, deux consommateurs : la zone `external-jwt` du pare-feu
 * (`ExternalJwtAuthenticator`) et le résolveur de compte d'une ressource
 * protégée (porte MCP). Recopiée, la règle d'espace de noms aurait divergé dès
 * le premier émetteur ajouté — et c'est elle qui empêche un annuaire tiers de
 * réclamer le compte local `admin`.
 */
export class ExternalSubjectResolver {
  readonly #container: Container;
  readonly #issuers: ReadonlyMap<string, ExternalSubjectMapping>;
  readonly #policy: ExternalSubjectPolicy;
  readonly #ephemeralRoles: readonly string[];
  /** Émetteur canonique → fournisseur de connexion ; `null` = aucun lien. */
  readonly #linkedProviders: ReadonlyMap<string, string> | null;
  /** Fournisseur de connexion → table des rôles ; `null` = aucune table. */
  readonly #roleMappings: ReadonlyMap<string, IProviderRoleMapping> | null;
  #userProvider: IUserProvider | null = null;

  /**
   * @param container - container DI (résolution lazy de `users`)
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
    this.#linkedProviders = linkProviders(issuers, options.oauthProviders);
    this.#roleMappings = collectRoleMappings(options.oauthProviders);
  }

  /**
   * L'émetteur revendiqué est-il l'un des nôtres ? Ne lève JAMAIS : la valeur
   * vient d'un jeton que n'importe qui peut forger.
   *
   * @param issuer - émetteur lu dans le jeton, non vérifié
   */
  recognizes(issuer: string): boolean {
    // Cas nominal : l'émetteur est écrit exactement comme en configuration —
    // aucune allocation. La normalisation ne sert qu'aux écarts de forme (barre
    // oblique terminale), et elle est GARDÉE : `canonicalIssuer` lève sur une
    // valeur qui n'est pas une URL https. Une exception ici traverserait
    // `supports()`, que le pare-feu appelle hors de son bloc de rattrapage —
    // soit une 500 provoquée par un anonyme, avec une simple chaîne dans `iss`.
    if (this.#issuers.has(issuer)) return true;
    try {
      return this.#issuers.has(canonicalIssuer(issuer));
    } catch {
      return false;
    }
  }

  /**
   * Établit l'utilisateur applicatif à partir du sujet d'un jeton VÉRIFIÉ.
   *
   * Les deux politiques répondent à deux questions différentes : « qui, chez
   * nous, est cette personne ? » et « quel pouvoir accorde-t-on à une machine
   * que l'annuaire a authentifiée ? ».
   *
   * @param issuer - émetteur canonique, tel que le vérificateur l'a établi
   * @param subject - sujet brut (`sub`) chez cet émetteur
   * @param claims - revendications du jeton (rôles d'annuaire)
   * @param area - zone qui SURCHARGE la politique, s'il y en a une
   * @throws AuthenticationError (401) — sujet sans compte local utilisable
   * @throws UnverifiableTokenError (503) — émetteur vérifié mais absent de la
   *   table de rattachement : configuration incohérente
   */
  async resolve(
    issuer: string,
    subject: string,
    claims: Readonly<Record<string, unknown>> | undefined,
    area?: ISecuredArea,
  ): Promise<IUser> {
    // L'espace de noms du sujet. Absent de la table d'aiguillage alors que le
    // vérificateur vient d'accepter ce jeton : les deux listes viennent pourtant
    // de la MÊME configuration. On ne sait donc pas dans quel espace lire ce
    // sujet — et deviner, ici, c'est choisir entre « compte local » et « compte
    // étranger ». PANNE (503), jamais un refus : le jeton est bon, c'est
    // l'application qui est incohérente, et le silence ferait rentrer le sujet
    // par le mode le plus permissif.
    const mapping = this.#issuers.get(issuer);
    if (mapping === undefined) {
      throw new UnverifiableTokenError(
        `émetteur « ${issuer} » vérifié mais absent de la table de ` +
          `rattachement des sujets — configuration incohérente.`,
      );
    }
    // La zone qui déclare sa politique gagne sur la globale — et apporte SES
    // rôles, jamais ceux de la globale (`SecuredArea` les résout au boot).
    const policy = area?.subjectPolicy ?? this.#policy;
    if (policy === "ephemeral") {
      // En `ephemeral`, le sujet porte TOUJOURS son émetteur, quel que soit le
      // `subjectMapping` : ce réglage ne sert qu'à CHERCHER un compte local, et
      // aucun n'est cherché ici. Le laisser jouer effacerait l'émetteur — deux
      // annuaires distincts produiraient le même appelant machine : même ligne
      // d'audit, même compteur de limitation, même canal realtime privé.
      // Identité qui ne survit pas à la requête : rien n'est écrit, rien n'est
      // à nettoyer.
      const identifier = localIdentifierFor(issuer, subject, "prefixed");
      return new BaseUser({
        id: identifier,
        identifier,
        roles: [...(area?.ephemeralRoles ?? this.#ephemeralRoles)],
      });
    }
    const identifier = localIdentifierFor(issuer, subject, mapping);
    const provider = this.#resolveUserProvider();
    let user: IUser | null = null;
    // L'émetteur est celui d'un fournisseur de connexion : le compte que la
    // connexion par navigateur a créé porte le lien `(fournisseur, sub)` — la
    // MÊME paire `(iss, sub)`, puisque ce fournisseur a vérifié `iss` à la
    // connexion. Sans ce lien, le porteur aurait deux identités : son compte de
    // session, et `<iss>#<sub>` côté API.
    const linked = this.#linkedProviders?.get(issuer);
    if (linked !== undefined) {
      try {
        // Le fournisseur GÈRE des rôles : ils suivent l'annuaire à chaque
        // jeton, pas seulement à la connexion — un rôle retiré chez lui ne
        // survit pas jusqu'au prochain passage par le navigateur. L'écriture
        // n'a lieu que si l'ensemble change.
        const roleMapping = this.#roleMappings?.get(linked);
        user =
          roleMapping !== undefined && canSyncRoles(provider)
            ? await provider.syncOAuthRoles(
                linked,
                subject,
                mapProviderRoles(roleMapping, claims),
              )
            : await provider.loadUserByOAuth(linked, subject);
      } catch {
        // Aucun lien (appelant machine, compte créé autrement) : la règle
        // d'espace de noms ci-dessous s'applique.
      }
    }
    if (user === null) {
      try {
        user = await provider.loadUserByIdentifier(identifier);
      } catch {
        // Sujet sans compte local : échec d'authentification, jamais une 500.
        throw new AuthenticationError(INVALID_TOKEN);
      }
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

/** Le fournisseur d'utilisateurs sait-il recalculer les rôles gérés par un annuaire ? */
function canSyncRoles(
  provider: IUserProvider,
): provider is IUserProvider &
  Required<Pick<IOAuthUserProvisioner, "syncOAuthRoles">> {
  return (
    typeof (provider as Partial<IOAuthUserProvisioner>).syncOAuthRoles ===
    "function"
  );
}

/** Tables de rôles par fournisseur de connexion — `null` quand aucun n'en déclare. */
function collectRoleMappings(
  providers: IExternalJwtAuthenticatorOptions["oauthProviders"],
): ReadonlyMap<string, IProviderRoleMapping> | null {
  if (!providers) return null;
  let mappings: Map<string, IProviderRoleMapping> | null = null;
  for (const { name, roleMapping } of providers) {
    if (roleMapping == null) continue;
    mappings ??= new Map();
    mappings.set(name, roleMapping);
  }
  return mappings;
}

/**
 * Associe chaque émetteur de confiance au fournisseur de connexion qui partage
 * son émetteur canonique.
 *
 * Un émetteur revendiqué par DEUX fournisseurs n'est lié à aucun : choisir l'un
 * des deux ferait dépendre l'identité de l'ordre de la configuration.
 *
 * @returns la table, ou `null` quand aucun émetteur n'est lié (rien à chercher).
 */
function linkProviders(
  trusted: ReadonlyMap<string, ExternalSubjectMapping>,
  providers: readonly { name: string; issuer: string }[] | undefined,
): ReadonlyMap<string, string> | null {
  if (!providers || providers.length === 0) return null;
  const links = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const { name, issuer } of providers) {
    let canonical: string;
    try {
      canonical = canonicalIssuer(issuer);
    } catch {
      continue;
    }
    if (!trusted.has(canonical)) continue;
    if (links.has(canonical)) ambiguous.add(canonical);
    links.set(canonical, name);
  }
  for (const issuer of ambiguous) links.delete(issuer);
  return links.size > 0 ? links : null;
}
