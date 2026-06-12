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

const AUTH_BASE = "/nodefony/security/api/auth";

export class AuthService {
  constructor(private readonly api: ApiClient) {}

  /**
   * POST /auth/login — le credential est présenté UNE fois ; le serveur pose
   * le cookie de session (ID régénéré, anti-fixation) et renvoie `{user}`.
   * @throws ApiError 401 (message uniforme) ou 429 (`Retry-After`, backoff NIST).
   */
  async login(credentials: LoginCredentials): Promise<AuthUser> {
    const { user } = await this.api.postAbsolute<{ user: AuthUser }>(
      `${AUTH_BASE}/login`,
      credentials,
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

  async ping(): Promise<{ status: string; uptime: number; pid: number }> {
    return this.api.get("/health");
  }
}
