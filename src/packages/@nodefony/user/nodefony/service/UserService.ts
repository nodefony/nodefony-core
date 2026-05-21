import { Service } from "nodefony";
import type { Container, Event, DefaultOptionsService } from "nodefony";
import type { Criteria } from "@nodefony/orm-core";
import type { IPasswordAuthenticatedUser } from "../contracts/IUser";
import type { IPasswordEncoder } from "../contracts/IPasswordEncoder";
import type { IUserRepository } from "../contracts/IUserRepository";

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

/**
 * Champs modifiables via {@link UserService.updateUser} — `id` et `password` exclus.
 *
 * Le credential ne se change que par {@link UserService.changePassword} (qui hache) ;
 * l'identité (`id`) est immuable. Empêche d'écrire par mégarde un mot de passe en
 * clair dans la colonne `password`.
 */
export type UserUpdate = Omit<
  Partial<IPasswordAuthenticatedUser>,
  "id" | "password"
>;

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
 * Singleton DI (étend {@link Service} : container, Syslog, bus d'événements),
 * instancié une fois au boot — hors hot path requête. Il est le **seul** point qui
 * combine le {@link IUserRepository} (persistance, credential visible) et un
 * {@link IPasswordEncoder} : il hache à la création / au changement de mot de passe
 * et vérifie à l'authentification. Les consommateurs en aval (firewall, controllers)
 * reçoivent des `IUser` purs via `IUserProvider`, jamais le hash.
 *
 * Events émis (via `fire`, consommables par `@nodefony/security` / Studio) :
 * `onUserCreated`, `onUserUpdated`, `onUserDeleted`, `onUserPasswordChanged`,
 * `onUserAuthenticated`, `onAuthenticationFailure`.
 */
export class UserService extends Service {
  protected readonly repository: IUserRepository;
  protected readonly encoder: IPasswordEncoder;

  // Hash leurre calculé paresseusement au 1er échec d'authentification : zéro coût
  // tant qu'aucune tentative ne porte sur un identifiant inconnu / sans password.
  #dummyHash: string | null = null;

  /**
   * @param repository - source de persistance des utilisateurs (credential inclus).
   * @param encoder - encodeur de mot de passe (hash/verify/needsRehash).
   * @param container - container DI hérité (Kernel) ou nouveau si omis.
   * @param notificationsCenter - bus d'événements partagé, `false` pour aucun.
   * @param options - options de service.
   */
  constructor(
    repository: IUserRepository,
    encoder: IPasswordEncoder,
    container?: Container,
    notificationsCenter?: Event | false | null,
    options?: DefaultOptionsService,
  ) {
    super("users", container, notificationsCenter, options);
    this.repository = repository;
    this.encoder = encoder;
  }

  /**
   * Crée un utilisateur — hache le mot de passe en clair s'il est fourni.
   *
   * @param input - identité + mot de passe en clair optionnel + rôles.
   * @returns l'utilisateur persisté (id généré, hash stocké). Émet `onUserCreated`.
   */
  async createUser(
    input: ICreateUserInput,
  ): Promise<IPasswordAuthenticatedUser> {
    const password =
      input.plainPassword != null
        ? await this.encoder.hash(input.plainPassword)
        : null;
    const created = await this.repository.create({
      identifier: input.identifier,
      roles: input.roles ?? [],
      password,
    });
    this.fire("onUserCreated", created);
    return created;
  }

  /**
   * Charge un utilisateur par son identifiant interne (UUID).
   *
   * @param id - identifiant interne.
   * @returns l'utilisateur, ou `null`.
   */
  findById(id: string): Promise<IPasswordAuthenticatedUser | null> {
    return this.repository.findOne({ id });
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
   * Met à jour des champs non sensibles d'un utilisateur (jamais `id` ni `password`).
   *
   * @param id - identifiant interne ciblé.
   * @param changes - champs à modifier ({@link UserUpdate}).
   * @returns l'utilisateur mis à jour, ou `null` s'il n'existe pas. Émet `onUserUpdated`.
   */
  async updateUser(
    id: string,
    changes: UserUpdate,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const updated = await this.repository.update(
      { id } as Criteria<IPasswordAuthenticatedUser>,
      changes,
    );
    if (updated !== null) this.fire("onUserUpdated", updated);
    return updated;
  }

  /**
   * Change le mot de passe d'un utilisateur — hache le clair avant persistance.
   *
   * @param id - identifiant interne ciblé.
   * @param plainPassword - nouveau mot de passe en clair.
   * @returns l'utilisateur mis à jour, ou `null`. Émet `onUserPasswordChanged`.
   */
  async changePassword(
    id: string,
    plainPassword: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const password = await this.encoder.hash(plainPassword);
    const updated = await this.repository.update(
      { id } as Criteria<IPasswordAuthenticatedUser>,
      { password },
    );
    if (updated !== null) this.fire("onUserPasswordChanged", updated);
    return updated;
  }

  /**
   * Supprime un utilisateur par son identifiant interne.
   *
   * @param id - identifiant interne ciblé.
   * @returns `true` si une ligne a été supprimée. Émet `onUserDeleted` (avec l'id).
   */
  async deleteUser(id: string): Promise<boolean> {
    const removed = await this.repository.delete({
      id,
    } as Criteria<IPasswordAuthenticatedUser>);
    const deleted = removed > 0;
    if (deleted) this.fire("onUserDeleted", id);
    return deleted;
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
   *   `onUserAuthenticated` (succès) ou `onAuthenticationFailure` (échec + raison).
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
      const rehashed = await this.repository.update(
        { id: user.id } as Criteria<IPasswordAuthenticatedUser>,
        { password: fresh },
      );
      this.fire("onUserPasswordChanged", rehashed ?? user);
    }

    this.fire("onUserAuthenticated", user);
    return user;
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
