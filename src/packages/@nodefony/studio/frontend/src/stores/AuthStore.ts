import { makeAutoObservable, runInAction } from "mobx";
import { hasRole } from "nodefony/roles";
import type {
  AuthService,
  AuthUser,
  LoginCredentials,
} from "../services/AuthService";
import { DASHBOARDS, type DashboardDef } from "../auth/dashboards";

export type AuthStatus =
  | "idle"
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

/**
 * Identité de l'utilisateur Studio — session BFF (P6 J3).
 *
 * Plus AUCUN token côté client : l'identité vit dans un cookie de session
 * opaque `HttpOnly` que le navigateur joint seul à chaque requête. Le store ne
 * garde que la PROJECTION (`user`) renvoyée par `/auth/me|login` — source de
 * vérité = le serveur, re-résolue au mount (`checkSession`). Un compte
 * verrouillé/désactivé ou une session expirée → 401 → `unauthenticated`.
 */
export class AuthStore {
  user: AuthUser | null = null;
  status: AuthStatus = "idle";
  error: string | null = null;

  constructor(private readonly auth: AuthService) {
    makeAutoObservable(this);
  }

  get isAuthenticated(): boolean {
    return this.status === "authenticated" && !!this.user;
  }

  get displayName(): string {
    return this.user?.username ?? "guest";
  }

  /** Rôles de l'utilisateur courant (projection serveur), sinon tableau vide. */
  get roles(): string[] {
    return this.user?.roles ?? [];
  }

  /** Dashboards accessibles, filtrés par rôle (pilote nav + accueil). */
  get dashboards(): DashboardDef[] {
    const roles = this.roles;
    return DASHBOARDS.filter((d) => hasRole(roles, d.role));
  }

  /**
   * Page d'accueil = 1er dashboard autorisé. Sans rôle de dashboard, repli sur
   * l'Admin API (toujours visible).
   */
  get homePath(): string {
    return this.dashboards[0]?.path ?? "/nodefony/workspace";
  }

  /**
   * Au mount de l'app : interroge TOUJOURS `/auth/me` — c'est le cookie
   * (invisible au JS) qui décide, pas un état local. 401 → non connecté.
   */
  async checkSession(): Promise<void> {
    this.status = "loading";
    try {
      const user = await this.auth.me();
      runInAction(() => {
        this.user = user;
        this.status = "authenticated";
        this.error = null;
      });
    } catch {
      runInAction(() => {
        this.user = null;
        this.status = "unauthenticated";
        this.error = null; // pas connecté = état normal, pas une erreur UI
      });
    }
  }

  async login(credentials: LoginCredentials): Promise<void> {
    this.status = "loading";
    this.error = null;
    try {
      const user = await this.auth.login(credentials);
      runInAction(() => {
        this.user = user;
        this.status = "authenticated";
      });
    } catch (e) {
      runInAction(() => {
        this.status = "error";
        this.error = e instanceof Error ? e.message : String(e);
      });
      throw e;
    }
  }

  /**
   * Connexion par passkey / empreinte (WebAuthn, P6 J9) — même effet que
   * {@link login} mais sans mot de passe (la biométrie remplace le secret).
   */
  async loginWithPasskey(username?: string): Promise<void> {
    this.status = "loading";
    this.error = null;
    try {
      const user = await this.auth.loginWithPasskey(username);
      runInAction(() => {
        this.user = user;
        this.status = "authenticated";
      });
    } catch (e) {
      runInAction(() => {
        this.status = "error";
        this.error = e instanceof Error ? e.message : String(e);
      });
      throw e;
    }
  }

  /**
   * Enregistre un passkey pour l'utilisateur connecté (depuis le profil).
   * @returns l'identifiant du credential créé.
   */
  registerPasskey(): Promise<string> {
    return this.auth.registerPasskey();
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } catch {
      /* swallow — clear local state anyway */
    }
    runInAction(() => {
      this.user = null;
      this.status = "unauthenticated";
    });
  }
}
