import { AbstractCrudService } from "@nodefony/orm-core";
import type { Criteria, ServiceWiring } from "@nodefony/orm-core";
import { countFacets } from "nodefony";
import type { IPage, PartialInput } from "nodefony";
import { USER_FACETS, type IUserCounts } from "../src/userFilters";
import type {
  IUser,
  IPasswordAuthenticatedUser,
  ISocialProvider,
} from "../contracts/IUser";
import type { IUserListQuery } from "../contracts/IUserRepository";
import type { IPasswordBlocklist } from "../contracts/IPasswordBlocklist";
import { PasswordPolicy } from "../src/password/passwordPolicy";
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
import { IdentifierTakenError } from "../errors/IdentifierTakenError";
import { IdentifierImmutableError } from "../errors/IdentifierImmutableError";
import { WeakPasswordError } from "../errors/WeakPasswordError";
import { profileFromClaims } from "../src/userProfile";
import {
  readProviderRoles,
  reconcileProviderRoles,
  writeProviderRoles,
} from "../src/providerRoles";

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
 * **Seul émetteur du cycle de vie d'un compte** : {@link USER_CREATED_EVENT} et
 * {@link USER_REVOKED_EVENT} partent d'ICI, sur le bus du KERNEL, et sont
 * attendus. Aucun transport (plan d'administration, CLI, contrôleur) ne les
 * émet : un geste qui passe par le service déclenche la cascade, quel que soit
 * le chemin qui l'a porté — c'est ce qui manquait aux deux portes HTTP de
 * changement de mot de passe.
 *
 * Construit sans container (`new UserService(repo, encoder)`), il n'atteint pas
 * le kernel et émet sur son propre bus : personne n'y écoute. Une application
 * passe donc son container en troisième argument ; `@nodefony/security` le
 * signale au bilan de démarrage sinon.
 *
 * @typeParam — fixé : `T = IPasswordAuthenticatedUser` (le repository est la
 *   frontière credential), `R = IUserRepository` (conserve les finders métier).
 */
/**
 * Événement kernel — un compte vient d'être créé (charge utile
 * {@link IUserCreatedEvent}). Émis par {@link UserService.create} et
 * **attendu** : `@nodefony/security` y retire les facteurs (TOTP, passkeys)
 * laissés sous le même identifiant par un ancien titulaire, et une connexion
 * immédiate ne doit pas les trouver encore là.
 */
export const USER_CREATED_EVENT = "onUserCreated";

/** Charge utile de {@link USER_CREATED_EVENT}. */
export interface IUserCreatedEvent {
  /** `IUser.id` du compte créé. */
  readonly id: string;
  /** `IUser.identifier` — clé sous laquelle ses facteurs seront rangés. */
  readonly identifier: string;
}

/**
 * Événement kernel — l'accès d'un compte doit être révoqué partout
 * (suppression, désactivation, verrouillage, changement de mot de passe).
 * **Point d'extension** : un module qui possède des artefacts liés à un compte
 * (sessions, jetons, webhooks…) s'y abonne et nettoie LES SIENS — zéro couplage
 * avec `@nodefony/user`. Émis par {@link UserService} seul, et attendu.
 */
export const USER_REVOKED_EVENT = "onUserRevoked";

/**
 * Charge utile de {@link USER_REVOKED_EVENT}. `identifier` = clé de jointure des
 * artefacts (session `user`, PAT `subjectId`). `tenantId` = slot multi-tenant
 * (toujours `null` en mono-tenant — réserve coût-0 pour une cascade scopée).
 */
export interface IUserRevokedEvent {
  id: string;
  identifier: string;
  tenantId: string | null;
  /**
   * Ce qui a coupé l'accès du porteur.
   *
   * `password_changed` n'est pas une révocation de COMPTE — le compte reste
   * actif — mais c'en est une de ses ACCÈS EN COURS : on change un mot de passe
   * parce qu'il est perdu ou compromis, et laisser vivre les sessions ouvertes
   * laisserait l'accès à qui l'a volé. La cascade est la même, et c'est le
   * but : un seul canal, les abonnés futurs (webhooks) n'ont rien à savoir de
   * la cause.
   */
  reason: "deleted" | "disabled" | "locked" | "password_changed";
}

/**
 * Ce qui, dans une mise à jour, coupe les accès en cours du compte — ou `null`.
 * `enabled`/`locked` sont des champs de PERSISTANCE, absents du contrat `IUser`
 * (qui n'expose que `isActive()`/`isLocked()`) : lus par `in`.
 */
function revocationReason(
  data: PartialInput<IPasswordAuthenticatedUser>,
): IUserRevokedEvent["reason"] | null {
  if ("enabled" in data && data.enabled === false) return "disabled";
  if ("locked" in data && data.locked === true) return "locked";
  if (data.password !== undefined) return "password_changed";
  return null;
}

export class UserService
  extends AbstractCrudService<IPasswordAuthenticatedUser, IUserRepository>
  implements IUserProvider, IPasswordVerifier, IOAuthUserProvisioner
{
  protected readonly encoder: IPasswordEncoder;

  // Hash leurre calculé paresseusement au 1er échec d'authentification : zéro coût
  // tant qu'aucune tentative ne porte sur un identifiant inconnu / sans password.
  #dummyHash: string | null = null;

  /**
   * Politique de mot de passe (NIST SP 800-63B §5.1.1.2) — consultée à la
   * création et au changement, jamais au login.
   *
   * **Posée PAR DÉFAUT**, et c'est le point : un défaut `null` ne se voit pas,
   * et personne ne l'écrasait — `security:user:add compta --password abc`
   * réussissait. L'application REMPLACE cet objet pour durcir ou pour brancher
   * sa propre source ; la mettre à `null` désactive tout contrôle, et c'est
   * alors un geste explicite, pas un oubli.
   */
  passwordBlocklist: IPasswordBlocklist | null = new PasswordPolicy();

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
   * Crée un compte (CRUD hérité), puis émet {@link USER_CREATED_EVENT} et en
   * ATTEND les abonnés. Toutes les créations y passent — `createUser`,
   * `provisionOAuthUser` comme un `create` direct.
   *
   * @param data - champs du compte à créer.
   * @returns le compte persisté.
   */
  override async create(
    data: PartialInput<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser> {
    const user = await super.create(data);
    const event: IUserCreatedEvent = {
      id: user.id,
      identifier: user.identifier,
    };
    await this.#emit(USER_CREATED_EVENT, event);
    return user;
  }

  /**
   * Met à jour un compte (CRUD hérité). Un geste qui coupe ses accès émet
   * {@link USER_REVOKED_EVENT} et en attend la cascade — ses sessions et ses
   * jetons tombent avant le retour : désactivation (`enabled: false`),
   * verrouillage (`locked: true`), ou hash de mot de passe écrit directement
   * (`password`, que `changePassword` préfère : lui applique la politique).
   *
   * @param criteria - cible de la mise à jour.
   * @param data - champs à modifier.
   * @returns le compte mis à jour, ou `null` si aucun ne correspond.
   */
  override async updateOne(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: PartialInput<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const updated = await super.updateOne(criteria, data);
    if (updated === null) return null;
    const reason = revocationReason(data);
    if (reason !== null) await this.#revoke(updated, reason);
    return updated;
  }

  /**
   * Refuse de RENOMMER un compte : sessions, jetons et facteurs sont rangés
   * sous `identifier`, le changer les orphelinerait. Réécrire la même valeur
   * (un formulaire qui renvoie tout) passe. Une lecture de plus, seulement
   * quand la mise à jour porte `identifier`.
   *
   * @throws {IdentifierImmutableError} si l'identifiant visé diffère.
   */
  protected override async beforeUpdate(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: PartialInput<IPasswordAuthenticatedUser>,
  ): Promise<PartialInput<IPasswordAuthenticatedUser>> {
    if (data.identifier === undefined) return data;
    const current = await this.findOne(criteria);
    if (current !== null && current.identifier !== data.identifier) {
      throw new IdentifierImmutableError(current.identifier);
    }
    return data;
  }

  /**
   * Supprime des comptes (CRUD hérité), un par un, et émet
   * {@link USER_REVOKED_EVENT} (`deleted`) pour CHAQUE compte effectivement
   * supprimé, en attendant la cascade : sessions, jetons et facteurs (TOTP,
   * passkeys) sont retirés avant le retour.
   *
   * Les comptes visés sont lus AVANT (après, rien ne dit qui révoquer), puis
   * supprimés PAR `id` : un compte qui cesse de correspondre entre la lecture
   * et la suppression n'est ni supprimé ni révoqué — révoquer un compte vivant
   * lui retirerait ses facteurs —, et un compte qui se met à correspondre
   * n'est pas supprimé sans révocation. Opération rare : le surcoût d'une
   * lecture et de N écritures est assumé.
   *
   * @param criteria - filtre de sélection.
   * @returns le nombre de comptes supprimés.
   */
  override async delete(
    criteria: Criteria<IPasswordAuthenticatedUser>,
  ): Promise<number> {
    const targets = await this.find(criteria);
    let removed = 0;
    for (const target of targets) {
      if ((await super.delete({ id: target.id })) === 0) continue;
      removed += 1;
      await this.#revoke(target, "deleted");
    }
    return removed;
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
      await this.#assertNotBlocked(input.plainPassword, input.identifier);
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
   * pas `onUpdated` — puis {@link USER_REVOKED_EVENT} (`password_changed`),
   * attendu : toutes les sessions et tous les jetons du compte tombent, y
   * compris la session de qui a fait le changement (le service ne connaît pas
   * le transport ; ASVS 5.0 §7.4.3 en exige au moins les autres).
   *
   * @param id - identifiant interne ciblé.
   * @param plainPassword - nouveau mot de passe en clair.
   * @returns l'utilisateur mis à jour, ou `null`.
   */
  async changePassword(
    id: string,
    plainPassword: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    // On charge AVANT de juger : la politique doit pouvoir refuser un mot de
    // passe qui répète l'identifiant, comme elle le fait à la création — sinon
    // les deux portes d'écriture n'appliquent pas la même loi. Effet de bord
    // heureux : un id inconnu ne paie plus un hachage pour rien.
    const target = await this.findById(id);
    if (target === null) return null;
    await this.#assertNotBlocked(plainPassword, target.identifier);
    const password = await this.encoder.hash(plainPassword);
    const updated = await this.repository.updateOne({ id }, { password });
    if (updated !== null) {
      this.fire("onPasswordChanged", updated);
      await this.#revoke(updated, "password_changed");
    }
    return updated;
  }

  /** Émet {@link USER_REVOKED_EVENT} pour un compte et en attend la cascade. */
  #revoke(
    user: { id: string; identifier: string },
    reason: IUserRevokedEvent["reason"],
  ): Promise<void> {
    const event: IUserRevokedEvent = {
      id: user.id,
      identifier: user.identifier,
      tenantId: null,
      reason,
    };
    return this.#emit(USER_REVOKED_EVENT, event);
  }

  /**
   * Émet un événement de cycle de vie sur le bus du KERNEL — celui où les
   * modules s'abonnent — et en attend les abonnés. Sans kernel (service
   * construit sans container), sur son propre bus.
   *
   * Émission GARDÉE : l'écriture en base a déjà eu lieu, un abonné qui lève ne
   * doit ni sauter les suivants (un tiers enregistré avant `@nodefony/security`
   * laisserait sinon vivre les sessions), ni faire échouer un geste accompli.
   * L'échec est journalisé, la chaîne continue.
   */
  async #emit(event: string, payload: object): Promise<void> {
    await (this.kernel ?? this).emitAsyncGuarded(
      event,
      {
        onListenerError: (error) => {
          this.log(
            `un abonné de ${event} a échoué — les suivants ont été appelés : ` +
              (error instanceof Error ? error.message : String(error)),
            "ERROR",
          );
        },
      },
      payload,
    );
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
        { id: user.id },
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
      return policy.providerRoles === undefined
        ? existing
        : this.#applyProviderRoles(
            existing,
            profile.provider,
            policy.providerRoles,
          );
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
    // Identifiant déjà porté par un compte local SANS ce lien : refus explicite.
    // Lier par email serait l'usurpation que ce provisioning exclut ; créer un
    // second compte sous le même identifiant serait pire — la session recharge
    // par identifiant et désignerait l'autre. Cas légitime typique : le `sub`
    // a changé chez le fournisseur (compte recréé, realm réimporté) — le
    // rattachement se fait alors explicitement, jamais en silence.
    if ((await this.repository.findByIdentifier(identifier)) !== null) {
      throw new IdentifierTakenError(
        `local account exists without a ${profile.provider} link (no automatic linking)`,
      );
    }
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
    // Création : les rôles du fournisseur s'AJOUTENT aux rôles par défaut, et
    // la trace (`metadata`) dit lesquels il gère — sans elle, le prochain
    // calcul ne saurait pas quoi retirer.
    const roles =
      policy.providerRoles === undefined
        ? [...policy.defaultRoles]
        : reconcileProviderRoles(policy.defaultRoles, [], policy.providerRoles)
            .roles;
    const data: Partial<IPasswordAuthenticatedUser> & {
      socialProviders: ISocialProvider[];
      metadata?: Record<string, unknown>;
    } = {
      identifier,
      roles,
      password: null,
      socialProviders: [link],
    };
    if (Object.keys(oauthProfile).length > 0) {
      data.metadata = { profile: oauthProfile };
    }
    if (policy.providerRoles !== undefined) {
      data.metadata = writeProviderRoles(
        data.metadata,
        profile.provider,
        policy.providerRoles,
      );
    }
    return this.create(data);
  }

  /**
   * {@inheritDoc IOAuthUserProvisioner.syncOAuthRoles}
   */
  async syncOAuthRoles(
    provider: string,
    providerId: string,
    roles: readonly string[],
  ): Promise<IUser> {
    const user = await this.repository.findBySocialProvider(
      provider,
      providerId,
    );
    if (user === null) {
      throw new UserNotFoundError(`social ${provider}:${providerId}`);
    }
    return this.#applyProviderRoles(user, provider, roles);
  }

  /**
   * Applique au compte les rôles que `provider` gère désormais — écrit
   * seulement si l'ensemble effectif ou la trace change.
   */
  async #applyProviderRoles(
    user: IPasswordAuthenticatedUser,
    provider: string,
    next: readonly string[],
  ): Promise<IPasswordAuthenticatedUser> {
    // `metadata` est un champ d'ENTITÉ, hors du contrat credential : lu
    // défensivement, il peut manquer sur un dépôt applicatif.
    const metadata: unknown = (user as { metadata?: unknown }).metadata;
    const { roles, changed } = reconcileProviderRoles(
      user.roles,
      readProviderRoles(metadata, provider),
      next,
    );
    if (!changed) return user;
    const update: Partial<IPasswordAuthenticatedUser> & {
      metadata: Record<string, unknown>;
    } = { roles, metadata: writeProviderRoles(metadata, provider, next) };
    const updated = await this.updateOne({ id: user.id }, update);
    return updated ?? user;
  }

  /**
   * Refuse un candidat que la politique écarte — et NOMME la règle enfreinte
   * quand la politique sait la dire (`violation`, membre optionnel du contrat).
   *
   * `null` = aucune politique branchée : l'application l'a retiré sciemment.
   *
   * @param plain - mot de passe candidat.
   * @param identifier - identifiant du compte visé, quand l'appelant le connaît :
   *   sans lui, la règle « le mot de passe répète l'identifiant » ne peut pas
   *   mordre, et les deux portes d'écriture n'appliqueraient pas la même loi.
   */
  async #assertNotBlocked(plain: string, identifier?: string): Promise<void> {
    const policy = this.passwordBlocklist;
    if (policy === null) return;
    const subject = identifier != null ? { identifier } : undefined;
    if (policy.violation !== undefined) {
      const violation = await policy.violation(plain, subject);
      if (violation !== null) throw new WeakPasswordError(violation);
      return;
    }
    if (await policy.isBlocked(plain, subject)) {
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
    this.#dummyHash ??= await this.encoder.hash(DUMMY_PLAINTEXT);
    try {
      await this.encoder.verify(plain, this.#dummyHash);
    } catch {
      /* leurre — résultat ignoré */
    }
  }
}
