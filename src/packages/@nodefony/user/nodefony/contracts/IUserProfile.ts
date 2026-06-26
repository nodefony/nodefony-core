/**
 * Profil **public** d'un utilisateur — sous-ensemble des *standard claims* OpenID
 * Connect (OIDC §5.1) en camelCase (convention Nodefony). Stocké dans
 * `BaseUser.metadata.profile`, PAS dans des colonnes dédiées : `IUser` reste
 * identité + rôles (le profil = donnée d'affichage anti-migration). Exposé par
 * **allowlist** dans le DTO admin (`IUserSummary.profile`) — les autres clés de
 * `metadata` (applicatives, potentiellement sensibles) ne fuitent jamais.
 *
 * Générique par construction : ces claims sont fournis par tout fournisseur OAuth
 * (le provisioning JIT pourra les pré-remplir). Les champs MÉTIER (société,
 * service…) restent libres dans `metadata`, hors de cette allowlist typée.
 *
 * Tous les champs sont optionnels (un compte fraîchement créé n'a pas de profil).
 */
export interface IUserProfile {
  /** Prénom — OIDC `given_name`. */
  givenName?: string;
  /** Nom de famille — OIDC `family_name`. */
  familyName?: string;
  /** Nom affiché — OIDC `name` (sinon dérivable « givenName familyName »). */
  displayName?: string;
  /** Adresse e-mail de contact — OIDC `email` (distincte de l'`identifier`). */
  email?: string;
  /** Préférence de langue — OIDC `locale` (BCP 47, ex. `fr-FR`). */
  locale?: string;
  /** URL d'avatar — OIDC `picture` (http/https). */
  picture?: string;
}

export default IUserProfile;
