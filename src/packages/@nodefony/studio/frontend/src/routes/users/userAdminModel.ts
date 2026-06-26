/**
 * Modèle de la page profil **ADMIN** d'un utilisateur (`/nodefony/users/:id`,
 * P6.15) — endpoints + types MIROIR des data planes `@nodefony/user`
 * (`/nodefony/user/api/users/*`) et `@nodefony/security`
 * (`/nodefony/security/api/users/{id}/{passkeys,totp}`). Types locaux : JAMAIS
 * d'import runtime serveur côté front (frontière isomorphe).
 *
 * Périmètre admin sur les **facteurs forts** = RESET only (lire le statut +
 * désactiver/révoquer). Pas d'enrôlement cross-user : impossible (le secret TOTP
 * se scanne sur l'appareil du user, la passkey exige son authenticator).
 */

// ── Endpoints identité (@nodefony/user) ─────────────────────────────────────
/** Détail d'un user (GET) / modification roles·enabled·locked·profile (PATCH). */
export const userEndpoint = (id: string): string =>
  `/nodefony/user/api/users/${encodeURIComponent(id)}`;
/** Reset FORCÉ du mot de passe d'un user (POST { plainPassword }). */
export const userPasswordEndpoint = (id: string): string =>
  `${userEndpoint(id)}/password`;

// ── Endpoints facteurs forts (@nodefony/security) ───────────────────────────
/** Passkeys d'un user (GET → { credentials }). */
export const userPasskeysEndpoint = (id: string): string =>
  `/nodefony/security/api/users/${encodeURIComponent(id)}/passkeys`;
/** Révocation d'une passkey d'un user (DELETE). */
export const userPasskeyEndpoint = (id: string, credentialId: string): string =>
  `${userPasskeysEndpoint(id)}/${encodeURIComponent(credentialId)}`;
/** État 2FA TOTP d'un user (GET). */
export const userTotpEndpoint = (id: string): string =>
  `/nodefony/security/api/users/${encodeURIComponent(id)}/totp`;
/** Désactivation du 2FA TOTP d'un user (POST). */
export const userTotpDisableEndpoint = (id: string): string =>
  `${userTotpEndpoint(id)}/disable`;

/** Rôle plateforme requis pour gérer un autre compte. */
export const ADMIN_ROLE = "ROLE_NODEFONY_ADMIN";
/** Version de la doc contextuelle de la page. */
export const USER_ADMIN_DOC = "v1.0";

/** Profil d'affichage (claims OIDC) — miroir de `IUserProfile`. */
export interface UserProfileData {
  givenName?: string;
  familyName?: string;
  displayName?: string;
  email?: string;
  locale?: string;
  /** URL http(s), data URL d'avatar, ou absent. */
  picture?: string;
}

/** DTO admin d'un utilisateur — miroir de `IUserSummary` (jamais le hash). */
export interface AdminUserDetail {
  id: string;
  identifier: string;
  roles: string[];
  enabled: boolean;
  locked: boolean;
  hasPassword: boolean;
  currentRole: string | null;
  socialProviders: {
    provider: string;
    providerId: string;
    createdAt: number | null;
  }[];
  profile: UserProfileData;
  createdAt: number | null;
  updatedAt: number | null;
  tenantId: string | null;
}

/** Vue admin d'une passkey — miroir de `IAdminCredentialView` (sans clé publique). */
export interface AdminCredentialView {
  id: string;
  nickname: string | null;
  transports: string[];
  backupEligible: boolean;
  backupState: boolean;
  uvInitialized: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

/** État 2FA TOTP — miroir de `ITotpStatus`. */
export interface AdminTotpStatus {
  enabled: boolean;
  pending: boolean;
  recoveryCodesRemaining: number;
}

/** Champs profil modifiables (mode admin → PATCH, mode self → POST me/profile). */
export const PROFILE_FIELD_DEFS: {
  key: keyof UserProfileData;
  label: string;
  placeholder?: string;
}[] = [
  { key: "givenName", label: "Prénom" },
  { key: "familyName", label: "Nom" },
  {
    key: "displayName",
    label: "Nom affiché",
    placeholder: "défaut : Prénom Nom",
  },
  { key: "email", label: "E-mail de contact", placeholder: "nom@exemple.fr" },
  { key: "locale", label: "Langue", placeholder: "fr-FR" },
];

/** Traduit une erreur du data plane (admin ou facteurs forts) en message FR. */
export function describeUserAdminError(e: unknown): string {
  const status =
    (e as { status?: number; code?: number }).status ??
    (e as { code?: number }).code;
  switch (status) {
    case 400:
      return "Données invalides. Vérifiez les champs.";
    case 401:
      return "Session expirée — reconnectez-vous.";
    case 403:
      return "Action réservée à un administrateur.";
    case 404:
      return "Utilisateur introuvable.";
    case 409:
      return "Action bloquée (garde-fou anti-verrouillage du dernier administrateur).";
    case 503:
      return "Service indisponible sur ce serveur.";
    default:
      return e instanceof Error ? e.message : "Erreur inattendue.";
  }
}
