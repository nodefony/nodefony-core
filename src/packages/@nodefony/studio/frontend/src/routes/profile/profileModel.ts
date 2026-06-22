/**
 * Modèle de la page **Profil** (self-service du compte courant, P6.15) — **types
 * miroir** du contrat back `@nodefony/user` (frontière isomorphe : on recopie la
 * shape JSON redactée, jamais d'import runtime serveur) + endpoints self-service,
 * validation du changement de mot de passe, mapping d'erreur et formatage.
 *
 * Data plane (namespace « user », broker admin) :
 *  - `GET  /nodefony/user/api/me`          → MON profil (DTO redacté) ;
 *  - `POST /nodefony/user/api/me/password` → changer MON mot de passe (re-auth).
 *
 * Les deux sont `public: true` côté broker (aucun RÔLE requis) MAIS sous la zone
 * firewall `nodefony-admin` → anonyme 401. Le périmètre est fermé CÔTÉ SERVEUR
 * par l'identité ALS (anti-IDOR) : aucun id/identifier n'est transmis, le serveur
 * agit toujours sur l'appelant.
 *
 * Source de vérité serveur : `user/nodefony/src/admin/UserAdminApi.ts`
 * (`IUserSummary`, handlers `me` / `me/password`).
 */

/** Lien vers un compte externe (OAuth) — miroir, JAMAIS de jeton. */
export interface ProfileSocialProvider {
  provider: string;
  providerId: string;
  createdAt: number | null;
}

/**
 * Vue publique de MON compte — miroir de `IUserSummary` (redaction par
 * construction côté serveur : jamais le hash, jamais `metadata`).
 */
export interface ProfileSummary {
  id: string;
  identifier: string;
  roles: string[];
  enabled: boolean;
  locked: boolean;
  /** `true` si un mot de passe LOCAL existe (sinon compte OAuth-only). */
  hasPassword: boolean;
  /** Profil de rôle actif en session, ou `null`. */
  currentRole: string | null;
  socialProviders: ProfileSocialProvider[];
  createdAt: number | null;
  updatedAt: number | null;
  /** Réserve multi-tenant (`null` = mono-tenant — slot coût-0). */
  tenantId: string | null;
}

// ─── Endpoints du data plane (@nodefony/user, namespace « user ») ─────────────

/** GET — MON profil (self-service, scopé serveur à l'appelant). */
export const PROFILE_ME_ENDPOINT = "/nodefony/user/api/me";

/** POST — changer MON mot de passe (re-auth du mot de passe actuel). */
export const PROFILE_PASSWORD_ENDPOINT = "/nodefony/user/api/me/password";

/** Corps du changement de mot de passe — miroir du handler `me/password`. */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** Longueur minimale d'un mot de passe (miroir du back, OWASP ASVS V2.1.1). */
export const MIN_PASSWORD_LENGTH = 8;

/** Version de la doc de cette surface (badge des fiches `DocHint`). */
export const PROFILE_DOC = "v1.0";

// ─── Validation client (UX immédiate ; le SERVEUR reste l'autorité) ───────────

/**
 * Valide un changement de mot de passe CÔTÉ CLIENT — retour anticipé pour l'UX.
 * Le serveur re-valide tout (re-auth, longueur, blocklist) et reste l'autorité.
 *
 * @returns un message d'erreur FR, ou `null` si la saisie est cohérente.
 */
export function validatePasswordChange(
  current: string,
  next: string,
  confirm: string,
): string | null {
  if (current.length === 0) return "Saisissez votre mot de passe actuel.";
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (next === current) {
    return "Le nouveau mot de passe doit être différent de l'actuel.";
  }
  if (next !== confirm) return "La confirmation ne correspond pas.";
  return null;
}

// ─── Formatage ────────────────────────────────────────────────────────────────

/** Date absolue lisible (ou « — » si nulle). */
export function fmtProfileDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ─── Mapping d'erreur (vitrine honnête) ──────────────────────────────────────

/**
 * Traduit une erreur du data plane profil en message FR explicite. Le **403**
 * est propre au changement de mot de passe (re-auth : le mot de passe actuel est
 * faux) ; le GET profil ne le produit pas (`public: true`).
 */
export function describeProfileError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) {
    return (
      "Non authentifié — le firewall ne reconnaît pas votre session Studio. " +
      "L'authentification de Studio est encore en mock (branchement sur le vrai " +
      "firewall = P6.15)."
    );
  }
  if (status === 403) {
    return "Mot de passe actuel incorrect.";
  }
  if (status === 400) {
    return "Mot de passe refusé — trop court, identique à l'actuel, ou trop courant.";
  }
  if (status === 503) {
    return "Service utilisateur indisponible — le sous-système n'est pas provisionné.";
  }
  if (status === 404) {
    return "Endpoint introuvable — le module @nodefony/user n'expose peut-être pas le self-service.";
  }
  const msg = (e as { message?: string } | null)?.message;
  return msg ? `Erreur : ${msg}` : "Une erreur est survenue.";
}
