import { AbstractCrudService } from "@nodefony/orm-core";
import type { Criteria, ServiceWiring } from "@nodefony/orm-core";
import type { IUser, IPasswordAuthenticatedUser } from "../contracts/IUser";
import type { IPasswordBlocklist } from "../contracts/IPasswordBlocklist";
import type { IPasswordEncoder } from "../contracts/IPasswordEncoder";
import type { IPasswordVerifier } from "../contracts/IPasswordVerifier";
import type { IUserProvider } from "../contracts/IUserProvider";
import type { IUserRepository } from "../contracts/IUserRepository";
import { UserNotFoundError } from "../errors/UserNotFoundError";
import { WeakPasswordError } from "../errors/WeakPasswordError";

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
  implements IUserProvider, IPasswordVerifier
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
   * si le coût stocké est obsolète ({@link IPasswordEncoder.needsRehash}). Les chemins
   * d'échec (identifiant inconnu, compte sans password) consomment un hash leurre pour
   * niveler le temps de réponse (anti énumération par timing).
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
    if (user.isLocked()) return this.fail(identifier, "locked");
    if (!user.isActive()) return this.fail(identifier, "disabled");

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
   * locale au premier login externe sera portée par l'`OAuth2Authenticator`
   * (post-P6), qui décide selon sa config — le provider, lui, ne fait que lire.
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
