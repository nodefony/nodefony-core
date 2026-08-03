import { AbstractCrudService } from "@nodefony/orm-core";
import type { Criteria, ServiceWiring } from "@nodefony/orm-core";
import { countFacets } from "nodefony";
import type { IPage } from "nodefony";
import { USER_FACETS, type IUserCounts } from "../src/userFilters";
import type {
  IUser,
  IPasswordAuthenticatedUser,
  ISocialProvider,
} from "../contracts/IUser";
import type { IUserListQuery } from "../contracts/IUserRepository";
import type { IPasswordBlocklist } from "../contracts/IPasswordBlocklist";
import type { IPasswordEncoder } from "../contracts/IPasswordEncoder";
import type { IPasswordVerifier } from "../contracts/IPasswordVerifier";
import type { IUserProvider } from "../contracts/IUserProvider";
import type { IUserRepository } from "../contracts/IUserRepository";
import type {
  IOAuthProfile,
  IOAuthProvisionPolicy,
  IOAuthUserProvisioner,
} from "../contracts/IOAuthUserProvisioner";
import { UserNotFoundError } from "../errors/UserNotFoundError";
import { WeakPasswordError } from "../errors/WeakPasswordError";
import { profileFromClaims } from "../src/userProfile";

/**
 * Données d'entrée de création d'un utilisateur — le mot de passe est fourni en
 * **clair** puis haché par {@link UserService.createUser} (jamais persisté tel quel).
 */
export interface ICreateUserInput {
  /** Identifiant fonctionnel (email, login...). Unique. */
  identifier: string;
  /** Mot de passe en clair, ou `null`/absent pour un compte sans credential local. */
  plainPassword?: string | null;
  /** Rôles plats initiaux. Défaut : `[]`. */
  roles?: string[];
}

/** Raison d'un échec d'authentification (émise avec `onAuthenticationFailure`). */
export type AuthFailureReason =
  | "unknown_identifier"
  | "disabled"
  | "locked"
  | "no_password"
  | "bad_credentials";

// Mot de passe en clair du hash leurre — jamais un credential réel. Sert
// uniquement à égaliser le temps de réponse (cf {@link UserService.consumeDummy}).
const DUMMY_PLAINTEXT = "nodefony.dummy.timing.guard";

/**
 * Service applicatif **utilisateur** — CRUD haché + authentification + events de cycle de vie.
 *
 * Spécialisation d'{@link AbstractCrudService} sur l'entité utilisateur : hérite du
 * CRUD générique (`find`/`findOne`/`findById`/`count`/`create`/`update`/`delete` +
 * events `onCreated`/`onUpdated`/`onDeleted`) et n'ajoute que le **spécifique
 * credential** : hachage à la création (`createUser`), changement de mot de passe
 * (`changePassword`), recherche par identifiant fonctionnel et authentification.
 *
 * Singleton DI stateless (cf {@link AbstractCrudService}) : aucun état par requête
 * (le credential est lu depuis le repository, le hash leurre est un cache immuable).
 *
 * Events propres (en plus des events CRUD hérités) : `onPasswordChanged`,
 * `onAuthenticated`, `onAuthenticationFailure` (avec {@link AuthFailureReason}).
 *
 * @typeParam — fixé : `T = IPasswordAuthenticatedUser` (le repository est la
 *   frontière credential), `R = IUserRepository` (conserve les finders métier).
 */
export class UserService
  extends AbstractCrudService<IPasswordAuthenticatedUser, IUserRepository>
  implements IUserProvider, IPasswordVerifier, IOAuthUserProvisioner
{
  protected readonly encoder: IPasswordEncoder;

  // Hash leurre calculé paresseusement au 1er échec d'authentification : zéro coût
  // tant qu'aucune tentative ne porte sur un identifiant inconnu / sans password.
  #dummyHash: string | null = null;

  /**
   * Liste de blocage des mots de passe compromis (NIST SP 800-63B §5.1.1.2) —
   * hook opt-in consulté à la création/changement (jamais au login). `null`
   * par défaut : le framework fournit le point d'extension, l'application
   * branche sa source (top-10k, fichier, API k-anonymity).
   */
  passwordBlocklist: IPasswordBlocklist | null = null;

  /**
   * @param repository - source de persistance des utilisateurs (credential inclus).
   * @param encoder - encodeur de mot de passe (hash/verify/needsRehash).
   * @param wiring - câblage Service ({@link ServiceWiring}) — quasi toujours omis.
   */
  constructor(
    repository: IUserRepository,
    encoder: IPasswordEncoder,
    ...wiring: ServiceWiring
  ) {
    super("users", repository, ...wiring);
    this.encoder = encoder;
  }

  /**
   * Crée un utilisateur — hache le mot de passe en clair s'il est fourni, puis
   * délègue au `create` générique (hooks + event `onCreated`).
   *
   * @param input - identité + mot de passe en clair optionnel + rôles.
   * @returns l'utilisateur persisté (id généré, hash stocké).
   */
  async createUser(
    input: ICreateUserInput,
  ): Promise<IPasswordAuthenticatedUser> {
    if (input.plainPassword != null) {
      await this.#assertNotBlocked(input.plainPassword);
    }
    const password =
      input.plainPassword != null
        ? await this.encoder.hash(input.plainPassword)
        : null;
    return this.create({
      identifier: input.identifier,
      roles: input.roles ?? [],
      password,
    });
  }

  /**
   * Charge un utilisateur par son identifiant fonctionnel (email, login...).
   *
   * @param identifier - identifiant unique.
   * @returns l'utilisateur, ou `null`.
   */
  findByIdentifier(
    identifier: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    return this.repository.findByIdentifier(identifier);
  }

  /**
   * Liste **paginée nativement** d'utilisateurs (filtres role/enabled/q) — délègue
   * au repository, qui ne matérialise jamais plus d'une page. À préférer
   * systématiquement à `find()` pour tout listing (data plane admin, écran).
   *
   * @param query - filtres + fenêtre de page.
   * @returns une page d'utilisateurs ({@link IPage}).
   */
  listPage(query: IUserListQuery): Promise<IPage<IPasswordAuthenticatedUser>> {
    return this.repository.listPage(query);
  }

  /**
   * Champs de tri que le repository **actuellement branché** sait honorer.
   *
   * La capacité se CONSTATE au runtime plutôt que de se déduire : un adapter
   * tiers qui ne trierait pas rend une liste vide, et le data plane refuse alors
   * tout `?order=` (400) au lieu de servir une page dans un ordre arbitraire.
   *
   * @returns les champs triables, liste vide si le repository ne trie pas.
   */
  sortableFields(): readonly string[] {
    return this.repository.sortableFields ?? [];
  }

  /**
   * Compte les administrateurs actifs porteurs de `adminRole` — garde-fou
   * anti-lockout calculé au store (jamais en chargeant tous les utilisateurs).
   *
   * @param adminRole - rôle d'administration à dénombrer.
   * @returns le nombre d'admins actifs.
   */
  countActiveAdmins(adminRole: string): Promise<number> {
    return this.repository.countActiveAdmins(adminRole);
  }

  /**
   * Les compteurs de tête de la console — posés sur l'annuaire ENTIER, pas sur
   * la page affichée.
   *
   * Les populations se **recoupent** (un compte peut être désactivé ET
   * verrouillé, un administrateur peut avoir un lien social) : chacune est
   * comptée, aucune n'est déduite d'une autre.
   *
   * `admins` est composé ici et non déclaré dans {@link USER_FACETS} : le rôle
   * d'administration est une valeur de configuration, pas une constante du
   * vocabulaire — l'inscrire dans la table figerait `ROLE_NODEFONY_ADMIN` pour
   * une plateforme qui peut le renommer.
   *
   * @param adminRole - rôle d'administration à dénombrer.
   * @param query - filtres à appliquer avant comptage (sans fenêtre).
   */
  async countUserFacets(
    adminRole: string,
    query?: Partial<IUserListQuery>,
  ): Promise<IUserCounts> {
    const repo = this.repository;
    const [facets, admins] = await Promise.all([
      countFacets(USER_FACETS, (facet) =>
        repo.countUsers({ ...query, ...facet } as IUserListQuery),
      ),
      repo.countUsers({ ...query, role: adminRole } as IUserListQuery),
    ]);
    return { ...facets, admins: admins >= 0 ? admins : null };
  }

  /**
   * Change le mot de passe d'un utilisateur — hache le clair avant persistance.
   *
   * Distinct du `update` générique : émet l'event credential `onPasswordChanged`,
   * pas `onUpdated`.
   *
   * @param id - identifiant interne ciblé.
   * @param plainPassword - nouveau mot de passe en clair.
   * @returns l'utilisateur mis à jour, ou `null`.
   */
  async changePassword(
    id: string,
    plainPassword: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    await this.#assertNotBlocked(plainPassword);
    const password = await this.encoder.hash(plainPassword);
    const updated = await this.repository.updateOne(
      { id } as Criteria<IPasswordAuthenticatedUser>,
      { password },
    );
    if (updated !== null) this.fire("onPasswordChanged", updated);
    return updated;
  }

  /**
   * Authentifie par identifiant + mot de passe.
   *
   * Vérifie l'existence, l'état du compte (actif, non verrouillé), la présence d'un
   * credential local, puis le mot de passe. Au succès, re-hache de façon transparente
   * si le coût stocké est obsolète ({@link IPasswordEncoder.needsRehash}). **Tous** les
   * chemins d'échec (identifiant inconnu, compte verrouillé/désactivé, compte sans
   * password, mauvais mot de passe) consomment exactement une opération de hachage
   * (vérification réelle ou hash leurre) pour niveler le temps de réponse : le message
   * 401 est uniforme, le timing doit l'être aussi (anti énumération de comptes, OWASP).
   *
   * @param identifier - identifiant fonctionnel saisi.
   * @param plain - mot de passe en clair saisi.
   * @returns l'utilisateur authentifié, ou `null` en cas d'échec. Émet
   *   `onAuthenticated` (succès) ou `onAuthenticationFailure` (échec + raison).
   */
  async authenticate(
    identifier: string,
    plain: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const user = await this.repository.findByIdentifier(identifier);
    if (user === null) {
      await this.consumeDummy(plain);
      return this.fail(identifier, "unknown_identifier");
    }
    // Verrouillé / désactivé : consommer le hash leurre AVANT de refuser. Sinon
    // ces chemins répondent sans payer de hachage → plus rapides qu'un mauvais
    // mot de passe (verify réel) ou qu'un identifiant inconnu (leurre) → oracle
    // de timing qui révèle l'existence d'un compte (même verrouillé). Le temps
    // de réponse doit être indistinguable de tous les autres échecs.
    if (user.isLocked()) {
      await this.consumeDummy(plain);
      return this.fail(identifier, "locked");
    }
    if (!user.isActive()) {
      await this.consumeDummy(plain);
      return this.fail(identifier, "disabled");
    }

    const hash = user.password;
    if (hash === null) {
      await this.consumeDummy(plain);
      return this.fail(identifier, "no_password");
    }

    let ok = false;
    try {
      ok = await this.encoder.verify(plain, hash);
    } catch {
      ok = false;
    }
    if (!ok) return this.fail(identifier, "bad_credentials");

    if (this.encoder.needsRehash(hash)) {
      const fresh = await this.encoder.hash(plain);
      const rehashed = await this.repository.updateOne(
        { id: user.id } as Criteria<IPasswordAuthenticatedUser>,
        { password: fresh },
      );
      this.fire("onPasswordChanged", rehashed ?? user);
    }

    this.fire("onAuthenticated", user);
    return user;
  }

  // ─── IUserProvider — la source d'identité vue par @nodefony/security ───────
  // Sémantique du contrat : JAMAIS null — l'absence d'identité lève
  // UserNotFoundError (les authenticators la convertissent en 401 générique).
  // Retour typé IUser (split credential : l'aval ne voit pas le hash).

  /**
   * {@inheritDoc IUserProvider.loadUserByIdentifier}
   */
  async loadUserByIdentifier(identifier: string): Promise<IUser> {
    const user = await this.repository.findByIdentifier(identifier);
    if (user === null) {
      throw new UserNotFoundError(`identifier "${identifier}"`);
    }
    return user;
  }

  /**
   * {@inheritDoc IUserProvider.loadUserByOAuth}
   *
   * @remarks Pas de provisionnement *Shadow User* ici : la création de la ligne
   * locale au premier login externe est portée par `provisionOAuthUser()`, que
   * `OAuth2Service.exchangeAndProvision()` (`@nodefony/security`) appelle après
   * l'échange du code — le provider, lui, ne fait que lire.
   */
  async loadUserByOAuth(provider: string, providerId: string): Promise<IUser> {
    const user = await this.repository.findBySocialProvider(
      provider,
      providerId,
    );
    if (user === null) {
      throw new UserNotFoundError(`social ${provider}:${providerId}`);
    }
    return user;
  }

  /**
   * {@inheritDoc IUserProvider.refreshUser}
   */
  async refreshUser(user: IUser): Promise<IUser> {
    const fresh = await this.findById(user.id);
    if (fresh === null) {
      throw new UserNotFoundError(`id "${user.id}" (compte supprimé)`);
    }
    return fresh;
  }

  // ─── IOAuthUserProvisioner — provisioning Shadow User OAuth (JIT) ──────────

  /**
   * {@inheritDoc IOAuthUserProvisioner.provisionOAuthUser}
   *
   * @remarks Implémentation **par défaut** (find-or-create) : lit le lien
   * existant, sinon — si `allowSignup` — crée une ligne locale 100 % OAuth
   * (`password: null`, rôles = `policy.defaultRoles`) liée au compte externe.
   * **Aucune liaison automatique** à un compte local existant par email (un email
   * non vérifié serait un vecteur d'usurpation, OWASP) : un compte externe non lié
   * donne TOUJOURS un nouvel utilisateur. Le rattachement à un compte existant se
   * fait explicitement, utilisateur connecté (hors P6).
   */
  async provisionOAuthUser(
    profile: IOAuthProfile,
    policy: IOAuthProvisionPolicy,
  ): Promise<IUser> {
    const existing = await this.repository.findBySocialProvider(
      profile.provider,
      profile.providerId,
    );
    if (existing !== null) {
      return existing;
    }
    if (!policy.allowSignup) {
      // Fail-closed : sans création autorisée, un compte préexistant lié est requis.
      throw new UserNotFoundError(
        `social ${profile.provider}:${profile.providerId} (signup disabled)`,
      );
    }
    // Identifiant fonctionnel = email du fournisseur si présent, sinon une clé
    // stable préfixée par le fournisseur (jamais de collision entre fournisseurs).
    const identifier =
      profile.email ?? `${profile.provider}:${profile.providerId}`;
    const link: ISocialProvider = {
      provider: profile.provider,
      providerId: profile.providerId,
      createdAt: new Date(),
    };
    // `socialProviders` est un champ d'ENTITÉ (BaseUser / ligne ORM), hors du
    // contrat credential `IPasswordAuthenticatedUser` : l'intersection le rend
    // connu ici SANS cast ; le repository le persiste (colonne JSON).
    // Pré-remplit le profil d'affichage depuis les claims du fournisseur
    // (nom/prénom/avatar/email/locale) — UNIQUEMENT à la CRÉATION : un login
    // ultérieur ne doit pas écraser ce que l'utilisateur a édité depuis.
    // Best-effort (un claim manquant/invalide est simplement absent du profil).
    const claims: Record<string, unknown> = { ...profile.raw };
    if (profile.name) claims.name = profile.name;
    if (profile.email) claims.email = profile.email;
    const oauthProfile = profileFromClaims(claims);
    const data: Partial<IPasswordAuthenticatedUser> & {
      socialProviders: ISocialProvider[];
      metadata?: Record<string, unknown>;
    } = {
      identifier,
      roles: [...policy.defaultRoles],
      password: null,
      socialProviders: [link],
    };
    if (Object.keys(oauthProfile).length > 0) {
      data.metadata = { profile: oauthProfile };
    }
    return this.create(data);
  }

  // Refuse un candidat connu-compromis si une blocklist est branchée (no-op sinon).
  async #assertNotBlocked(plain: string): Promise<void> {
    if (this.passwordBlocklist === null) return;
    if (await this.passwordBlocklist.isBlocked(plain)) {
      throw new WeakPasswordError();
    }
  }

  // Émet l'échec et retourne null — factorise les chemins d'erreur d'authenticate.
  private fail(identifier: string, reason: AuthFailureReason): null {
    this.fire("onAuthenticationFailure", identifier, reason);
    return null;
  }

  // Vérifie le clair contre un hash leurre (calculé une seule fois) pour égaliser
  // le temps de réponse des échecs sans credential réel. Erreurs ignorées.
  private async consumeDummy(plain: string): Promise<void> {
    if (this.#dummyHash === null) {
      this.#dummyHash = await this.encoder.hash(DUMMY_PLAINTEXT);
    }
    try {
      await this.encoder.verify(plain, this.#dummyHash);
    } catch {
      /* leurre — résultat ignoré */
    }
  }
}
