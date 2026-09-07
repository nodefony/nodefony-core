import assert from "node:assert/strict";
import {
  createOidcProvider,
  createDiscoveredOidcProvider,
} from "../../nodefony/src/oauth/providers/oidc";
import { createGithubProvider } from "../../nodefony/src/oauth/providers/github";
import {
  registerOAuthProvider,
  getOAuthProviderFactory,
  listOAuthProviders,
} from "../../nodefony/src/oauth/oauthProviderRegistry";
import { OAuth2Tokens } from "../../nodefony/src/oauth/oauth2Client";

/**
 * Fournisseurs OAuth + registre. Le helper OIDC générique (Google/Keycloak/…)
 * et le mapping GitHub (non-OIDC) sont la SEULE valeur ajoutée par-dessus le client
 * OAuth 2.0, qui s'arrête aux jetons sans normaliser le profil.
 */

// Jetons réels : c'est la vraie enveloppe du module, remplie du strict nécessaire
// (`id_token` pour OIDC, `access_token` pour GitHub).
function fakeTokens(data: Record<string, unknown>): OAuth2Tokens {
  return new OAuth2Tokens(data);
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
      Promise.resolve(fakeTokens({ id_token: "jwt" })),
  };
  const CLIENT_ID = "cid";
  const claimsBase = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  const make = (decode: (t: string) => object) =>
    createOidcProvider({
      name: "google",
      client,
      issuer: "https://accounts.google.com",
      clientId: CLIENT_ID,
      decodeIdToken: decode,
    });

  it("usesPkce + politique d'émetteur + scopes par défaut OIDC", () => {
    const p = make(() => ({ ...claimsBase, sub: "x" }));
    assert.equal(p.usesPkce, true);
    assert.deepEqual(p.issuerPolicy, {
      issuer: "https://accounts.google.com",
      // Non annoncé par le serveur ⇒ un `iss` absent ne sera pas une faute.
      requireIssParameter: false,
    });
    assert.deepEqual(p.defaultScopes, ["openid", "profile", "email"]);
  });

  it("PKCE obligatoire : code_verifier null → throw (RFC 7636)", () => {
    const p = make(() => ({ ...claimsBase, sub: "x" }));
    assert.throws(() => p.createAuthorizationURL("st", null, ["openid"]));
  });

  it("fetchProfile mappe les claims OIDC standard", async () => {
    const p = make(() => ({
      ...claimsBase,
      sub: "g-108",
      email: "alice@gmail.com",
      email_verified: true,
      name: "Alice",
    }));
    const profile = await p.fetchProfile(fakeTokens({ id_token: "jwt" }));
    assert.equal(profile.provider, "google");
    assert.equal(profile.providerId, "g-108");
    assert.equal(profile.email, "alice@gmail.com");
    assert.equal(profile.emailVerified, true);
    assert.equal(profile.name, "Alice");
  });

  it("email_verified absent → emailVerified false (jamais présumé)", async () => {
    const p = make(() => ({ ...claimsBase, sub: "g-1", email: "x@y.z" }));
    const profile = await p.fetchProfile(fakeTokens({ id_token: "jwt" }));
    assert.equal(profile.emailVerified, false);
  });

  it("ID token sans 'sub' → throw (pas d'identité)", async () => {
    const p = make(() => ({ ...claimsBase, email: "x@y.z" }));
    await assert.rejects(() => p.fetchProfile(fakeTokens({ id_token: "jwt" })));
  });

  // OpenID Connect Core §3.1.3.7 — la signature n'est pas vérifiée (canal TLS
  // direct), mais les autres exigences du même paragraphe ne coûtent rien et
  // ferment de vrais écarts.
  it("ID token d'un AUTRE émetteur → refus (point 2)", async () => {
    const p = make(() => ({
      ...claimsBase,
      iss: "https://attaquant.test",
      sub: "x",
    }));
    await assert.rejects(
      () => p.fetchProfile(fakeTokens({ id_token: "jwt" })),
      /émis par/,
    );
  });

  it("ID token délivré à une AUTRE application → refus (point 3)", async () => {
    const p = make(() => ({ ...claimsBase, aud: "une-autre-app", sub: "x" }));
    await assert.rejects(
      () => p.fetchProfile(fakeTokens({ id_token: "jwt" })),
      /autre application/,
    );
  });

  it("audience MULTIPLE contenant la nôtre → accepté (point 3)", async () => {
    const p = make(() => ({
      ...claimsBase,
      aud: ["autre", CLIENT_ID],
      sub: "x",
    }));
    const profile = await p.fetchProfile(fakeTokens({ id_token: "jwt" }));
    assert.equal(profile.providerId, "x");
  });

  it("ID token PÉRIMÉ ou sans 'exp' → refus (point 9)", async () => {
    const perime = make(() => ({
      ...claimsBase,
      exp: Math.floor(Date.now() / 1000) - 1,
      sub: "x",
    }));
    await assert.rejects(
      () => perime.fetchProfile(fakeTokens({ id_token: "jwt" })),
      /périmé/,
    );
    const sansExp = make(() => ({
      iss: claimsBase.iss,
      aud: CLIENT_ID,
      sub: "x",
    }));
    await assert.rejects(
      () => sansExp.fetchProfile(fakeTokens({ id_token: "jwt" })),
      /périmé/,
    );
  });
});

describe("createGithubProvider (non-OIDC, profil via API)", () => {
  // Aucun double : le fournisseur construit un vrai client OAuth 2.0, qui ne sort
  // sur le réseau qu'à l'échange du code — jamais exercé ici (seul `fetchProfile`
  // appelle l'API, via le `fetch` mocké ci-dessous).
  const ctx = {
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

  // De VRAIS objets `Response` : l'appel à l'API passe par la lecture bornée,
  // qui lit les en-têtes puis le flux — un double partiel ne la traverse pas.
  function mockFetch(routes: Record<string, unknown>): void {
    globalThis.fetch = ((url: string) => {
      const body = routes[url];
      return Promise.resolve(
        body === undefined
          ? new Response("{}", { status: 404 })
          : new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
      );
    }) as unknown as typeof globalThis.fetch;
  }

  it("usesPkce false + pas d'issuer (non-OIDC)", () => {
    const p = createGithubProvider(ctx);
    assert.equal(p.usesPkce, false);
    assert.equal(p.issuerPolicy, null);
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
      fakeTokens({ access_token: "gh-token" }),
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
      fakeTokens({ access_token: "gh-token" }),
    );
    assert.equal(profile.email, "carol@priv.io");
    assert.equal(profile.emailVerified, true);
    assert.equal(profile.name, "carol"); // name null → fallback login
  });

  it("API en échec → throw", async () => {
    mockFetch({}); // aucune route → 404
    const p = createGithubProvider(ctx);
    await assert.rejects(() =>
      p.fetchProfile(fakeTokens({ access_token: "gh-token" })),
    );
  });
});

describe("createDiscoveredOidcProvider (fournisseur décrit par son seul émetteur)", () => {
  const ISSUER = "https://idp.test";
  const ctx = {
    clientId: "cid",
    clientSecret: "csecret",
    redirectUri: "https://app.test/cb",
  };
  const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  // JWT non signé : `decodeJwt` ne vérifie pas la signature — le canal TLS direct
  // du point de jeton la remplace (OpenID Connect Core §3.1.3.7).
  function idToken(claims: Record<string, unknown>): string {
    const part = (o: unknown): string =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.signature`;
  }

  /** Transport INJECTÉ (jamais le `fetch` du processus), vrais objets `Response`. */
  function serve(routes: Record<string, unknown>): typeof globalThis.fetch {
    return ((url: string) => {
      const body = routes[url];
      return Promise.resolve(
        body === undefined
          ? new Response("{}", { status: 404 })
          : new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
      );
    }) as unknown as typeof globalThis.fetch;
  }

  const metadata = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/auth`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/certs`,
    code_challenge_methods_supported: ["S256"],
  };
  // Première URL de l'ordre normatif (RFC 8414 §3.1) pour un émetteur sans chemin.
  const WELL_KNOWN = `${ISSUER}/.well-known/oauth-authorization-server`;

  it("découvre, autorise, échange et normalise le profil — sans une URL écrite en dur", async () => {
    const fetch = serve({
      [WELL_KNOWN]: metadata,
      [`${ISSUER}/token`]: {
        access_token: "at",
        token_type: "Bearer",
        id_token: idToken({
          iss: ISSUER,
          aud: ctx.clientId,
          exp: Math.floor(Date.now() / 1000) + 600,
          sub: "g-108",
          email: "alice@idp.test",
          email_verified: true,
          name: "Alice",
        }),
      },
    });
    const provider = await createDiscoveredOidcProvider("google", ctx, {
      issuer: ISSUER,
      fetch,
    });
    assert.equal(provider.usesPkce, true);
    assert.deepEqual(provider.issuerPolicy, {
      issuer: ISSUER,
      requireIssParameter: false,
    });

    const url = provider.createAuthorizationURL("st", VERIFIER, ["openid"]);
    assert.equal(url.origin + url.pathname, `${ISSUER}/auth`);
    assert.equal(
      url.searchParams.get("code_challenge"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );

    const tokens = await provider.validateAuthorizationCode("code", VERIFIER);
    const profile = await provider.fetchProfile(tokens);
    assert.equal(profile.provider, "google");
    assert.equal(profile.providerId, "g-108");
    assert.equal(profile.email, "alice@idp.test");
    assert.equal(profile.emailVerified, true);
  });

  it("un émetteur qui ANNONCE `iss` rend son absence fautive (RFC 9207 §2.3)", async () => {
    const fetch = serve({
      [WELL_KNOWN]: {
        ...metadata,
        authorization_response_iss_parameter_supported: true,
      },
    });
    const provider = await createDiscoveredOidcProvider("google", ctx, {
      issuer: ISSUER,
      fetch,
    });
    assert.deepEqual(provider.issuerPolicy, {
      issuer: ISSUER,
      requireIssParameter: true,
    });
  });

  it("émetteur qui n'annonce PAS S256 → refus (pas de PKCE en trompe-l'œil)", async () => {
    const fetch = serve({
      [WELL_KNOWN]: {
        ...metadata,
        code_challenge_methods_supported: ["plain"],
      },
    });
    await assert.rejects(
      () =>
        createDiscoveredOidcProvider("google", ctx, { issuer: ISSUER, fetch }),
      /S256/,
    );
  });

  it("aucun émetteur (ni argument ni config) → refus au montage", async () => {
    await assert.rejects(
      () => createDiscoveredOidcProvider("keycloak", ctx),
      /issuer/,
    );
  });
});
