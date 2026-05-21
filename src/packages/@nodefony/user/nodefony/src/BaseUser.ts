import type {
  IPasswordAuthenticatedUser,
  ISocialProvider,
} from "../contracts/IUser";

/**
 * Options de construction d'un {@link BaseUser} — signature en objet (lisibilité + extensibilité).
 */
export interface IBaseUserOptions {
  /** Identifiant interne (UUID). */
  id: string;
  /** Identifiant fonctionnel (email, login...). */
  identifier: string;
  /** Rôles plats accordés (copiés défensivement). Défaut : `[]`. */
  roles?: string[];
  /** Hash du mot de passe local, ou `null` (compte OAuth-only). Défaut : `null`. */
  password?: string | null;
  /** Compte activé. Défaut : `true`. */
  enabled?: boolean;
  /** Compte verrouillé. Défaut : `false`. */
  locked?: boolean;
  /** Profil de rôle actif en session. Défaut : `null`. */
  currentRole?: string | null;
  /** Comptes externes liés (OAuth/OIDC). Défaut : `[]`. */
  socialProviders?: ISocialProvider[];
  /** Métadonnées applicatives libres. Défaut : `{}`. */
  metadata?: Record<string, unknown>;
}

/**
 * Implémentation POJO de référence d'un utilisateur — base partagée par tous les ORM.
 *
 * Porte le contrat {@link IPasswordAuthenticatedUser} plus les **champs
 * anti-migration** : `socialProviders` (JSON, pas de colonnes par fournisseur),
 * `metadata` (extras libres typés `Record<string, unknown>`, jamais `any`),
 * `currentRole` (profil actif de session). Les entités persistées des adapters
 * (`SequelizeUser`, `MongooseUser`...) étendent cette classe ; Drizzle la mappe.
 *
 * Hors hot path requête (instanciée à l'authentification, pas par requête) : les
 * allocations de `roles`/`socialProviders`/`metadata` y sont acceptables. Pour un
 * utilisateur anonyme (créé par requête non authentifiée), préférer
 * {@link AnonymousUser} et son singleton.
 */
export class BaseUser implements IPasswordAuthenticatedUser {
  readonly id: string;
  readonly identifier: string;
  roles: string[];
  password: string | null;
  /** Profil de rôle actif en session (P5.11) — distinct des rôles plats. */
  currentRole: string | null;
  socialProviders: ISocialProvider[];
  metadata: Record<string, unknown>;

  protected enabled: boolean;
  protected locked: boolean;

  constructor(options: IBaseUserOptions) {
    this.id = options.id;
    this.identifier = options.identifier;
    this.roles = options.roles ? [...options.roles] : [];
    this.password = options.password ?? null;
    this.enabled = options.enabled ?? true;
    this.locked = options.locked ?? false;
    this.currentRole = options.currentRole ?? null;
    this.socialProviders = options.socialProviders
      ? [...options.socialProviders]
      : [];
    this.metadata = options.metadata ?? {};
  }

  hasRole(role: string): boolean {
    return this.roles.includes(role);
  }

  isActive(): boolean {
    return this.enabled;
  }

  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Ajoute un rôle s'il n'est pas déjà présent (idempotent).
   *
   * @param role - rôle à accorder.
   * @returns `this` (chaînable).
   */
  addRole(role: string): this {
    if (!this.roles.includes(role)) this.roles.push(role);
    return this;
  }

  /**
   * Retire un rôle s'il est présent (idempotent).
   *
   * @param role - rôle à révoquer.
   * @returns `this` (chaînable).
   */
  removeRole(role: string): this {
    const i = this.roles.indexOf(role);
    if (i !== -1) this.roles.splice(i, 1);
    return this;
  }

  /**
   * Lie un compte externe (OAuth/OIDC) — pattern Shadow User. Idempotent sur la
   * paire `(provider, providerId)`.
   *
   * @param link - référence du compte externe.
   * @returns `this` (chaînable).
   */
  addSocialProvider(link: ISocialProvider): this {
    const exists = this.socialProviders.some(
      (p) => p.provider === link.provider && p.providerId === link.providerId,
    );
    if (!exists) this.socialProviders.push(link);
    return this;
  }

  /** Active le compte. @returns `this`. */
  enable(): this {
    this.enabled = true;
    return this;
  }

  /** Désactive le compte. @returns `this`. */
  disable(): this {
    this.enabled = false;
    return this;
  }

  /** Verrouille le compte. @returns `this`. */
  lock(): this {
    this.locked = true;
    return this;
  }

  /** Déverrouille le compte. @returns `this`. */
  unlock(): this {
    this.locked = false;
    return this;
  }

  /**
   * Définit le profil de rôle actif (session). N'altère pas {@link roles}.
   *
   * @param role - rôle actif, ou `null` pour réinitialiser.
   * @returns `this`.
   */
  setCurrentRole(role: string | null): this {
    this.currentRole = role;
    return this;
  }

  /**
   * Remplace le hash de mot de passe stocké.
   *
   * @param hash - nouveau hash (déjà produit par un {@link IPasswordEncoder}), ou `null`.
   * @returns `this`.
   */
  setPassword(hash: string | null): this {
    this.password = hash;
    return this;
  }
}
