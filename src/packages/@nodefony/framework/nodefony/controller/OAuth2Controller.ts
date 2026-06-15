import type { Module } from "nodefony";
import type { ContextType, HTTPMethod } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";

/**
 * Vue MINIMALE du service `oauth2` (`@nodefony/security`) — couplage par NOM
 * (framework ne dépend ni de security ni d'arctic). Contrat structurel imposé par
 * cast (`this.get<…>`), aucune liaison de build.
 */
export interface IOAuth2Service {
  isEnabled(): boolean;
  listProviders(): string[];
  getRedirects(provider?: string): { success: string; failure: string };
  createAuthorization(provider: string): Promise<{
    url: string;
    state: string;
    codeVerifier: string | null;
  }>;
  exchangeAndProvision(
    provider: string,
    code: string,
    codeVerifier: string | null,
    returnedIss: string | null,
  ): Promise<{ identifier: string }>;
}

/** Vue minimale d'une session — porte l'état du flux OAuth (anti-CSRF/anti-replay). */
export interface IOAuth2Session {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  save(): Promise<unknown>;
}

/** Vue minimale du flux de session BFF (`authFlow`) consommée ici. */
export interface IOAuth2BffFlow {
  establishSessionFor(
    context: ContextType,
    identifier: string,
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
class OAuth2Controller extends Controller {
  constructor(context: ContextType) {
    super("OAuth2Controller", context);
  }

  /**
   * Liste PUBLIQUE des fournisseurs activés (configurés ET connus du registre).
   * Consommé par l'UI de login pour n'afficher QUE les boutons opérationnels —
   * jamais de bouton mort. Aucun secret n'est exposé (uniquement les noms).
   */
  providers() {
    const svc = this.#service();
    return this.renderJson({ providers: svc ? svc.listProviders() : [] });
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
    const auth = await svc.createAuthorization(provider);
    const session = await flow.ensureSession(this.context as ContextType);
    if (!session) {
      return this.renderJson({ error: "Session unavailable" }, 503);
    }
    session.set(STATE_KEY, auth.state);
    session.set(VERIFIER_KEY, auth.codeVerifier);
    session.set(PROVIDER_KEY, provider);
    await session.save(); // PERSISTE l'état (storage), pas juste en mémoire
    return this.redirect(auth.url, 302);
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
    if (
      code === null ||
      returnedState === null ||
      typeof expectedState !== "string" ||
      returnedState !== expectedState ||
      expectedProvider !== provider
    ) {
      return this.redirect(failure, 302);
    }

    try {
      const { identifier } = await svc.exchangeAndProvision(
        provider,
        code,
        typeof storedVerifier === "string" ? storedVerifier : null,
        returnedIss,
      );
      // Promotion anonyme → authentifié (regenerateId anti-fixation côté AuthFlow).
      await flow.establishSessionFor(this.context as ContextType, identifier);
      return this.redirect(success, 302);
    } catch {
      // iss invalide / échange refusé / provisioning impossible → échec uniforme.
      return this.redirect(failure, 302);
    }
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  #service(): IOAuth2Service | null {
    const svc = this.get<IOAuth2Service>("oauth2");
    return svc && svc.isEnabled() ? svc : null;
  }

  #flow(): IOAuth2BffFlow | null {
    return this.get<IOAuth2BffFlow>("authFlow") ?? null;
  }

  /** Lit un paramètre de query string (GET), ou `null`. */
  #queryString(key: string): string | null {
    const v = (this.queryGet ?? {})[key];
    return typeof v === "string" && v.length > 0 ? v : null;
  }
}

/**
 * Monte les routes du social login OAuth — appelé par le module framework à
 * `onKernelReady`, seulement si le service `oauth2` est présent.
 */
export function mountOAuth2Routes(frameworkModule: Module): void {
  if (mounted) return;
  const base = "/nodefony/security/api/oauth2";
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
  ];
  for (const [name, path, method, classMethod] of routes) {
    Router.createRoute(name, {
      path,
      constructor: OAuth2Controller as unknown as Controller["constructor"],
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
    Router.setController(
      OAuth2Controller as unknown as Parameters<typeof Router.setController>[0],
      frameworkModule,
    );
  }
  mounted = true;
}

export default OAuth2Controller;
