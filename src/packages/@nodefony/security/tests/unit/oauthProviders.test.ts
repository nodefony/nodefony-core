import assert from "node:assert/strict";
import type { OAuth2Tokens } from "arctic";
import { createOidcProvider } from "../../nodefony/src/oauth/providers/oidc";
import { createGithubProvider } from "../../nodefony/src/oauth/providers/github";
import {
  registerOAuthProvider,
  getOAuthProviderFactory,
  listOAuthProviders,
} from "../../nodefony/src/oauth/oauthProviderRegistry";

/**
 * Fournisseurs OAuth + registre. Le helper OIDC générique (Google/Keycloak/…)
 * et le mapping GitHub (non-OIDC) sont la SEULE valeur ajoutée par-dessus arctic
 * (qui s'arrête aux jetons, sans normaliser le profil).
 */

// Jetons factices — seul `idToken()` (OIDC) / `accessToken()` (GitHub) compte.
function fakeTokens(parts: Partial<OAuth2Tokens>): OAuth2Tokens {
  return parts as OAuth2Tokens;
}

describe("Registre de fournisseurs OAuth", () => {
  it("expose les builtins mandatory : google, keycloak, github", () => {
    const names = listOAuthProviders();
    assert.ok(names.includes("google"), "google manquant");
    assert.ok(names.includes("keycloak"), "keycloak manquant");
    assert.ok(names.includes("github"), "github manquant");
  });

  it("registerOAuthProvider rend la fabrique résoluble (extensible sans éditer le core)", () => {
    registerOAuthProvider("acme-test", () => {
      throw new Error("never");
    });
    assert.equal(typeof getOAuthProviderFactory("acme-test"), "function");
    assert.equal(getOAuthProviderFactory("inconnu-xyz"), undefined);
  });
});

describe("createOidcProvider (helper générique OIDC)", () => {
  const client = {
    createAuthorizationURL: (
      state: string,
      codeVerifier: string,
      scopes: string[],
    ) =>
      new URL(
        `https://idp/auth?state=${state}&cv=${codeVerifier}&scope=${scopes.join("+")}`,
      ),
    validateAuthorizationCode: (_code: string, _cv: string) =>
      Promise.resolve(fakeTokens({})),
  };
  const make = (decode: (t: string) => object) =>
    createOidcProvider({
      name: "google",
      client,
      issuer: "https://accounts.google.com",
      decodeIdToken: decode,
    });

  it("usesPkce + expectedIssuer + scopes par défaut OIDC", () => {
    const p = make(() => ({ sub: "x" }));
    assert.equal(p.usesPkce, true);
    assert.equal(p.expectedIssuer, "https://accounts.google.com");
    assert.deepEqual(p.defaultScopes, ["openid", "profile", "email"]);
  });

  it("PKCE obligatoire : code_verifier null → throw (RFC 7636)", () => {
    const p = make(() => ({ sub: "x" }));
    assert.throws(() => p.createAuthorizationURL("st", null, ["openid"]));
  });

  it("fetchProfile mappe les claims OIDC standard", async () => {
    const p = make(() => ({
      sub: "g-108",
      email: "alice@gmail.com",
      email_verified: true,
      name: "Alice",
    }));
    const profile = await p.fetchProfile(fakeTokens({ idToken: () => "jwt" }));
    assert.equal(profile.provider, "google");
    assert.equal(profile.providerId, "g-108");
    assert.equal(profile.email, "alice@gmail.com");
    assert.equal(profile.emailVerified, true);
    assert.equal(profile.name, "Alice");
  });

  it("email_verified absent → emailVerified false (jamais présumé)", async () => {
    const p = make(() => ({ sub: "g-1", email: "x@y.z" }));
    const profile = await p.fetchProfile(fakeTokens({ idToken: () => "jwt" }));
    assert.equal(profile.emailVerified, false);
  });

  it("ID token sans 'sub' → throw (pas d'identité)", async () => {
    const p = make(() => ({ email: "x@y.z" }));
    await assert.rejects(() =>
      p.fetchProfile(fakeTokens({ idToken: () => "jwt" })),
    );
  });
});

describe("createGithubProvider (non-OIDC, profil via API)", () => {
  // Fausse classe arctic GitHub — seul le constructeur est exercé (fetchProfile
  // appelle l'API via fetch, mocké ci-dessous).
  const fakeArctic = {
    GitHub: class {
      constructor(
        public a: string,
        public b: string,
        public c: string | null,
      ) {}
    },
  } as unknown as Parameters<typeof createGithubProvider>[0]["arctic"];

  const ctx = {
    arctic: fakeArctic,
    clientId: "id",
    clientSecret: "secret",
    redirectUri: "https://app/cb",
  };

  let realFetch: typeof globalThis.fetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockFetch(routes: Record<string, unknown>): void {
    globalThis.fetch = ((url: string) => {
      const body = routes[url];
      return Promise.resolve({
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        json: () => Promise.resolve(body),
      });
    }) as unknown as typeof globalThis.fetch;
  }

  it("usesPkce false + pas d'issuer (non-OIDC)", () => {
    const p = createGithubProvider(ctx);
    assert.equal(p.usesPkce, false);
    assert.equal(p.expectedIssuer, null);
  });

  it("email public présent → vérifié, pas d'appel /user/emails", async () => {
    mockFetch({
      "https://api.github.com/user": {
        id: 42,
        login: "bob",
        name: "Bob",
        email: "bob@pub.dev",
      },
    });
    const p = createGithubProvider(ctx);
    const profile = await p.fetchProfile(
      fakeTokens({ accessToken: () => "gh-token" }),
    );
    assert.equal(profile.provider, "github");
    assert.equal(profile.providerId, "42");
    assert.equal(profile.email, "bob@pub.dev");
    assert.equal(profile.emailVerified, true);
    assert.equal(profile.name, "Bob");
  });

  it("email privé → résolu via /user/emails (primaire vérifié)", async () => {
    mockFetch({
      "https://api.github.com/user": {
        id: 7,
        login: "carol",
        name: null,
        email: null,
      },
      "https://api.github.com/user/emails": [
        { email: "old@x.io", primary: false, verified: true },
        { email: "carol@priv.io", primary: true, verified: true },
      ],
    });
    const p = createGithubProvider(ctx);
    const profile = await p.fetchProfile(
      fakeTokens({ accessToken: () => "gh-token" }),
    );
    assert.equal(profile.email, "carol@priv.io");
    assert.equal(profile.emailVerified, true);
    assert.equal(profile.name, "carol"); // name null → fallback login
  });

  it("API en échec → throw", async () => {
    mockFetch({}); // aucune route → 404
    const p = createGithubProvider(ctx);
    await assert.rejects(() =>
      p.fetchProfile(fakeTokens({ accessToken: () => "gh-token" })),
    );
  });
});
