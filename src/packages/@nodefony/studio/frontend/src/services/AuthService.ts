/**
 * AuthService — façade login/logout/me (session BFF, P6 J3).
 *
 * Branché sur le flux RÉEL `@nodefony/security` : endpoints
 * `/nodefony/security/api/auth/*` (chemins ABSOLUS — data plane du module
 * security, hors `baseUrl` Studio). L'identité est portée par un cookie de
 * session opaque `HttpOnly` (`__Host-nodefony`) que le navigateur joint seul
 * (`credentials: "same-origin"` dans ApiClient) — AUCUN token lisible par JS,
 * rien à stocker côté client.
 */
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type { ApiClient } from "./ApiClient";

export interface AuthUser {
  id: number | string;
  username: string;
  email?: string;
  roles: string[];
  currentRole?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

/**
 * Issue d'un login : soit l'identité est établie (`authenticated`), soit le
 * serveur réclame un **second facteur** (`mfaRequired`, 2FA TOTP — réponse 202).
 * Tant que le 2ᵉ facteur n'est pas validé, AUCUNE session n'est ouverte.
 */
export type LoginResult =
  | { kind: "authenticated"; user: AuthUser }
  | { kind: "mfaRequired"; methods: string[] };

const AUTH_BASE = "/nodefony/security/api/auth";
const WEBAUTHN_BASE = "/nodefony/security/api/webauthn";

export class AuthService {
  constructor(private readonly api: ApiClient) {}

  /**
   * POST /auth/login — le credential est présenté UNE fois. Si l'utilisateur a un
   * 2FA, le serveur répond 202 `{mfaRequired}` SANS ouvrir de session (il garde un
   * défi en attente) → on enchaîne sur {@link verifyTotpLogin}. Sinon il pose le
   * cookie de session (ID régénéré, anti-fixation) et renvoie `{user}`.
   * @throws ApiError 401 (message uniforme) ou 429 (`Retry-After`, backoff NIST).
   */
  async login(credentials: LoginCredentials): Promise<LoginResult> {
    const res = await this.api.postAbsolute<{
      user?: AuthUser;
      mfaRequired?: boolean;
      methods?: string[];
    }>(`${AUTH_BASE}/login`, credentials);
    if (res.mfaRequired) {
      return { kind: "mfaRequired", methods: res.methods ?? ["totp"] };
    }
    return { kind: "authenticated", user: res.user as AuthUser };
  }

  /**
   * POST /auth/login/totp — valide le **second facteur** (code TOTP ou code de
   * récupération) après un login `mfaRequired`, puis OUVRE la session BFF.
   * @throws ApiError 401 (code absent/invalide) ou 429 (trop de tentatives).
   */
  async verifyTotpLogin(code: string): Promise<AuthUser> {
    const { user } = await this.api.postAbsolute<{ user: AuthUser }>(
      `${AUTH_BASE}/login/totp`,
      { code },
    );
    return user;
  }

  /** GET /auth/me — identité de la session courante, re-résolue (rôles frais). */
  async me(): Promise<AuthUser> {
    const { user } = await this.api.getAbsolute<{ user: AuthUser }>(
      `${AUTH_BASE}/me`,
    );
    return user;
  }

  /** POST /auth/logout — détruit la session serveur + le cookie. Idempotent. */
  async logout(): Promise<void> {
    await this.api.postAbsolute<{ ok: boolean }>(`${AUTH_BASE}/logout`);
  }

  /**
   * Connexion par **passkey / empreinte** (WebAuthn, P6 J9) — sans mot de passe.
   *
   *  1. Demande un défi au serveur (`login/options`) ;
   *  2. `startAuthentication()` déclenche l'invite biométrique du navigateur/OS
   *     et signe le défi avec la clé privée (jamais exposée) ;
   *  3. le serveur vérifie la signature (`login/verify`) et ouvre la session BFF
   *     (cookie `HttpOnly`, comme le login mot de passe).
   *
   * @param username - identifiant ciblé (optionnel : omis = passkey découvrable,
   *   le navigateur propose les comptes enregistrés).
   * @throws ApiError 401 — vérification échouée. L'annulation utilisateur lève
   *   une `NotAllowedError` côté navigateur (gérée par l'appelant).
   */
  async loginWithPasskey(username?: string): Promise<AuthUser> {
    const optionsJSON =
      await this.api.postAbsolute<PublicKeyCredentialRequestOptionsJSON>(
        `${WEBAUTHN_BASE}/login/options`,
        username ? { username } : {},
      );
    const assertion = await startAuthentication({ optionsJSON });
    const { user } = await this.api.postAbsolute<{
      verified: boolean;
      user: AuthUser;
    }>(`${WEBAUTHN_BASE}/login/verify`, { response: assertion });
    return user;
  }

  /**
   * Enregistre un nouveau passkey pour l'utilisateur **déjà connecté** (lie une
   * empreinte/clé matérielle à son compte). `startRegistration()` déclenche la
   * création de la paire de clés dans l'authenticator (Touch ID, clé FIDO…).
   *
   * @returns l'identifiant (base64url) du credential créé.
   * @throws ApiError 401 — non connecté, ou vérification échouée.
   */
  async registerPasskey(): Promise<string> {
    const optionsJSON =
      await this.api.postAbsolute<PublicKeyCredentialCreationOptionsJSON>(
        `${WEBAUTHN_BASE}/register/options`,
        {},
      );
    const attestation = await startRegistration({ optionsJSON });
    const { credentialId } = await this.api.postAbsolute<{
      verified: boolean;
      credentialId: string;
    }>(`${WEBAUTHN_BASE}/register/verify`, { response: attestation });
    return credentialId;
  }

  async ping(): Promise<{ status: string; uptime: number; pid: number }> {
    return this.api.get("/health");
  }
}
