import { makeAutoObservable, observableRef, runInAction } from "mobx";
import { hasRole } from "nodefony/roles";
import { NodefonyLogin } from "nodefony/client";
import type {
  LoginStep,
  NodefonyLoginState,
  NodefonyLoginUser,
  NodefonyPasskeyAgent,
} from "nodefony/client";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { AuthService, AuthUser } from "../services/AuthService";
import { DASHBOARDS, type DashboardDef } from "../auth/dashboards";

export type AuthStatus =
  "idle" | "loading" | "authenticated" | "unauthenticated";

/**
 * Étape du FORMULAIRE de connexion : celle du déroulé, sauf `authenticated`.
 * Une fois la session ouverte, l'écran garde le formulaire d'où l'on vient
 * pendant la fin de connexion (profil, temps réel) au lieu de le faire sauter.
 */
export type LoginFormStep = Exclude<LoginStep, "authenticated">;

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

/** Dernier compte connecté, `""` sans mémoire (mode privé, premier passage). */
export function readLastUser(): string {
  try {
    return localStorage.getItem(LAST_USER_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Message rendu quand le navigateur refuse une passkey sur cette adresse :
 * WebAuthn n'accepte pas une IP comme identifiant de site (`SecurityError`).
 * Ce n'est ni une panne réseau ni un refus du serveur — le dire évite de
 * chercher au mauvais endroit.
 */
export const PASSKEY_ADDRESS_MESSAGE =
  "Passkey indisponible sur cette adresse. Ouvre Studio via https://localhost:5152 — les passkeys n'acceptent pas une IP comme 127.0.0.1.";

function isRequestOptions(
  value: unknown,
): value is PublicKeyCredentialRequestOptionsJSON {
  return (
    typeof value === "object" &&
    value !== null &&
    "challenge" in value &&
    typeof value.challenge === "string"
  );
}

/**
 * Signataire de passkey de Studio : `@simplewebauthn/browser`, qui couvre les
 * navigateurs dépourvus de l'interface JSON de WebAuthn — le point d'injection
 * que `NodefonyLogin` prévoit pour cela. L'annulation (`NotAllowedError`)
 * remonte telle quelle : le déroulé la classe `cancelled`.
 */
const studioPasskeyAgent: NodefonyPasskeyAgent = {
  async sign(options: unknown): Promise<unknown> {
    if (!isRequestOptions(options)) {
      throw new TypeError("défi WebAuthn illisible");
    }
    try {
      return await startAuthentication({ optionsJSON: options });
    } catch (e) {
      if (e instanceof Error && e.name === "SecurityError") {
        throw new Error(PASSKEY_ADDRESS_MESSAGE, { cause: e });
      }
      throw e;
    }
  },
};

/**
 * Navigation vers un fournisseur, avec le thème RENDU (clair ou sombre,
 * attribut que Mantine pose sur `<html>`) : l'écran du fournisseur peut le
 * reprendre — Keycloak le fait, le serveur ne le transmet pas aux autres.
 */
function navigateWithTheme(url: string): void {
  const scheme = document.documentElement.getAttribute(
    "data-mantine-color-scheme",
  );
  const theme =
    scheme === "light" || scheme === "dark"
      ? `${url.includes("?") ? "&" : "?"}theme=${scheme}`
      : "";
  window.location.assign(`${url}${theme}`);
}

/** Projection Studio de l'identité rendue par le déroulé. */
function toAuthUser(user: NodefonyLoginUser): AuthUser {
  const currentRole = user["currentRole"];
  return {
    id: user.id,
    identifier: user.identifier,
    roles: [...user.roles],
    ...(typeof user.email === "string" ? { email: user.email } : {}),
    ...(typeof currentRole === "string" ? { currentRole } : {}),
  };
}

/**
 * Identité de l'utilisateur Studio — session BFF.
 *
 * Plus AUCUN token côté client : l'identité vit dans un cookie de session
 * opaque `HttpOnly` que le navigateur joint seul à chaque requête. Le store ne
 * garde que la PROJECTION (`user`), re-résolue au montage (`checkSession`).
 *
 * Le DÉROULÉ de connexion n'est pas écrit ici : il appartient à
 * `NodefonyLogin` (`nodefony/client`), le même que celui des pages générées.
 * Le store le POSSÈDE (il survit à l'écran de connexion : reprise, déconnexion,
 * 401 inattendu), OBSERVE son état (`flowState`) au lieu de le recalculer, et
 * n'ajoute que ce qui est propre à Studio — la mémoire du dernier compte et de
 * sa méthode, la projection `user`, l'accueil par rôle.
 */
export class AuthStore {
  user: AuthUser | null = null;
  status: AuthStatus = "idle";
  /** Photographie du déroulé partagé — remplacée à chaque changement, jamais mutée. */
  flowState: NodefonyLoginState;
  /** Étape du formulaire à afficher (cf {@link LoginFormStep}). */
  formStep: LoginFormStep;
  /** Le déroulé de connexion partagé — ses règles, pas les nôtres. */
  readonly flow: NodefonyLogin;
  // Reprise de session en vol (champ `#` : hors de l'observation MobX).
  #sessionCheck: Promise<void> | null = null;

  /**
   * @param auth - appels restés propres à Studio (enregistrement de passkey)
   * @param flow - déroulé à employer ; défaut : celui de Studio (dernier compte
   *   prérempli, passkey par `@simplewebauthn/browser`, thème vers le fournisseur)
   */
  constructor(
    private readonly auth: AuthService,
    flow?: NodefonyLogin,
  ) {
    this.flow =
      flow ??
      new NodefonyLogin({
        identifier: readLastUser(),
        passkey: studioPasskeyAgent,
        navigate: navigateWithTheme,
      });
    this.flowState = this.flow.getState();
    this.formStep =
      this.flowState.step === "authenticated"
        ? "identifier"
        : this.flowState.step;
    makeAutoObservable(this, { flow: false, flowState: observableRef });
    // Le store vit autant que l'application : l'abonnement n'est jamais rendu.
    this.flow.subscribe((state) => this.applyFlow(state));
  }

  get isAuthenticated(): boolean {
    return this.status === "authenticated" && !!this.user;
  }

  get displayName(): string {
    return this.user?.identifier ?? "guest";
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
   * Le mot de passe est validé mais le serveur exige un second facteur :
   * aucune session n'est ouverte (Zero Trust). Dérivé du déroulé, jamais posé.
   */
  get mfaPending(): boolean {
    return this.flowState.step === "mfa";
  }

  /**
   * Page d'accueil = le BUREAU composable (`/nodefony/workspace`) : personnalisable
   * et role-aware (bureau « Mon compte » pour un simple user, bureaux par rôle).
   * PAS un dashboard spécialisé comme la Supervision (vue ops → via le menu).
   */
  get homePath(): string {
    return "/nodefony/workspace";
  }

  /** Relaie l'état du déroulé ; une session ouverte devient l'identité Studio. */
  private applyFlow(state: NodefonyLoginState): void {
    this.flowState = state;
    if (state.step !== "authenticated") {
      this.formStep = state.step;
      return;
    }
    if (state.user !== null) {
      this.user = toAuthUser(state.user);
      this.status = "authenticated";
    }
  }

  /**
   * Au montage de l'app : interroge TOUJOURS le serveur — c'est le cookie
   * (invisible au JS) qui décide, pas un état local.
   *
   * Une reprise déjà en vol est PARTAGÉE : le `StrictMode` de React monte deux
   * fois en développement, et deux montages ne doivent pas coûter deux
   * allers-retours (ni deux `401` en console pour un visiteur anonyme).
   */
  checkSession(): Promise<void> {
    if (this.#sessionCheck !== null) return this.#sessionCheck;
    this.status = "loading";
    this.#sessionCheck = this.#resolveSession().finally(() => {
      this.#sessionCheck = null;
    });
    return this.#sessionCheck;
  }

  async #resolveSession(): Promise<void> {
    const user = await this.flow.me();
    if (user === null) {
      runInAction(() => {
        this.user = null;
        this.status = "unauthenticated"; // pas connecté = état normal, pas une erreur
      });
      return;
    }
    rememberUser(user.identifier); // social/passkey inclus (résolu par la reprise)
    // Mode social posé avant la redirection pleine page → promu UNIQUEMENT ici
    // (sur succès) → une annulation côté fournisseur ne fausse pas le mode affiché.
    try {
      const pending = localStorage.getItem(PENDING_METHOD_KEY);
      if (pending) rememberMethod(pending);
    } catch {
      /* localStorage indisponible (mode privé) — non bloquant */
    }
  }

  /** Retient le compte saisi et passe au mot de passe (aucun appel serveur). */
  submitIdentifier(identifier: string): void {
    const value = identifier.trim();
    if (value === "") return;
    rememberUser(value);
    this.flow.submitIdentifier(value);
  }

  /** « Changer » : quitte le compte affiché pour en saisir un autre. */
  changeAccount(): void {
    this.flow.back();
  }

  /** Mot de passe du compte saisi ; l'état rendu dit la suite (`mfa`, échec…). */
  async submitPassword(password: string): Promise<NodefonyLoginState> {
    const state = await this.flow.submitPassword(password);
    this.rememberLogin(state, "password");
    return state;
  }

  /** Second facteur (code TOTP ou code de récupération). */
  async completeMfa(code: string): Promise<NodefonyLoginState> {
    const state = await this.flow.submitMfaCode(code);
    this.rememberLogin(state, "password");
    return state;
  }

  /** Abandonne un second facteur en attente : retour au formulaire du compte. */
  cancelMfa(): void {
    this.resumeForm();
  }

  /** Connexion par passkey, sans identifiant ni mot de passe. */
  async loginWithPasskey(): Promise<NodefonyLoginState> {
    const state = await this.flow.loginWithPasskey();
    this.rememberLogin(state, "passkey");
    return state;
  }

  /** Charge les fournisseurs configurés (une requête, rejouée après échec). */
  loadProviders(): void {
    void this.flow.loadProviders();
  }

  /**
   * Part chez un fournisseur (navigation pleine page). Le mode est noté AVANT :
   * l'écran ne repasse pas, il sera promu au retour authentifié.
   */
  startProvider(name: string): void {
    try {
      localStorage.setItem(PENDING_METHOD_KEY, name);
    } catch {
      /* localStorage indisponible (mode privé) — non bloquant */
    }
    // `back` = cet écran : le « Retour » du fournisseur et un échec ramènent
    // ici, et non sur la page de connexion par défaut de l'application.
    this.flow.startProvider(name, undefined, "/nodefony/login");
  }

  /**
   * Enregistre un passkey pour l'utilisateur connecté (depuis le profil).
   * @returns l'identifiant du credential créé.
   */
  registerPasskey(): Promise<string> {
    return this.auth.registerPasskey();
  }

  async logout(): Promise<void> {
    const logoutUrl = await this.flow.logout();
    runInAction(() => {
      this.user = null;
      this.status = "unauthenticated";
    });
    this.resumeForm();
    // Session ouverte par un fournisseur d'identité : sans ce détour, sa
    // session à lui survit et le clic suivant reconnecte sans mot de passe.
    // Seul un schéma http(s) est suivi — jamais `javascript:`.
    if (logoutUrl !== null && /^https?:\/\//i.test(logoutUrl)) {
      window.location.assign(logoutUrl);
    }
  }

  /**
   * Nettoie l'état d'auth LOCAL (→ page de login) SANS appeler la déconnexion.
   * Pour un 401 INATTENDU du data-plane : on ne détruit NI la session serveur NI
   * le cookie (le 401 peut être transitoire — reload, course) → une déconnexion
   * sur un simple hoquet ne devient pas permanente. La déconnexion serveur reste
   * réservée au {@link logout} EXPLICITE (clic utilisateur).
   */
  clearLocalSession(): void {
    runInAction(() => {
      this.user = null;
      this.status = "unauthenticated";
    });
    this.resumeForm();
  }

  /** Session ouverte par cette action : mémorise le compte et sa méthode. */
  private rememberLogin(state: NodefonyLoginState, method: string): void {
    if (state.step !== "authenticated" || state.user === null) return;
    rememberUser(state.user.identifier);
    rememberMethod(method);
  }

  /** Revient au formulaire : le dernier compte (« rebonjour »), sinon l'identifiant. */
  private resumeForm(): void {
    this.flow.back();
    const last = readLastUser();
    if (last !== "") this.flow.submitIdentifier(last);
  }
}
