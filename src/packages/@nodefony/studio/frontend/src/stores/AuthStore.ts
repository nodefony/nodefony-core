import { makeAutoObservable, runInAction } from "mobx";
import { hasRole } from "nodefony/roles";
import type {
  AuthService,
  AuthUser,
  LoginCredentials,
} from "../services/AuthService";
import { DASHBOARDS, type DashboardDef } from "../auth/dashboards";

export type AuthStatus =
  "idle" | "loading" | "authenticated" | "unauthenticated" | "error";

/**
 * Clé localStorage du dernier identifiant connecté (UX « rebonjour » du login).
 * Username SEUL, jamais de secret. Source de vérité = l'identité authentifiée
 * (mise à jour après login mot de passe, passkey ET social) → le pré-remplissage
 * du login reflète toujours le DERNIER compte réellement connecté.
 */
export const LAST_USER_KEY = "nf.studio.lastUser";

/**
 * Mode du dernier login : `"password"` | `"passkey"` | `<provider social>`
 * (ex. `"github"`). Pilote l'UI « rebonjour » (icône + action primaire cohérente
 * avec la dernière méthode), pour ne PAS proposer un mot de passe à un compte social.
 */
export const LAST_METHOD_KEY = "nf.studio.lastMethod";

/**
 * Marqueur TRANSIENT du mode social en cours : posé avant la redirection pleine
 * page (le composant Login ne repasse pas), consommé au 1ᵉʳ retour authentifié
 * (`checkSession`). Promu sur SUCCÈS uniquement → une annulation ne fausse pas le mode.
 */
export const PENDING_METHOD_KEY = "nf.studio.pendingMethod";

/** Mémorise le dernier compte connecté (best-effort — mode privé toléré). */
function rememberUser(username: string): void {
  try {
    localStorage.setItem(LAST_USER_KEY, username);
  } catch {
    /* localStorage indisponible (mode privé) — non bloquant */
  }
}

/** Mémorise le MODE du dernier login (+ consomme le marqueur social transient). */
function rememberMethod(method: string): void {
  try {
    localStorage.setItem(LAST_METHOD_KEY, method);
    localStorage.removeItem(PENDING_METHOD_KEY);
  } catch {
    /* localStorage indisponible (mode privé) — non bloquant */
  }
}

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
  /**
   * Login en attente d'un **second facteur** (2FA TOTP) : le mot de passe est
   * validé mais l'identité N'EST PAS établie (Zero Trust). Le composant Login bascule
   * sur la saisie du code ; {@link completeMfa} ouvre réellement la session.
   */
  mfaPending = false;

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
   * Page d'accueil = le BUREAU composable (`/nodefony/workspace`) : personnalisable
   * et role-aware (bureau « Mon compte » pour un simple user, bureaux par rôle).
   * PAS un dashboard spécialisé comme la Supervision (vue ops → via le menu).
   */
  get homePath(): string {
    return "/nodefony/workspace";
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
      rememberUser(user.username); // social/passkey inclus (résolu via /auth/me)
      // Mode social posé avant la redirection pleine page → promu UNIQUEMENT ici
      // (sur succès) → une annulation côté fournisseur ne fausse pas le mode affiché.
      try {
        const pending = localStorage.getItem(PENDING_METHOD_KEY);
        if (pending) rememberMethod(pending);
      } catch {
        /* localStorage indisponible (mode privé) — non bloquant */
      }
    } catch {
      runInAction(() => {
        this.user = null;
        this.status = "unauthenticated";
        this.error = null; // pas connecté = état normal, pas une erreur UI
      });
    }
  }

  /**
   * Login mot de passe. Renvoie `"mfa_required"` si le serveur réclame un 2ᵉ
   * facteur (202) — l'identité n'est alors PAS établie, le composant Login bascule
   * sur la saisie du code (`mfaPending`). Sinon `"authenticated"` (session ouverte).
   */
  async login(
    credentials: LoginCredentials,
  ): Promise<"authenticated" | "mfa_required"> {
    this.status = "loading";
    this.error = null;
    this.mfaPending = false;
    try {
      const result = await this.auth.login(credentials);
      if (result.kind === "mfaRequired") {
        runInAction(() => {
          this.mfaPending = true;
          this.status = "idle"; // ni connecté, ni en erreur : en attente du 2ᵉ facteur
        });
        return "mfa_required";
      }
      runInAction(() => {
        this.user = result.user;
        this.status = "authenticated";
      });
      rememberUser(result.user.username);
      rememberMethod("password");
      return "authenticated";
    } catch (e) {
      runInAction(() => {
        this.status = "error";
        this.error = e instanceof Error ? e.message : String(e);
      });
      throw e;
    }
  }

  /**
   * Valide le second facteur (code TOTP ou code de récupération) après un login
   * `mfa_required` et OUVRE la session. Sur échec, reste en attente (l'utilisateur
   * peut ressaisir un code) — le défi serveur n'est consommé qu'au succès.
   */
  async completeMfa(code: string): Promise<void> {
    this.status = "loading";
    this.error = null;
    try {
      const user = await this.auth.verifyTotpLogin(code);
      runInAction(() => {
        this.user = user;
        this.status = "authenticated";
        this.mfaPending = false;
      });
      rememberUser(user.username);
      rememberMethod("password");
    } catch (e) {
      runInAction(() => {
        this.status = "idle"; // toujours en attente du 2ᵉ facteur, PAS « error » global
        this.error = e instanceof Error ? e.message : String(e);
      });
      throw e;
    }
  }

  /** Abandonne un login 2FA en attente (retour au formulaire d'identifiant). */
  cancelMfa(): void {
    runInAction(() => {
      this.mfaPending = false;
      this.status = "unauthenticated";
      this.error = null;
    });
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
      rememberUser(user.username);
      rememberMethod("passkey");
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

  /**
   * Nettoie l'état d'auth LOCAL (→ page de login) SANS appeler `/auth/logout`.
   * Pour un 401 INATTENDU du data-plane : on ne détruit NI la session serveur NI
   * le cookie (le 401 peut être transitoire — reload, course) → une déconnexion
   * sur un simple hoquet ne devient pas permanente. Le `POST /auth/logout` reste
   * réservé au {@link logout} EXPLICITE (clic utilisateur).
   */
  clearLocalSession(): void {
    runInAction(() => {
      this.user = null;
      this.status = "unauthenticated";
    });
  }
}
