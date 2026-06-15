import type { OAuth2Tokens } from "arctic";
import type { IOAuthProfile } from "@nodefony/user";
import type { IOAuthProvider } from "../../../contracts/IOAuthProvider";
import type { IOAuthProviderContext } from "../oauthProviderRegistry";

/** Scopes minimaux : profil public + emails (l'email primaire peut être privé). */
const DEFAULT_SCOPES = ["read:user", "user:email"];
const API = "https://api.github.com";

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
  const res = await fetch(url, { headers: ghHeaders(accessToken) });
  if (!res.ok) {
    throw new Error(`GitHub API ${url} → ${res.status}`);
  }
  return res.json();
}

/**
 * Fournisseur **GitHub** (OAuth 2.0 simple, NON-OIDC). Pas de PKCE, pas d'ID
 * token : le profil est lu via l'API REST (`/user`), et l'email — souvent privé —
 * via `/user/emails` (scope `user:email`). GitHub n'émet pas de paramètre `iss`
 * (`expectedIssuer = null`) : la défense anti-CSRF repose sur le `state`.
 */
export function createGithubProvider(
  ctx: IOAuthProviderContext,
): IOAuthProvider {
  const client = new ctx.arctic.GitHub(
    ctx.clientId,
    ctx.clientSecret,
    ctx.redirectUri,
  );
  return {
    usesPkce: false,
    expectedIssuer: null,
    defaultScopes: DEFAULT_SCOPES,
    createAuthorizationURL(state, _codeVerifier, scopes) {
      return client.createAuthorizationURL(state, scopes);
    },
    validateAuthorizationCode(code, _codeVerifier) {
      return client.validateAuthorizationCode(code);
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
