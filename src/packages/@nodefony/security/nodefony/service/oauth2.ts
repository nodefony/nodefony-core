import { Service, Module, Container, Event } from "nodefony";
import type * as Arctic from "arctic";
import type { IUser, IOAuthUserProvisioner } from "@nodefony/user";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineSecurityConfig";
import { AuthenticationError } from "../errors/AuthenticationError";
import type { IOAuthProvider } from "../contracts/IOAuthProvider";
import {
  getOAuthProviderFactory,
  listOAuthProviders,
} from "../src/oauth/oauthProviderRegistry";

const serviceName = "oauth2";

type Lib = typeof Arctic;

/** Données à porter en session entre `authorize` et `callback` (anti-replay). */
export interface IOAuthAuthorization {
  /** URL d'autorisation vers laquelle rediriger l'utilisateur. */
  readonly url: string;
  /** `state` anti-CSRF à stocker en session (RFC 9700). */
  readonly state: string;
  /** `code_verifier` PKCE à stocker en session, ou `null` (fournisseur sans PKCE). */
  readonly codeVerifier: string | null;
}

/** Fournisseur résolu + scopes effectifs (config ou défaut du fournisseur). */
interface IResolvedProvider {
  readonly provider: IOAuthProvider;
  readonly scopes: string[];
}

/**
 * **Social login OAuth 2.0** (P6 J9) — orchestrateur du flux *Authorization Code*
 * au-dessus d'`arctic`.
 *
 * Posture OAuth 2.1 (RFC 9700) : Authorization Code uniquement (jamais implicit /
 * ROPC), **PKCE S256** quand le fournisseur le supporte (RFC 7636), **state**
 * anti-CSRF, **iss** anti-mix-up (RFC 9207) ; aucun jeton n'atteint le navigateur
 * (le login produit une **session BFF**, gérée hors de ce service par le
 * controller + `AuthFlow`).
 *
 * `arctic` est **importé paresseusement** au premier login (cold path — jamais au
 * boot ni par requête), comme `@simplewebauthn`/`jose`. Au boot (si
 * `oauth2.enabled`) : seule la config est validée et les fournisseurs configurés
 * sont confrontés au registre (un nom inconnu = WARNING, pas fatal).
 *
 * Le service ne touche **ni HTTP ni session** : il rend à l'appelant les éléments
 * (URL, state, verifier) que le controller persiste en session — testable sans
 * transport, comme `AuthFlow`.
 */
class OAuth2Service extends Service {
  #config: ISecurityConfig | null = null;
  #lib: Lib | null = null;
  // Fournisseurs instanciés, mémoïsés au 1ᵉʳ usage (lazy — pas alloués au boot).
  #providers: Map<string, IResolvedProvider> | null = null;
  #ready = false;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
  }

  #build(): void {
    let config: ISecurityConfig;
    try {
      config = defineSecurityConfig(this.options as ISecurityConfigInput);
    } catch {
      // Config invalide : le firewall logge CRITIC + fail-closed. On s'efface
      // (les endpoints répondront 503 / le service restera désactivé).
      return;
    }
    if (!config.oauth2.enabled) {
      this.log("oauth2 idle — social login désactivé en config", "DEBUG");
      return;
    }
    this.#config = config;
    const known = new Set(listOAuthProviders());
    const configured = Object.keys(config.oauth2.providers);
    for (const name of configured) {
      if (!known.has(name)) {
        this.log(
          `oauth2 provider "${name}" inconnu du registre — ignoré (registerOAuthProvider manquant ?)`,
          "WARNING",
        );
      }
    }
    this.#ready = true;
    const active = configured.filter((n) => known.has(n));
    this.log(
      `oauth2 ready — providers: [${active.join(", ") || "aucun"}]`,
      "DEBUG",
    );
  }

  /** `true` si le social login est opérationnel (activé + boot OK). */
  isEnabled(): boolean {
    return this.#ready;
  }

  /** Noms des fournisseurs configurés ET connus du registre (UI : boutons à afficher). */
  listProviders(): string[] {
    if (!this.#ready || this.#config === null) {
      return [];
    }
    const known = new Set(listOAuthProviders());
    return Object.keys(this.#config.oauth2.providers).filter((n) =>
      known.has(n),
    );
  }

  /** Redirections post-login (succès / échec) — lues par le controller. */
  getRedirects(): { success: string; failure: string } {
    const o = this.#config?.oauth2;
    return {
      success: o?.successRedirect ?? "/",
      failure: o?.failureRedirect ?? "/login",
    };
  }

  /**
   * Étape 1 — prépare l'URL d'autorisation + les éléments anti-replay à stocker
   * en session (`state`, et `code_verifier` si PKCE).
   *
   * @throws AuthenticationError — fournisseur non configuré / inconnu du registre.
   */
  async createAuthorization(provider: string): Promise<IOAuthAuthorization> {
    const resolved = await this.#resolveProvider(provider);
    const lib = await this.#ensureLib();
    const state = lib.generateState();
    const codeVerifier = resolved.provider.usesPkce
      ? lib.generateCodeVerifier()
      : null;
    const url = resolved.provider.createAuthorizationURL(
      state,
      codeVerifier,
      resolved.scopes,
    );
    return { url: url.toString(), state, codeVerifier };
  }

  /**
   * Étape 2 — valide la réponse, échange le `code`, lit le profil et provisionne
   * l'utilisateur local (Shadow User). Retourne l'identifiant à ouvrir en session.
   *
   * @param returnedIss - paramètre `iss` reçu (anti-mix-up RFC 9207), ou `null`.
   * @throws AuthenticationError — `iss` invalide, échange refusé, ou provisioning
   *   impossible (lien inconnu + signup interdit).
   */
  async exchangeAndProvision(
    provider: string,
    code: string,
    codeVerifier: string | null,
    returnedIss: string | null,
  ): Promise<{ identifier: string }> {
    const { provider: p } = await this.#resolveProvider(provider);
    // Anti-mix-up (RFC 9207) : si le fournisseur émet `iss`, il DOIT correspondre.
    if (p.expectedIssuer !== null) {
      if (returnedIss === null || returnedIss !== p.expectedIssuer) {
        throw new AuthenticationError("OAuth issuer mismatch");
      }
    }
    const tokens = await p.validateAuthorizationCode(code, codeVerifier);
    const profile = await p.fetchProfile(tokens);
    const cfg = this.#config!.oauth2;
    const user: IUser = await this.#resolveProvisioner().provisionOAuthUser(
      profile,
      { defaultRoles: [...cfg.defaultRoles], allowSignup: cfg.allowSignup },
    );
    return { identifier: user.identifier };
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  async #resolveProvider(name: string): Promise<IResolvedProvider> {
    this.#ensureReady();
    this.#providers ??= new Map();
    const cached = this.#providers.get(name);
    if (cached) {
      return cached;
    }
    const cfg = this.#config!.oauth2.providers[name];
    if (!cfg) {
      throw new AuthenticationError(`OAuth provider "${name}" non configuré`);
    }
    const factory = getOAuthProviderFactory(name);
    if (!factory) {
      throw new AuthenticationError(
        `OAuth provider "${name}" inconnu du registre`,
      );
    }
    const lib = await this.#ensureLib();
    const provider = factory({
      arctic: lib,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUri: cfg.redirectUri,
      issuer: cfg.issuer,
    });
    const scopes = cfg.scopes.length > 0 ? cfg.scopes : provider.defaultScopes;
    const resolved: IResolvedProvider = { provider, scopes };
    this.#providers.set(name, resolved);
    return resolved;
  }

  // Le provisioner = le service "users" S'IL implémente la capability (duck-typing,
  // comme isFlushable côté WebAuthn). Sinon fail-closed (pas de signup silencieux).
  #resolveProvisioner(): IOAuthUserProvisioner {
    const users = this.get<Partial<IOAuthUserProvisioner>>("users");
    if (!users || typeof users.provisionOAuthUser !== "function") {
      throw new AuthenticationError(
        "OAuth provisioning indisponible (le service users n'implémente pas IOAuthUserProvisioner)",
      );
    }
    return users as IOAuthUserProvisioner;
  }

  async #ensureLib(): Promise<Lib> {
    return (this.#lib ??= (await import("arctic")) as Lib);
  }

  #ensureReady(): void {
    if (!this.#ready || this.#config === null) {
      throw new Error(
        "OAuth2Service: non initialisé (social login désactivé ou boot échoué)",
      );
    }
  }
}

export default OAuth2Service;
export { OAuth2Service };
