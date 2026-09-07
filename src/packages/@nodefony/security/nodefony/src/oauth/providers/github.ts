import type { OAuth2Tokens } from "../oauth2Client";
import { OAuth2Client } from "../oauth2Client";
import { readJsonBounded } from "../httpJson";
import type { IOAuthProfile } from "@nodefony/user";
import type { IOAuthProvider } from "../../../contracts/IOAuthProvider";
import type { IOAuthProviderContext } from "../oauthProviderRegistry";

/** Scopes minimaux : profil public + emails (l'email primaire peut être privé). */
const DEFAULT_SCOPES = ["read:user", "user:email"];
const API = "https://api.github.com";

/** Une API muette ne doit pas retenir le callback jusqu'aux délais du runtime. */
const API_TIMEOUT_MS = 10_000;

/** Au-delà, ce n'est plus un profil : on refuse de lire. */
const MAX_PROFILE_BYTES = 1024 * 1024;

// GitHub ne publie aucun document de métadonnées (RFC 8414) : ses points d'entrée
// sont fixes et documentés. Ce sont les seuls du module écrits en dur.
const AUTHORIZATION_ENDPOINT = "https://github.com/login/oauth/authorize";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";

// En-têtes API GitHub : Bearer + version d'API + User-Agent (exigé par GitHub).
function ghHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "nodefony",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghGet(url: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: ghHeaders(accessToken),
    // Mêmes gardes que l'échange du code : ni redirection suivie, ni attente
    // sans fin, ni corps sans borne.
    redirect: "error",
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${url} → ${res.status}`);
  }
  return readJsonBounded(res, MAX_PROFILE_BYTES, `GitHub API ${url}`);
}

/**
 * Fournisseur **GitHub** (OAuth 2.0 simple, NON-OIDC). Pas de PKCE, pas d'ID
 * token : le profil est lu via l'API REST (`/user`), et l'email — souvent privé —
 * via `/user/emails` (scope `user:email`). GitHub n'émet pas de paramètre `iss`
 * (`issuerPolicy = null`) : la défense anti-CSRF repose sur le `state`.
 */
export function createGithubProvider(
  ctx: IOAuthProviderContext,
): IOAuthProvider {
  const client = new OAuth2Client({
    authorizationEndpoint: AUTHORIZATION_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: ctx.clientId,
    clientSecret: ctx.clientSecret,
    // GitHub accepte Basic et le corps ; Basic est ce que la RFC 6749 §2.3.1
    // demande de préférer, et c'est ce que ce fournisseur faisait déjà — le
    // défaut est écrit, il n'est plus déduit d'une longueur de chaîne.
    clientAuthMethod: ctx.clientAuthMethod ?? "client_secret_basic",
    redirectUri: ctx.redirectUri,
  });
  return {
    usesPkce: false,
    issuerPolicy: null,
    defaultScopes: DEFAULT_SCOPES,
    createAuthorizationURL(request) {
      // GitHub ne veut pas de PKCE : le secret de l'appelant est écarté ici, et
      // nulle part ailleurs — le reste de la demande passe intact.
      return client.createAuthorizationURL({ ...request, codeVerifier: null });
    },
    validateAuthorizationCode(request) {
      return client.validateAuthorizationCode({
        ...request,
        codeVerifier: null,
      });
    },
    async fetchProfile(tokens: OAuth2Tokens): Promise<IOAuthProfile> {
      const accessToken = tokens.accessToken();
      const user = (await ghGet(`${API}/user`, accessToken)) as Record<
        string,
        unknown
      >;
      const id = user.id;
      if (typeof id !== "number" && typeof id !== "string") {
        throw new Error("GitHub /user sans identifiant.");
      }
      const login = typeof user.login === "string" ? user.login : null;
      const name = typeof user.name === "string" ? user.name : login;

      // Email public direct (alors vérifié), sinon endpoint dédié (peut être privé).
      let email = typeof user.email === "string" ? user.email : null;
      let emailVerified = email !== null;
      if (email === null) {
        const list = (await ghGet(`${API}/user/emails`, accessToken)) as Array<
          Record<string, unknown>
        >;
        const primary = list.find((e) => e.primary === true) ?? list[0] ?? null;
        if (primary && typeof primary.email === "string") {
          email = primary.email;
          emailVerified = primary.verified === true;
        }
      }
      return {
        provider: "github",
        providerId: String(id),
        email,
        emailVerified,
        name,
        raw: user,
      };
    },
  };
}
