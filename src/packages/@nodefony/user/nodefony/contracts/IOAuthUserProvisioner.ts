import type { IUser } from "./IUser";

/**
 * Profil d'identité **normalisé** extrait d'un fournisseur OAuth/OIDC.
 *
 * Forme pivot, indépendante du fournisseur : `@nodefony/security` traduit la
 * réponse propre à chaque provider (ID token OIDC de Google, API REST de
 * GitHub...) vers cette structure unique, que le provisioner consomme sans rien
 * savoir du protocole. Aucun jeton n'y figure (il ne sert qu'à l'authentification,
 * jamais persisté côté Nodefony).
 */
export interface IOAuthProfile {
  /** Fournisseur (`"google"`, `"github"`...). */
  readonly provider: string;
  /** Identifiant **stable** du compte chez le fournisseur (`sub` OIDC, `id` GitHub). */
  readonly providerId: string;
  /** Email retourné par le fournisseur, ou `null` (compte sans email exposé). */
  readonly email: string | null;
  /**
   * `true` si le fournisseur **certifie** l'email vérifié. Jamais utilisé pour
   * lier automatiquement un compte local existant (un email non vérifié =
   * vecteur d'usurpation, OWASP) — réservé à un provisioner applicatif averti.
   */
  readonly emailVerified: boolean;
  /** Nom d'affichage, ou `null`. */
  readonly name: string | null;
  /** Charge utile brute du fournisseur (claims / payload) — pour un provisioner custom. */
  readonly raw: Record<string, unknown>;
}

/**
 * Politique de provisioning décidée par l'appelant (config `oauth2` de
 * `@nodefony/security`) et transmise au provisioner — celui-ci ne lit aucune
 * config, il applique ce qu'on lui passe (un provisioner applicatif peut ignorer
 * ces valeurs et appliquer sa propre logique).
 */
export interface IOAuthProvisionPolicy {
  /** Rôles plats accordés au Shadow User **à la création uniquement**. */
  readonly defaultRoles: string[];
  /**
   * `true` : créer une ligne locale au premier login externe (JIT). `false` :
   * un compte préexistant lié est requis, sinon échec (fail-closed).
   */
  readonly allowSignup: boolean;
}

/**
 * Capability de **provisioning d'un utilisateur OAuth** — pattern *Shadow User*
 * Just-In-Time.
 *
 * Distincte d'{@link IUserProvider} (qui ne fait que **lire** : `loadUserByOAuth`
 * lève si le lien est inconnu). Le provisioning **écrit** : il crée la ligne
 * locale au premier login. Capability optionnelle (duck-typée par
 * `@nodefony/security`) : le framework fournit le point d'extension, l'application
 * branche sa politique (le défaut est `UserService.provisionOAuthUser`).
 *
 * @remarks OAuth = **authentification**, pas autorisation : les rôles sont fixés
 * à la création (`policy.defaultRoles`) puis **jamais réécrits** par un re-login —
 * la base locale reste la source de vérité des droits.
 */
export interface IOAuthUserProvisioner {
  /**
   * Retourne l'utilisateur lié au compte externe, en le **créant** si absent
   * (selon `policy.allowSignup`).
   *
   * @param profile - profil normalisé issu du fournisseur.
   * @param policy - rôles par défaut + autorisation de création (JIT).
   * @returns l'utilisateur lié (existant ou nouvellement provisionné).
   * @throws Si le lien est inconnu et que `allowSignup` est `false`.
   */
  provisionOAuthUser(
    profile: IOAuthProfile,
    policy: IOAuthProvisionPolicy,
  ): Promise<IUser>;
}
