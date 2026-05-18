import { makeAutoObservable, runInAction } from "mobx";
import type { AuthService, AuthUser, LoginCredentials } from "../services/AuthService";

const TOKEN_KEY = "nodefony.studio.token";

export type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated" | "error";

export class AuthStore {
  user: AuthUser | null = null;
  token: string | null = null;
  status: AuthStatus = "idle";
  error: string | null = null;

  constructor(private readonly auth: AuthService) {
    makeAutoObservable(this);
    this.token = this.loadToken();
  }

  get isAuthenticated(): boolean {
    return this.status === "authenticated" && !!this.user;
  }

  get displayName(): string {
    return this.user?.username ?? "guest";
  }

  /** Au mount de l'app : si token, tenter `/me`. */
  async checkSession(): Promise<void> {
    if (!this.token) {
      runInAction(() => (this.status = "unauthenticated"));
      return;
    }
    this.status = "loading";
    try {
      const user = await this.auth.me();
      runInAction(() => {
        this.user = user;
        this.status = "authenticated";
        this.error = null;
      });
    } catch (e) {
      runInAction(() => {
        this.token = null;
        this.persistToken(null);
        this.user = null;
        this.status = "unauthenticated";
        this.error = e instanceof Error ? e.message : String(e);
      });
    }
  }

  async login(credentials: LoginCredentials): Promise<void> {
    this.status = "loading";
    this.error = null;
    try {
      const { token, user } = await this.auth.login(credentials);
      runInAction(() => {
        this.token = token;
        this.user = user;
        this.status = "authenticated";
        this.persistToken(token);
      });
    } catch (e) {
      runInAction(() => {
        this.status = "error";
        this.error = e instanceof Error ? e.message : String(e);
      });
      throw e;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } catch {
      /* swallow — clear local state anyway */
    }
    runInAction(() => {
      this.user = null;
      this.token = null;
      this.status = "unauthenticated";
      this.persistToken(null);
    });
  }

  getToken(): string | null {
    return this.token;
  }

  private loadToken(): string | null {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    } catch {
      return null;
    }
  }

  private persistToken(token: string | null): void {
    try {
      if (typeof localStorage === "undefined") return;
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage disabled — ignore */
    }
  }
}
