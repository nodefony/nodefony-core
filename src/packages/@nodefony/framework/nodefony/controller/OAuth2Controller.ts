import { OAUTH2_API_BASE, type Module } from "nodefony";
import type { ContextType, HTTPMethod } from "@nodefony/http";
import Router from "../service/router";
import SecurityApiController from "../src/SecurityApiController";

/**
 * Vue MINIMALE du service `oauth2` (`@nodefony/security`) — couplage par NOM
 * (framework ne dépend pas de security). Contrat structurel imposé par
 * cast (`this.get<…>`), aucune liaison de build.
 */
export interface IOAuth2Service {
  isEnabled(): boolean;
  /** Fournisseurs OPÉRATIONNELS — la garde de `/authorize`, jamais l'affichage. */
  listProviders(): string[];
  /**
   * Fournisseurs à AFFICHER, libellés compris. Optionnel à dessein : le
   * couplage à `@nodefony/security` se fait par NOM, sans liaison de build —
   * une version du module qui ne l'expose pas encore doit dégrader, pas
   * casser l'écran de connexion (repli sur {@link listProviders}).
   */
  listDisplayProviders?(): { name: string; label: string }[];
  getRedirects(provider?: string): { success: string; failure: string };
  /** `options` : une version de security qui ne le lit pas l'ignore. */
  createAuthorization(
    provider: string,
    options?: { theme?: "light" | "dark" },
  ): Promise<{
    url: string;
    state: string;
    codeVerifier: string | null;
  }>;
  exchangeAndProvision(
    provider: string,
    code: string,
    codeVerifier: string | null,
    returnedIss: string | null,
  ): Promise<{ identifier: string; logoutHint?: unknown }>;
  /**
   * Retient en session de quoi fermer plus tard la session du fournisseur
   * (RP-Initiated Logout). Optionnel : la clé et la forme appartiennent au
   * service, ce contrôleur ne fait que transmettre.
   */
  rememberLogout?(session: IOAuth2Session, hint: unknown): void;
  /**
   * Déconnexion demandée par le fournisseur sur le canal arrière (OpenID
   * Connect Back-Channel Logout). Optionnel, même raison que
   * {@link listDisplayProviders} : absent, la route répond 501.
   */
  backchannelLogout?(
    provider: string,
    logoutToken: string,
  ): Promise<{ outcome: "unsupported" | "refused" | "done" }>;
}

/** Vue minimale d'une session — porte l'état du flux OAuth (anti-CSRF/anti-replay). */
export interface IOAuth2Session {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  save(): Promise<unknown>;
}

/** Vue minimale du flux de session BFF (`authFlow`) consommée ici. */
export interface IOAuth2BffFlow {
  /**
   * @param reason - facteur d'authentification journalisé par l'audit
   *   (`"oauth"` ici). Omis, il retombe sur `"federated"`, qui ne distingue plus
   *   un login social d'une passkey dans le journal.
   */
  establishSessionFor(
    context: ContextType,
    identifier: string,
    reason?: string,
  ): Promise<unknown>;
  /** Garantit une session (anonyme) pour porter `state`/`code_verifier`. */
  ensureSession(context: ContextType): Promise<IOAuth2Session | null>;
}

// Clés de session portant l'état du flux entre `authorize` et `callback`
// (anti-CSRF/anti-replay, à usage unique). Le `code_verifier` PKCE n'est JAMAIS
// exposé au navigateur autrement qu'en cookie de session opaque HttpOnly.
const STATE_KEY = "oauth2:state";
const VERIFIER_KEY = "oauth2:verifier";
const PROVIDER_KEY = "oauth2:provider";

// Montage one-shot par process (même sémantique que `mountWebAuthnRoutes`).
let mounted = false;

/**
 * Codes d'erreur qu'un serveur d'autorisation peut renvoyer au callback, et
 * SEULS codes que l'écran d'arrivée reçoit : OAuth 2.0 (RFC 6749 §4.1.2.1) et
 * OpenID Connect Core (§3.1.2.6). Une liste fermée — jamais la chaîne reçue
 * telle quelle : le paramètre `error` vient de l'URL, donc de n'importe qui.
 */
const AUTHORIZATION_ERRORS: ReadonlySet<string> = new Set([
  "invalid_request",
  "unauthorized_client",
  "access_denied",
  "unsupported_response_type",
  "invalid_scope",
  "server_error",
  "temporarily_unavailable",
  "interaction_required",
  "login_required",
  "account_selection_required",
  "consent_required",
]);

/**
 * Thème que la page appelante a rendu (`?theme=`), à transmettre à l'écran du
 * fournisseur. Liste FERMÉE : la chaîne vient de l'URL, toute autre valeur est
 * ignorée sans un mot — rien d'arbitraire n'atteint la requête d'autorisation.
 *
 * @param value - paramètre `theme` de la requête, ou `null`
 * @returns l'option à passer à `createAuthorization`, vide hors liste
 */
export function providerThemeOption(value: string | null): {
  theme?: "light" | "dark";
} {
  return value === "light" || value === "dark" ? { theme: value } : {};
}

/**
 * Ajoute à l'adresse d'échec le code d'erreur rendu par le fournisseur, pour
 * que l'écran d'arrivée distingue une ANNULATION (`access_denied` : l'utilisateur
 * a choisi de revenir) d'une panne.
 *
 * Le code n'est transmis que s'il appartient à la liste normalisée ; sinon
 * l'adresse est rendue intacte. La requête et le fragment déjà présents sont
 * conservés, et une adresse relative reste relative.
 *
 * @param failure - l'adresse d'échec configurée (`failureRedirect`).
 * @param error - le paramètre `error` reçu au callback, ou `null`.
 * @returns l'adresse d'échec, augmentée de `reason=<code>` si le code est connu.
 */
export function withAuthorizationError(
  failure: string,
  error: string | null,
): string {
  if (error === null || !AUTHORIZATION_ERRORS.has(error)) {
    return failure;
  }
  const hashAt = failure.indexOf("#");
  const base = hashAt === -1 ? failure : failure.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : failure.slice(hashAt);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}reason=${error}${hash}`;
}

/**
 * Endpoints HTTP du **social login OAuth 2.0** (P6 J9) — adaptateurs MINCES
 * au-dessus du service `oauth2` (`@nodefony/security`) :
 *
 *  - `GET /nodefony/security/api/oauth2/{provider}/authorize` — démarre le flux :
 *    pose `state`+`code_verifier` en session (anonyme), redirige (302) vers le
 *    fournisseur.
 *  - `GET /nodefony/security/api/oauth2/{provider}/callback` — valide le `state`
 *    (anti-CSRF), échange le `code`, provisionne le Shadow User et OUVRE la
 *    session BFF (302 vers `successRedirect`).
 *
 * Montés UNIQUEMENT si le service `oauth2` existe (social login activé) — 404
 * sinon, zéro surface.
 *
 * @remarks `bypassFirewall` : ces routes SONT (ou précèdent) le mécanisme d'auth
 * (l'utilisateur est anonyme pendant tout l'aller-retour). Le firewall, sur l'aire
 * data plane, déclencherait un deadlock identique au login BFF / WebAuthn login.
 * La session anonyme ne porte que `state`/`verifier` ; `establishSessionFor`
 * régénère l'ID (anti-fixation) à la promotion.
 */
class OAuth2Controller extends SecurityApiController {
  constructor(context: ContextType) {
    super("OAuth2Controller", context);
  }

  /**
   * Liste PUBLIQUE des fournisseurs à proposer à l'écran de connexion.
   *
   * Rend `{ name, label }` : le libellé vient du serveur, seul à connaître la
   * configuration — un écran ne doit jamais avoir à deviner comment nommer un
   * fournisseur, ni s'autoriser à en masquer un qu'il ne reconnaît pas. Un
   * fournisseur déclaré `hidden` n'y figure pas, mais reste autorisable :
   * masquer n'est pas désactiver. Aucun secret n'est exposé.
   */
  providers() {
    const svc = this.#service();
    if (!svc) {
      return this.renderJson({ providers: [] });
    }
    const providers = svc.listDisplayProviders
      ? svc.listDisplayProviders()
      : svc.listProviders().map((name) => ({ name, label: name }));
    return this.renderJson({ providers });
  }

  /** Démarre le flux : URL d'autorisation + état anti-replay en session, 302. */
  async authorize(provider: string) {
    const svc = this.#service();
    const flow = this.#flow();
    if (!svc || !flow) {
      return this.renderJson({ error: "OAuth unavailable" }, 503);
    }
    if (!svc.listProviders().includes(provider)) {
      return this.renderJson({ error: "Unknown provider" }, 404);
    }
    let auth: Awaited<ReturnType<IOAuth2Service["createAuthorization"]>>;
    try {
      auth = await svc.createAuthorization(
        provider,
        providerThemeOption(this.#queryString("theme")),
      );
    } catch (error) {
      // Les points d'entrée d'un fournisseur OIDC sont DÉCOUVERTS auprès de son
      // émetteur : cette étape parle au réseau. Un émetteur muet ou incohérent est
      // une indisponibilité AMONT (503) — jamais une erreur de ce serveur (500),
      // et jamais une redirection muette vers la page de login.
      this.log(
        `oauth2 authorize "${provider}" : ${(error as Error).message}`,
        "ERROR",
      );
      return this.renderJson({ error: "OAuth provider unavailable" }, 503);
    }
    const session = await flow.ensureSession(this.context as ContextType);
    if (!session) {
      return this.renderJson({ error: "Session unavailable" }, 503);
    }
    session.set(STATE_KEY, auth.state);
    session.set(VERIFIER_KEY, auth.codeVerifier);
    session.set(PROVIDER_KEY, provider);
    await session.save(); // PERSISTE l'état (storage), pas juste en mémoire
    this.redirect(auth.url, 302);
    return undefined;
  }

  /** Valide `state`, échange le `code`, ouvre la session BFF (302). */
  async callback(provider: string) {
    const svc = this.#service();
    const flow = this.#flow();
    if (!svc || !flow) {
      return this.renderJson({ error: "OAuth unavailable" }, 503);
    }
    const { success, failure } = svc.getRedirects(provider);

    // Lit l'état déposé à `authorize`, PUIS l'invalide (usage unique, anti-replay).
    const session = (this.context as ContextType).session;
    const expectedState = session?.get(STATE_KEY);
    const storedVerifier = session?.get(VERIFIER_KEY);
    const expectedProvider = session?.get(PROVIDER_KEY);
    session?.set(STATE_KEY, null);
    session?.set(VERIFIER_KEY, null);
    session?.set(PROVIDER_KEY, null);
    await session?.save();

    const code = this.#queryString("code");
    const returnedState = this.#queryString("state");
    const returnedIss = this.#queryString("iss");

    // Anti-CSRF (RFC 9700) : `state` doit exister, correspondre, et viser le même
    // fournisseur que celui démarré. Sinon → échec, sans contacter le fournisseur.
    const stateIsValid =
      returnedState !== null &&
      typeof expectedState === "string" &&
      returnedState === expectedState &&
      expectedProvider === provider;
    if (code === null || !stateIsValid) {
      // Le fournisseur a répondu par une ERREUR (RFC 6749 §4.1.2.1) — typiquement
      // `access_denied` quand l'utilisateur annule pour choisir une autre
      // méthode. Le code n'est transmis à l'écran d'arrivée que sous un `state`
      // valide : sans lui, n'importe qui pourrait faire afficher « annulé » à la
      // place d'un échec, et l'échec reste uniforme.
      const returnedError =
        code === null && stateIsValid ? this.#queryString("error") : null;
      if (returnedError !== null) {
        // Seul un code de la liste est journalisé : la chaîne reçue vient de
        // l'URL, et un retour à la ligne y forgerait de fausses lignes de log.
        const logged = AUTHORIZATION_ERRORS.has(returnedError)
          ? returnedError
          : "code non normalisé";
        this.log(
          `oauth2 callback "${provider}" : le fournisseur a répondu « ${logged} »`,
          "INFO",
        );
      }
      this.redirect(withAuthorizationError(failure, returnedError), 302);
      return;
    }

    try {
      const { identifier, logoutHint } = await svc.exchangeAndProvision(
        provider,
        code,
        typeof storedVerifier === "string" ? storedVerifier : null,
        returnedIss,
      );
      // Promotion anonyme → authentifié (regenerateId anti-fixation côté AuthFlow).
      await flow.establishSessionFor(
        this.context as ContextType,
        identifier,
        "oauth",
      );
      // APRÈS l'ouverture : c'est la session authentifiée qui doit le porter.
      // Pas de `save()` ici : sans l'utilisateur en argument, il écrirait une
      // session ANONYME et la marquerait propre — la sauvegarde de fin de
      // requête, qui la persiste avec son utilisateur, n'écrirait plus rien.
      const opened = (this.context as ContextType).session;
      if (opened && logoutHint !== undefined && svc.rememberLogout) {
        svc.rememberLogout(opened, logoutHint);
      }
      this.redirect(success, 302);
      return;
    } catch (error) {
      // Le client reçoit un échec UNIFORME (aucune information sur la cause), mais
      // l'exploitant doit pouvoir distinguer un `invalid_grant` d'un émetteur
      // injoignable ou d'un provisioning refusé : sans cette trace, les trois cas
      // se ressemblent — une 302 muette — et « retour systématique sur
      // failureRedirect » n'a aucun instrument derrière lui.
      this.log(
        `oauth2 callback "${provider}" : ${(error as Error).message.slice(0, 200)}`,
        "WARNING",
      );
      this.redirect(failure, 302);
      return undefined;
    }
  }

  /**
   * Canal arrière : le fournisseur demande de fermer les sessions qu'il
   * désigne (OpenID Connect Back-Channel Logout 1.0 §2.5-2.8).
   *
   * Appelé serveur à serveur — ni cookie, ni session, ni jeton CSRF : la
   * SIGNATURE du `logout_token` est la seule authentification. Réponses de la
   * norme (§2.8) : 200 si la déconnexion a eu lieu (ou n'avait plus lieu
   * d'être), 400 sinon — jeton refusé (`invalid_request`) comme déconnexion
   * impossible (la cause part au journal, jamais au fournisseur). Toujours
   * `Cache-Control: no-store`.
   */
  async backchannelLogout(provider: string) {
    const noStore = { "cache-control": "no-store" };
    const svc = this.#service();
    if (!svc || !svc.listProviders().includes(provider)) {
      return this.renderJson({ error: "Unknown provider" }, 404, noStore);
    }
    if (!svc.backchannelLogout) {
      return this.renderJson({ error: "Not implemented" }, 501, noStore);
    }
    const token = (this.queryPost as Record<string, unknown> | undefined)
      ?.logout_token;
    if (typeof token !== "string" || token.length === 0) {
      return this.renderJson({ error: "invalid_request" }, 400, noStore);
    }
    let outcome: "unsupported" | "refused" | "done";
    try {
      ({ outcome } = await svc.backchannelLogout(provider, token));
    } catch (error) {
      this.log(
        `oauth2 back-channel logout "${provider}" : ${(error as Error).message.slice(0, 200)}`,
        "ERROR",
      );
      return this.renderJson({ error: "invalid_request" }, 400, noStore);
    }
    if (outcome === "unsupported") {
      return this.renderJson({ error: "Not implemented" }, 501, noStore);
    }
    if (outcome === "refused") {
      this.log(
        `oauth2 back-channel logout "${provider}" : jeton de déconnexion refusé`,
        "WARNING",
      );
      return this.renderJson({ error: "invalid_request" }, 400, noStore);
    }
    return this.renderResponse("", "utf8", 200, noStore);
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  #service(): IOAuth2Service | null {
    const svc = this.get<IOAuth2Service>("oauth2");
    return svc?.isEnabled() ? svc : null;
  }

  #flow(): IOAuth2BffFlow | null {
    return this.get<IOAuth2BffFlow>("authFlow") ?? null;
  }

  /** Lit un paramètre de query string (GET), ou `null`. */
  #queryString(key: string): string | null {
    const v = (this.queryGet as Record<string, unknown> | undefined)?.[key];
    return typeof v === "string" && v.length > 0 ? v : null;
  }
}

/**
 * Monte les routes du social login OAuth — appelé par le module framework à
 * `onKernelReady`, seulement si le service `oauth2` est présent.
 */
export function mountOAuth2Routes(frameworkModule: Module): void {
  if (mounted) return;
  // Base nommée par le cœur : le déroulé de connexion du navigateur cite
  // les mêmes constantes, une divergence n'a donc plus où naître.
  const base = OAUTH2_API_BASE;
  const routes: Array<[string, string, HTTPMethod, string]> = [
    // Découverte publique (segment littéral `providers` → pas de collision avec
    // `{provider}/...` : profondeurs de chemin distinctes).
    ["security.oauth2.providers", `${base}/providers`, "GET", "providers"],
    [
      "security.oauth2.authorize",
      `${base}/{provider}/authorize`,
      "GET",
      "authorize",
    ],
    [
      "security.oauth2.callback",
      `${base}/{provider}/callback`,
      "GET",
      "callback",
    ],
    [
      "security.oauth2.backchannelLogout",
      `${base}/{provider}/backchannel-logout`,
      "POST",
      "backchannelLogout",
    ],
  ];
  for (const [name, path, method, classMethod] of routes) {
    Router.createRoute(name, {
      path,
      constructor: OAuth2Controller,
      classMethod,
      requirements: { methods: [method] },
      // Le login précède l'authentification : l'aire data plane ne peut pas garder
      // ces routes (cf `mountWebAuthnRoutes`/`mountSessionAuthRoutes`).
      bypassFirewall: true,
    });
  }
  if (
    !Object.prototype.hasOwnProperty.call(OAuth2Controller.prototype, "module")
  ) {
    Router.setController(OAuth2Controller, frameworkModule);
  }
  mounted = true;
}

export default OAuth2Controller;
