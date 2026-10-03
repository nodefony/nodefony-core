import {
  Service,
  Module,
  Container,
  BootConfigurationError,
  canonicalIssuer,
} from "nodefony";
import type { IUser, IOAuthUserProvisioner } from "@nodefony/user";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineModuleConfig";
import { AuthenticationError } from "../errors/AuthenticationError";
import type { IOAuthProvider } from "../contracts/IOAuthProvider";
import {
  getOAuthProviderFactory,
  listOAuthProviders,
  oauthProviderRequiresIssuer,
} from "../src/oauth/oauthProviderRegistry";
import { generateCodeVerifier, generateState } from "../src/oauth/oauth2Client";

const serviceName = "oauth2";

/**
 * Clé de session de l'indice de déconnexion. Lue et écrite par CE service
 * seulement ({@link OAuth2Service.rememberLogout},
 * {@link OAuth2Service.logoutUrlFor}) : les contrôleurs ne la connaissent pas.
 */
const LOGOUT_HINT_KEY = "oauth2:logout";

/**
 * Ce que la session retient d'un login fédéré pour pouvoir fermer AUSSI la
 * session du fournisseur (RP-Initiated Logout). Stocké côté serveur ; l'ID
 * token ne traverse le navigateur qu'une fois, dans l'adresse de déconnexion
 * (`id_token_hint`), la session locale déjà détruite.
 *
 * @remarks L'ID token est une exception assumée à « les jetons du fournisseur
 * ne sont pas conservés » : il n'ouvre aucun accès (ni API, ni rafraîchissement),
 * il désigne la session à fermer. Jetons d'accès et de rafraîchissement restent
 * jetés.
 */
export interface IFederatedLogoutHint {
  /** Fournisseur qui a ouvert la session. */
  readonly provider: string;
  /** ID token reçu au login, rejoué en `id_token_hint`. */
  readonly idToken: string;
  /** Identifiant de session du fournisseur (claim `sid`), ou `null`. */
  readonly sid: string | null;
}

/** Vue minimale d'une session — celle que porte le contexte. */
interface IHintSession {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

/** Relit un indice de session — il vient du stockage, sa forme se vérifie. */
function readLogoutHint(value: unknown): IFederatedLogoutHint | null {
  if (typeof value !== "object" || value === null) return null;
  const { provider, idToken, sid } = value as Record<string, unknown>;
  if (typeof provider !== "string" || typeof idToken !== "string") return null;
  return { provider, idToken, sid: typeof sid === "string" ? sid : null };
}

/**
 * Sigles qui se lisent en capitales — les capitaliser mot à mot rendrait
 * « Oidc », « Sso », qu'aucun utilisateur ne reconnaît comme la technologie.
 */
const ACRONYMS = new Set(["oidc", "sso", "saml", "ldap", "cas", "adfs", "iam"]);

/**
 * Marques dont la casse INTERNE ne se devine pas d'un nom en minuscules.
 *
 * Capitaliser la première lettre rendrait « Github », que la marque n'écrit
 * jamais ainsi — et c'est précisément le nom que l'utilisateur cherche des yeux
 * sur un bouton. Vu à l'écran, pas déduit : la première version de cette
 * fonction affichait « Github » là où la console montrait « GitHub » avant.
 */
const CANONICAL_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  keycloak: "Keycloak",
  microsoft: "Microsoft",
  auth0: "Auth0",
  okta: "Okta",
  linkedin: "LinkedIn",
  paypal: "PayPal",
  youtube: "YouTube",
};

/**
 * Libellé affichable d'un fournisseur, quand sa configuration n'en donne pas.
 *
 * Un écran de connexion ne doit JAMAIS montrer un identifiant technique brut :
 * `mon-idp-interne` sur un bouton ne dit rien à qui doit cliquer. À défaut de
 * marque connue, le nom de la clé de configuration est ce qui s'en rapproche le
 * plus — mais rendu lisible : séparateurs en espaces, initiales en capitales,
 * sigles préservés.
 *
 * Fonction PURE, donc éprouvable sans boot ni réseau.
 *
 * @param name - nom du fournisseur, tel qu'il est écrit dans la configuration
 * @returns le libellé à afficher sur le bouton
 */
export function oauthDisplayLabel(name: string): string {
  const canonical = CANONICAL_LABELS[name.toLowerCase()];
  if (canonical !== undefined) return canonical;
  return name
    .split(/[-_.\s]+/)
    .filter((word) => word.length > 0)
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/** Un fournisseur tel que l'écran de connexion doit le présenter. */
export interface IOAuthDisplayProvider {
  /** Nom technique — celui que l'URL `/authorize` attend. */
  readonly name: string;
  /** Libellé du bouton : celui de la config, sinon dérivé du nom. */
  readonly label: string;
}

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
 * Délai avant de retenter un fournisseur dont la construction a échoué — assez
 * long pour ne pas marteler un émetteur en panne à chaque affichage de l'écran
 * de connexion, assez court pour qu'un bouton revienne sans redémarrage.
 */
const UNREACHABLE_RETRY_MS = 30_000;

/**
 * Confronte l'émetteur configuré d'un fournisseur à ce que sa fabrique exige.
 *
 * Une URL qui ne peut pas être un émetteur est refusée QUEL QUE SOIT le
 * fournisseur : aucune valeur mal formée n'est une configuration voulue. Une
 * absence ne l'est que si la fabrique a déclaré l'émetteur requis.
 *
 * @param name - nom du fournisseur (`oauth2.providers.<name>`).
 * @param issuer - émetteur lu dans sa configuration.
 * @throws BootConfigurationError - émetteur requis absent, ou mal formé.
 */
export function checkProviderIssuer(
  name: string,
  issuer: string | undefined,
): void {
  const key = `security.oauth2.providers.${name}.issuer`;
  if (issuer === undefined || issuer === "") {
    if (oauthProviderRequiresIssuer(name)) {
      throw new BootConfigurationError(
        `[@nodefony/security] ${key} est requis : le fournisseur « ${name} » ` +
          `découvre ses points d'entrée à partir de son émetteur. Attendu : ` +
          `l'URL https de l'émetteur OpenID Connect (Keycloak : URL du realm, ` +
          `ex. « https://auth.example.com/realms/mon-royaume »).`,
      );
    }
    return;
  }
  try {
    canonicalIssuer(issuer);
  } catch (error) {
    throw new BootConfigurationError(
      `[@nodefony/security] ${key} — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * **Social login OAuth 2.0** (P6 J9) — orchestrateur du flux *Authorization Code*.
 *
 * Posture OAuth 2.1 (RFC 9700) : Authorization Code uniquement (jamais implicit /
 * ROPC), **PKCE S256** quand le fournisseur le supporte (RFC 7636), **state**
 * anti-CSRF, **iss** anti-mix-up (RFC 9207) ; aucun jeton d'accès n'atteint le
 * navigateur (le login produit une **session BFF**, gérée hors de ce service par
 * le controller + `AuthFlow`) — seul l'ID token y passe, une fois, à la
 * déconnexion ({@link IFederatedLogoutHint}).
 *
 * Au boot (si `oauth2.enabled`), la configuration de chaque fournisseur est
 * confrontée à ce que sa fabrique exige : un émetteur requis absent, ou qui n'est
 * pas une URL d'émetteur valide, INTERROMPT le démarrage en nommant la clé — une
 * faute d'écriture ne doit pas attendre le premier clic pour se montrer. Un nom
 * inconnu du registre reste un WARNING.
 *
 * Les fournisseurs sont construits une fois puis mémoïsés : c'est là que les
 * points d'entrée d'un émetteur OIDC sont découverts. Un run qui sert (ports
 * ouverts) les construit DÈS le boot, sans l'attendre : un émetteur injoignable
 * n'est pas une faute de configuration, il se journalise et son bouton quitte
 * l'écran de connexion jusqu'à ce qu'une nouvelle tentative réussisse. Un run
 * console ne touche jamais le réseau.
 *
 * Le service ne touche **ni HTTP ni session** : il rend à l'appelant les éléments
 * (URL, state, verifier) que le controller persiste en session — testable sans
 * transport, comme `AuthFlow`.
 */
class OAuth2Service extends Service {
  #config: ISecurityConfig | null = null;
  // Fournisseurs instanciés, mémoïsés au 1ᵉʳ usage (lazy — pas alloués au boot).
  // C'est la PROMESSE qui est mémoïsée, pas son résultat : deux logins simultanés
  // à froid ne doivent pas déclencher deux découvertes. Une résolution en échec
  // est retirée, sinon une panne passagère de l'émetteur serait définitive.
  #providers: Map<string, Promise<IResolvedProvider>> | null = null;
  // Fournisseurs dont la dernière construction a ÉCHOUÉ → date de l'échec (ms).
  // Lazy : `null` tant que tout va bien, c'est-à-dire presque toujours.
  #unreachable: Record<string, number> | null = null;
  #ready = false;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter,
      module.options,
    );
    // Écouteur NOMMÉ : un refus de configuration au boot désigne son auteur
    // par ce nom — une flèche anonyme s'y affichait « (anonyme) ».
    const oauth2ConfigCheck = (): void => this.#build();
    this.kernel?.once("onBoot", oauth2ConfigCheck);
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
    const active = configured.filter((n) => known.has(n));
    for (const name of active) {
      checkProviderIssuer(name, config.oauth2.providers[name]?.issuer);
    }
    this.#config = config;
    this.#ready = true;
    this.log(
      `oauth2 ready — providers: [${active.join(", ") || "aucun"}]`,
      "DEBUG",
    );
    // Seul un run qui SERT montre un écran de connexion : une commande console
    // n'a ni bouton à retirer ni raison de joindre un fournisseur.
    if (this.kernel?.runProfile.servers === true) {
      for (const name of active) {
        this.#probe(name);
      }
    }
  }

  /**
   * Construit un fournisseur sans attendre le résultat — l'échec est consigné
   * par {@link #resolveProvider}, rien n'est levé vers l'appelant.
   */
  #probe(name: string): void {
    this.#resolveProvider(name).catch(() => undefined);
  }

  /** `true` si le social login est opérationnel (activé + boot OK). */
  isEnabled(): boolean {
    return this.#ready;
  }

  /**
   * Noms des fournisseurs OPÉRATIONNELS — configurés ET connus du registre.
   *
   * 🔴 C'est la **garde d'autorisation** : `/authorize` refuse en 404 tout nom
   * absent de cette liste. Elle répond donc à « ce flux peut-il s'ouvrir ? »,
   * jamais à « ce bouton doit-il s'afficher ? » — pour l'écran, voir
   * {@link listDisplayProviders}. Confondre les deux ferait d'un masquage une
   * désactivation, et couperait les bancs qui exercent une fixture masquée.
   */
  listProviders(): string[] {
    if (!this.#ready || this.#config === null) {
      return [];
    }
    const known = new Set(listOAuthProviders());
    return Object.keys(this.#config.oauth2.providers).filter((n) =>
      known.has(n),
    );
  }

  /**
   * Fournisseurs à MONTRER sur l'écran de connexion, libellés compris.
   *
   * Rend TOUT fournisseur opérationnel — y compris ceux dont le framework ne
   * connaît pas la marque, qui sont précisément ceux qu'une application
   * enregistre elle-même. Le seul retrait possible est explicite et se lit dans
   * la configuration du fournisseur (`hidden: true`), à côté de la raison qui
   * l'a motivé ; il ne désactive rien.
   */
  listDisplayProviders(): IOAuthDisplayProvider[] {
    if (this.#config === null) {
      return [];
    }
    const configured = this.#config.oauth2.providers;
    return (
      this.listProviders()
        // `hidden` est un booléen validé par Zod (défaut `false`) : la négation
        // suffit, et un fournisseur absent (`undefined`) reste montré, comme avant.
        .filter((name) => !configured[name]?.hidden)
        // Un bouton qui mène à une erreur est pire que pas de bouton. Le
        // fournisseur reste ouvert pour qui l'atteint directement : seule
        // l'offre disparaît, et revient dès qu'une tentative réussit.
        .filter((name) => this.#isReachable(name))
        .map((name) => ({
          name,
          label: configured[name]?.label ?? oauthDisplayLabel(name),
        }))
    );
  }

  /**
   * Redirections post-login (succès / échec) — lues par le controller.
   * Surcharge PAR FOURNISSEUR si fournie, sinon valeur globale, sinon défaut.
   */
  getRedirects(provider?: string): { success: string; failure: string } {
    const o = this.#config?.oauth2;
    const p = provider ? o?.providers[provider] : undefined;
    return {
      success: p?.successRedirect ?? o?.successRedirect ?? "/",
      failure: p?.failureRedirect ?? o?.failureRedirect ?? "/login",
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
    const state = generateState();
    const codeVerifier = resolved.provider.usesPkce
      ? generateCodeVerifier()
      : null;
    const url = resolved.provider.createAuthorizationURL({
      state,
      codeVerifier,
      scopes: resolved.scopes,
    });
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
  ): Promise<{
    identifier: string;
    logoutHint: IFederatedLogoutHint | null;
  }> {
    const { provider: p } = await this.#resolveProvider(provider);
    // Anti-mix-up (RFC 9207) : un `iss` PRÉSENT doit toujours correspondre ; son
    // ABSENCE n'est une faute que si le serveur avait annoncé l'émettre — refuser
    // un serveur qui ne l'a jamais promis reviendrait à refuser un serveur
    // conforme (§2.4 : « if the parameter is present »).
    const policy = p.issuerPolicy;
    if (policy !== null) {
      if (returnedIss !== null && returnedIss !== policy.issuer) {
        throw new AuthenticationError("OAuth issuer mismatch");
      }
      if (returnedIss === null && policy.requireIssParameter) {
        throw new AuthenticationError("OAuth issuer missing");
      }
    }
    const tokens = await p.validateAuthorizationCode({ code, codeVerifier });
    const profile = await p.fetchProfile(tokens);
    // `#resolveProvider` a déjà vérifié l'initialisation : ce rappel ne lève
    // donc jamais ici, il rend la config typée non nulle.
    const cfg = this.#ensureReady().oauth2;
    // Rôles par défaut : surcharge PAR FOURNISSEUR sinon valeur globale (posés à
    // la CRÉATION seulement — OAuth = authentification, pas autorisation).
    const defaultRoles =
      cfg.providers[provider]?.defaultRoles ?? cfg.defaultRoles;
    const user: IUser = await this.#resolveProvisioner().provisionOAuthUser(
      profile,
      { defaultRoles: [...defaultRoles], allowSignup: cfg.allowSignup },
    );
    // L'ID token n'est retenu QUE si le fournisseur sait fermer sa session :
    // sans adresse de déconnexion, il ne servirait à rien.
    let logoutHint: IFederatedLogoutHint | null = null;
    if (p.createLogoutURL !== undefined) {
      const sid = (profile.raw as Record<string, unknown> | undefined)?.sid;
      logoutHint = {
        provider,
        idToken: tokens.idToken(),
        sid: typeof sid === "string" ? sid : null,
      };
    }
    return { identifier: user.identifier, logoutHint };
  }

  /**
   * Retient en session l'indice de déconnexion d'un login fédéré — à appeler
   * APRÈS l'ouverture de la session authentifiée (l'ID de session est
   * régénéré à l'ouverture).
   *
   * @param session - session authentifiée de la requête.
   * @param hint - indice rendu par {@link exchangeAndProvision}, ou `null`.
   */
  rememberLogout(
    session: IHintSession,
    hint: IFederatedLogoutHint | null,
  ): void {
    if (hint !== null) session.set(LOGOUT_HINT_KEY, hint);
  }

  /**
   * Adresse de déconnexion chez le fournisseur qui a ouvert la session, ou
   * `null` : session locale, fournisseur sans point de déconnexion, ou
   * fournisseur devenu indisponible. À lire AVANT de détruire la session.
   *
   * @param session - session courante, ou `null`.
   * @returns l'URL vers laquelle envoyer le navigateur, ou `null`.
   */
  async logoutUrlFor(session: IHintSession | null): Promise<string | null> {
    const hint = readLogoutHint(session?.get(LOGOUT_HINT_KEY));
    if (hint === null || !this.#ready) return null;
    let p: IOAuthProvider;
    try {
      ({ provider: p } = await this.#resolveProvider(hint.provider));
    } catch {
      // Fournisseur retiré de la configuration ou injoignable : la session
      // locale se ferme quand même, la déconnexion n'en dépend pas.
      return null;
    }
    if (p.createLogoutURL === undefined) return null;
    return p
      .createLogoutURL({
        idTokenHint: hint.idToken,
        postLogoutRedirectUri: this.#postLogoutRedirectUri(hint.provider),
      })
      .toString();
  }

  /**
   * Retour après déconnexion chez le fournisseur : la valeur configurée, sinon
   * l'écran d'échec (la page de connexion) résolu contre `redirectUri` — une
   * adresse ABSOLUE, sur une origine déjà enregistrée chez le fournisseur.
   *
   * @remarks Query et fragment de l'écran d'échec sont RETIRÉS : ils signalent
   * un échec (`?error=oauth`), et un fournisseur OpenID Connect refuse une
   * adresse de retour qui porte un paramètre du protocole (`error`, `code`…) —
   * Keycloak répond `invalid_redirect_uri`.
   */
  #postLogoutRedirectUri(provider: string): string {
    const cfg = this.#ensureReady().oauth2.providers[provider];
    if (cfg?.postLogoutRedirectUri !== undefined) {
      return cfg.postLogoutRedirectUri;
    }
    const { failure } = this.getRedirects(provider);
    const url = new URL(failure, cfg?.redirectUri);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  #resolveProvider(name: string): Promise<IResolvedProvider> {
    this.#ensureReady();
    this.#providers ??= new Map();
    const cached = this.#providers.get(name);
    if (cached) {
      return cached;
    }
    const pending = this.#buildProvider(name);
    this.#providers.set(name, pending);
    pending.then(
      () => {
        if (this.#unreachable !== null && name in this.#unreachable) {
          delete this.#unreachable[name];
          this.log(`oauth2 provider "${name}" de nouveau joignable`, "INFO");
        }
      },
      (error: unknown) => {
        this.#providers?.delete(name);
        this.#unreachable ??= Object.create(null) as Record<string, number>;
        this.#unreachable[name] = Date.now();
        this.log(
          `oauth2 provider "${name}" indisponible — bouton retiré de l'écran de connexion : ${
            error instanceof Error ? error.message : String(error)
          }`,
          "WARNING",
        );
      },
    );
    return pending;
  }

  /**
   * `true` si le fournisseur n'a pas échoué récemment. Un échec plus ancien que
   * {@link UNREACHABLE_RETRY_MS} relance une construction en arrière-plan : sans
   * elle, un bouton retiré ne reviendrait jamais, puisque plus personne ne
   * pourrait cliquer pour déclencher la tentative suivante.
   */
  #isReachable(name: string): boolean {
    const failedAt = this.#unreachable?.[name];
    if (failedAt === undefined) {
      return true;
    }
    if (
      Date.now() - failedAt >= UNREACHABLE_RETRY_MS &&
      !this.#providers?.has(name)
    ) {
      this.#probe(name);
    }
    return false;
  }

  async #buildProvider(name: string): Promise<IResolvedProvider> {
    const providers = this.#ensureReady().oauth2.providers;
    // `hasOwn` : un nom venu de l'URL (`constructor`, `toString`) ne doit pas
    // lire le prototype d'une config qui est un objet ordinaire.
    const cfg = Object.hasOwn(providers, name) ? providers[name] : undefined;
    if (!cfg) {
      throw new AuthenticationError(`OAuth provider "${name}" non configuré`);
    }
    const factory = getOAuthProviderFactory(name);
    if (!factory) {
      throw new AuthenticationError(
        `OAuth provider "${name}" inconnu du registre`,
      );
    }
    const provider = await factory({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      clientAuthMethod: cfg.clientAuthMethod,
      redirectUri: cfg.redirectUri,
      issuer: cfg.issuer,
    });
    const scopes = cfg.scopes.length > 0 ? cfg.scopes : provider.defaultScopes;
    return { provider, scopes };
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

  #ensureReady(): ISecurityConfig {
    if (!this.#ready || this.#config === null) {
      throw new Error(
        "OAuth2Service: non initialisé (social login désactivé ou boot échoué)",
      );
    }
    return this.#config;
  }
}

export default OAuth2Service;
export { OAuth2Service };
