/**
 * AuthService — façade login/logout/me.
 *
 * Sera relié au firewall @nodefony/security (P6) : factory `vision-admin`,
 * AuthBridge (ex-PassportBridge), `ROLE_NODEFONY_ADMIN`.
 */
import type { ApiClient } from "./ApiClient";

export interface AuthUser {
  id: number | string;
  username: string;
  email?: string;
  roles: string[];
  currentRole?: string;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export class AuthService {
  constructor(private readonly api: ApiClient) {}

  /** Mock pour le POC — accepte n'importe quoi côté backend. */
  async login(credentials: LoginCredentials): Promise<LoginResult> {
    return this.api.post<LoginResult>("/auth/login", credentials);
  }

  /** GET /api/auth/me — charge l'utilisateur depuis le token. */
  async me(): Promise<AuthUser> {
    return this.api.get<AuthUser>("/auth/me");
  }

  async logout(): Promise<void> {
    await this.api.post<{ ok: boolean }>("/auth/logout");
  }

  async ping(): Promise<{ status: string; uptime: number; pid: number }> {
    return this.api.get("/health");
  }
}
