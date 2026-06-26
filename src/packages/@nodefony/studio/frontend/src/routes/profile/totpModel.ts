/**
 * Modèle de la **2FA TOTP self-service** (P6.17) — endpoints + types MIROIR du
 * data plane `@nodefony/security` (`/nodefony/security/api/totp/*`). Types locaux
 * (jamais d'import runtime serveur) ; secrets affichés UNE fois, jamais persistés
 * côté client.
 */

/** Démarre l'enrôlement (secret + URI otpauth, affichés 1×). */
export const TOTP_ENROLL_ENDPOINT = "/nodefony/security/api/totp/enroll";
/** Confirme l'enrôlement (1ᵉʳ code) → active + codes de récupération. */
export const TOTP_CONFIRM_ENDPOINT = "/nodefony/security/api/totp/confirm";
/** Désactive le 2FA. */
export const TOTP_DISABLE_ENDPOINT = "/nodefony/security/api/totp/disable";
/** État 2FA du porteur courant. */
export const TOTP_STATUS_ENDPOINT = "/nodefony/security/api/totp/status";

/** État 2FA d'un utilisateur (miroir de `ITotpStatus`). */
export interface TotpStatus {
  /** 2FA activé (enrôlement confirmé). */
  enabled: boolean;
  /** Enrôlement commencé mais pas encore confirmé. */
  pending: boolean;
  /** Codes de récupération restants (non consommés). */
  recoveryCodesRemaining: number;
}

/** Données d'enrôlement affichées UNE fois (miroir de `ITotpEnrollment`). */
export interface TotpEnrollment {
  /** Secret en base32 (à saisir manuellement si le QR n'est pas scanné). */
  secretBase32: string;
  /** URI `otpauth://` encodé dans le QR code. */
  otpauthUri: string;
}

/** Résultat de l'activation — codes de récupération CLAIRS, affichés 1× (miroir de `ITotpActivation`). */
export interface TotpActivation {
  recoveryCodes: string[];
}

/** Un code TOTP valide = exactement 6 chiffres. */
export const TOTP_CODE_RE = /^\d{6}$/;

/**
 * Valide un code 2FA côté client AVANT envoi : 6 chiffres (TOTP) OU un code de
 * récupération `XXXXX-XXXXX`. Retourne un message FR ou `null` si OK.
 */
export function validateTotpCode(code: string): string | null {
  const v = code.trim();
  if (v.length === 0) return "Saisissez le code de votre application.";
  if (TOTP_CODE_RE.test(v)) return null;
  // Code de récupération toléré (l'app authenticator a peut-être expiré).
  if (/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(v)) return null;
  return "Code à 6 chiffres, ou code de récupération XXXXX-XXXXX.";
}

/** Traduit une erreur du data plane TOTP en message FR (jamais un détail serveur). */
export function describeTotpError(e: unknown): string {
  const status =
    (e as { status?: number; code?: number }).status ??
    (e as { code?: number }).code;
  switch (status) {
    case 400:
      return "Code invalide ou expiré. Réessayez avec le code courant.";
    case 401:
      return "Session expirée — reconnectez-vous.";
    case 403:
      return "Action non autorisée.";
    case 503:
      return "2FA indisponible sur ce serveur.";
    case 404:
      return "Service 2FA introuvable.";
    default:
      return e instanceof Error ? e.message : "Erreur inattendue.";
  }
}
