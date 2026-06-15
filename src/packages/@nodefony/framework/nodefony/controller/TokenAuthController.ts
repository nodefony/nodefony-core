import type { Module } from "nodefony";
import type { ContextType, HTTPMethod } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";

/**
 * Vue MINIMALE du service d'émission de jetons (`tokenService`, posé au container
 * par `@nodefony/security` P6 J4). Contrat structurel local : framework ne dépend
 * JAMAIS de security — couplage par nom de service (comme `authFlow`/`adminBroker`).
 */
export interface ITokenIssuer {
  /** `true` si l'émission JWT est opérationnelle (JWT activé + store prêt). */
  isEnabled(): boolean;
  /** Émet access+refresh après vérification d'un credential (grant M2M/CLI). */
  issueForCredentials(
    identifier: unknown,
    password: unknown,
    scopes?: string[],
  ): Promise<unknown>;
  /** Rotation d'un refresh token (nouveau couple, ancien révoqué). */
  refresh(rawRefresh: unknown): Promise<unknown>;
}

// Montage one-shot par process (même sémantique que `mountSessionAuthRoutes`).
let mounted = false;

/** Normalise le paramètre `scope` (string OAuth « a b c » ou tableau) → string[]. */
function parseScope(scope: unknown): string[] | undefined {
  if (typeof scope === "string" && scope.trim().length > 0) {
    return scope.trim().split(/\s+/);
  }
  if (Array.isArray(scope)) {
    return scope.filter((s): s is string => typeof s === "string");
  }
  return undefined;
}

/**
 * Endpoints HTTP d'émission/rotation de **JWT** — adaptateurs MINCES au-dessus du
 * service `tokenService` (`@nodefony/security`) :
 *
 *  - `POST /nodefony/security/api/token`         — body `{username, password, scope?}`
 *    → `{access_token, refresh_token, token_type, expires_in, scope}` (RFC 6749 §5.1)
 *  - `POST /nodefony/security/api/token/refresh` — body `{refresh_token}` → rotation
 *
 * Montés par le module framework UNIQUEMENT si le service `tokenService` existe
 * (module security chargé + JWT activé) — sans lui, les routes n'existent pas
 * (404, zéro surface).
 *
 * Le JWT part en **réponse JSON** (Bearer), JAMAIS en cookie ni en URL (anti
 * fuite / non-révocable). Erreurs mappées par DUCK-TYPING sur `code` (401/429) —
 * framework ne peut pas importer les classes d'erreur de security ; un 429
 * reporte le `Retry-After` (RFC 6585) du throttler NIST.
 *
 * @remarks Dérogation RFC 7235 §3.1 (comme `SessionAuthController`) : ces 401 ne
 * portent pas de `WWW-Authenticate` — l'endpoint d'émission n'est pas une
 * ressource protégée par Bearer, il DÉLIVRE le Bearer.
 */
class TokenAuthController extends Controller {
  constructor(context: ContextType) {
    super("TokenAuthController", context);
  }

  /** Émission : credential présenté → couple access/refresh. */
  async token() {
    const svc = this.#issuer();
    if (!svc || !svc.isEnabled()) {
      return this.renderJson({ error: "Token issuance unavailable" }, 503);
    }
    const body = (this.queryPost ?? {}) as {
      username?: unknown;
      password?: unknown;
      scope?: unknown;
    };
    try {
      const tokens = await svc.issueForCredentials(
        body.username,
        body.password,
        parseScope(body.scope),
      );
      return this.renderJson(tokens);
    } catch (e) {
      return this.#renderAuthError(e);
    }
  }

  /** Rotation : refresh présenté → nouveau couple (ancien révoqué). */
  async refresh() {
    const svc = this.#issuer();
    if (!svc || !svc.isEnabled()) {
      return this.renderJson({ error: "Token issuance unavailable" }, 503);
    }
    const body = (this.queryPost ?? {}) as { refresh_token?: unknown };
    try {
      const tokens = await svc.refresh(body.refresh_token);
      return this.renderJson(tokens);
    } catch (e) {
      return this.#renderAuthError(e);
    }
  }

  #issuer(): ITokenIssuer | null {
    return this.get<ITokenIssuer>("tokenService") ?? null;
  }

  // 429 → Retry-After (RFC 6585) ; 401 → message uniforme (anti-énumération) ;
  // le reste → pipeline 500 (fail-closed, zéro fuite).
  #renderAuthError(e: unknown) {
    const code = (e as { code?: unknown }).code;
    if (code === 429) {
      const retry = (e as { retryAfterS?: unknown }).retryAfterS;
      return this.renderJson({ error: "Too many attempts" }, 429, {
        "retry-after": String(typeof retry === "number" ? retry : 1),
      });
    }
    if (code === 401) {
      return this.renderJson({ error: "invalid_grant" }, 401);
    }
    throw e;
  }
}

/**
 * Monte les routes d'émission/rotation JWT — appelé par le module framework à
 * `onKernelReady`, seulement si le service `tokenService` est présent.
 *
 * Routes nommées `security.token.*` (espace data plane `/nodefony/security/api/*`).
 * `bypassFirewall: true` : ces routes SONT le mécanisme d'émission — l'aire data
 * plane les matcherait sinon (obtenir un token exigerait d'être déjà authentifié,
 * deadlock).
 */
export function mountTokenAuthRoutes(frameworkModule: Module): void {
  if (mounted) return;
  const base = "/nodefony/security/api/token";
  const routes: Array<[string, string, HTTPMethod, string]> = [
    ["security.token.issue", base, "POST", "token"],
    ["security.token.refresh", `${base}/refresh`, "POST", "refresh"],
  ];
  for (const [name, path, method, classMethod] of routes) {
    Router.createRoute(name, {
      path,
      constructor: TokenAuthController as unknown as Controller["constructor"],
      classMethod,
      requirements: { methods: [method] },
      bypassFirewall: true,
    });
  }
  if (
    !Object.prototype.hasOwnProperty.call(
      TokenAuthController.prototype,
      "module",
    )
  ) {
    Router.setController(
      TokenAuthController as unknown as Parameters<
        typeof Router.setController
      >[0],
      frameworkModule,
    );
  }
  mounted = true;
}

export default TokenAuthController;
