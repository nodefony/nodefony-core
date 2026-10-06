import assert from "node:assert/strict";
import * as jose from "jose";
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
import {
  OAuth2RequestError,
  OAuth2Tokens,
} from "../../nodefony/src/oauth/oauth2Client";
import type { IOidcPkceClient } from "../../nodefony/src/oauth/providers/oidc";

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
  const client: IOidcPkceClient = {
    createAuthorizationURL: ({ state, codeVerifier, scopes }) =>
      new URL(
        `https://idp/auth?state=${state}&cv=${codeVerifier}&scope=${scopes.join("+")}`,
      ),
    validateAuthorizationCode: () =>
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

  it("sans point de déconnexion, pas de createLogoutURL (déconnexion locale)", () => {
    const p = make(() => ({ ...claimsBase, sub: "x" }));
    assert.equal(p.createLogoutURL, undefined);
  });

  it("createLogoutURL porte id_token_hint, retour et client_id, sans perdre la query publiée", () => {
    const p = createOidcProvider({
      name: "keycloak",
      client,
      issuer: "https://kc/realms/app",
      clientId: CLIENT_ID,
      decodeIdToken: () => ({}),
      endSessionEndpoint: "https://kc/realms/app/logout?ui=fr",
    });
    const url = p.createLogoutURL?.({
      idTokenHint: "id.token.jwt",
      postLogoutRedirectUri: "https://app/login",
    });
    assert.ok(url);
    assert.equal(url.origin + url.pathname, "https://kc/realms/app/logout");
    assert.equal(url.searchParams.get("ui"), "fr");
    assert.equal(url.searchParams.get("id_token_hint"), "id.token.jwt");
    assert.equal(
      url.searchParams.get("post_logout_redirect_uri"),
      "https://app/login",
    );
    assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
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
    assert.throws(() =>
      p.createAuthorizationURL({
        state: "st",
        codeVerifier: null,
        scopes: ["openid"],
      }),
    );
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

  // Codes relevés sur le point de jeton RÉEL de GitHub (200 + `error`) : un
  // code inventé, puis un secret faux. Non traduits, le diagnostic prenait un
  // secret accepté pour un refus.
  it.each([
    ["bad_verification_code", "invalid_grant"],
    ["incorrect_client_credentials", "invalid_client"],
    ["redirect_uri_mismatch", "invalid_grant"],
  ])(
    "code GitHub « %s » → « %s » (RFC 6749 §5.2), l'original gardé",
    async (gh, rfc) => {
      mockFetch({
        "https://github.com/login/oauth/access_token": { error: gh },
      });
      const p = createGithubProvider(ctx);
      await assert.rejects(
        () => p.validateAuthorizationCode({ code: "x", codeVerifier: null }),
        (error: unknown) =>
          error instanceof OAuth2RequestError &&
          error.code === rfc &&
          (error.description ?? "").includes(gh),
      );
    },
  );

  it("un code GitHub inconnu traverse intact", async () => {
    mockFetch({
      "https://github.com/login/oauth/access_token": { error: "autre_chose" },
    });
    const p = createGithubProvider(ctx);
    await assert.rejects(
      () => p.validateAuthorizationCode({ code: "x", codeVerifier: null }),
      (error: unknown) =>
        error instanceof OAuth2RequestError && error.code === "autre_chose",
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

    const url = provider.createAuthorizationURL({
      state: "st",
      codeVerifier: VERIFIER,
      scopes: ["openid"],
    });
    assert.equal(url.origin + url.pathname, `${ISSUER}/auth`);
    assert.equal(
      url.searchParams.get("code_challenge"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );

    const tokens = await provider.validateAuthorizationCode({
      code: "code",
      codeVerifier: VERIFIER,
    });
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

describe("Jeton de déconnexion (Back-Channel Logout §2.6) — vraie signature, vraies clés (#517)", () => {
  const ISSUER = "https://idp.test";
  const CLIENT = "cid";
  const ctx = {
    clientId: CLIENT,
    clientSecret: "s",
    redirectUri: "https://app.test/cb",
  };
  const EVENT = "http://schemas.openid.net/event/backchannel-logout";
  const now = (): number => Math.floor(Date.now() / 1000);

  let key: jose.CryptoKey;
  let impostor: jose.CryptoKey;
  let jwks: { keys: jose.JWK[] };

  beforeAll(async () => {
    const pair = await jose.generateKeyPair("RS256");
    key = pair.privateKey;
    impostor = (await jose.generateKeyPair("RS256")).privateKey;
    jwks = {
      keys: [
        { ...(await jose.exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" },
      ],
    };
  });

  function sign(
    claims: Record<string, unknown>,
    signer: jose.CryptoKey = key,
  ): Promise<string> {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1", typ: "logout+jwt" })
      .sign(signer);
  }

  const valid = (): Record<string, unknown> => ({
    iss: ISSUER,
    aud: CLIENT,
    iat: now(),
    exp: now() + 120,
    jti: "j-1",
    sub: "kc-alice",
    sid: "S1",
    events: { [EVENT]: {} },
  });

  /** Émetteur servi par un transport INJECTÉ ; `certs: false` = jeu de clés en panne. */
  async function provider(certs = true) {
    const routes: Record<string, unknown> = {
      [`${ISSUER}/.well-known/oauth-authorization-server`]: {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/auth`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/certs`,
        code_challenge_methods_supported: ["S256"],
        // Keycloak annonce aussi HS256 : il doit être ÉCARTÉ, pas accepté.
        id_token_signing_alg_values_supported: ["HS256", "RS256"],
      },
    };
    if (certs) routes[`${ISSUER}/certs`] = jwks;
    const fetch = ((url: string | URL) => {
      const body = routes[String(url)];
      return Promise.resolve(
        body === undefined
          ? new Response("{}", { status: 404 })
          : new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
      );
    }) as unknown as typeof globalThis.fetch;
    const p = await createDiscoveredOidcProvider("keycloak", ctx, {
      issuer: ISSUER,
      fetch,
    });
    assert.ok(
      p.verifyLogoutToken,
      "un fournisseur OIDC découvert vérifie les jetons de déconnexion",
    );
    return p.verifyLogoutToken;
  }

  it("jeton valide → ce qu'il désigne (sub, sid, jti, exp)", async () => {
    const verify = await provider();
    const claims = valid();
    assert.deepEqual(await verify(await sign(claims)), {
      issuer: ISSUER,
      subject: "kc-alice",
      sid: "S1",
      tokenId: "j-1",
      expiresAt: claims.exp,
    });
  });

  it("signé par une AUTRE clé (même kid) → refusé", async () => {
    const verify = await provider();
    assert.equal(await verify(await sign(valid(), impostor)), null);
  });

  it("HS256 (annoncé par l'émetteur, mais à secret partagé) → refusé", async () => {
    const verify = await provider();
    const hs = await new jose.SignJWT(valid())
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .sign(
        new TextEncoder().encode(
          "la-cle-publique-ne-doit-jamais-etre-un-secret",
        ),
      );
    assert.equal(await verify(hs), null);
  });

  it("audience d'un autre client, émetteur étranger, expiré → refusés", async () => {
    const verify = await provider();
    assert.equal(await verify(await sign({ ...valid(), aud: "autre" })), null);
    assert.equal(
      await verify(await sign({ ...valid(), iss: "https://evil.test" })),
      null,
    );
    assert.equal(
      await verify(await sign({ ...valid(), exp: now() - 600 })),
      null,
    );
  });

  it("un ID token du même émetteur (pas d'events) n'est pas un jeton de déconnexion", async () => {
    const verify = await provider();
    const { events: _events, ...idToken } = valid();
    assert.equal(await verify(await sign(idToken)), null);
    assert.equal(
      await verify(await sign({ ...valid(), events: { autre: {} } })),
      null,
    );
    assert.equal(
      await verify(await sign({ ...valid(), events: { [EVENT]: true } })),
      null,
    );
  });

  it("nonce présent, ni sub ni sid, jti absent → refusés", async () => {
    const verify = await provider();
    assert.equal(await verify(await sign({ ...valid(), nonce: "n" })), null);
    const { sub: _s, sid: _i, ...anonymous } = valid();
    assert.equal(await verify(await sign(anonymous)), null);
    const { jti: _j, ...sansJti } = valid();
    assert.equal(await verify(await sign(sansJti)), null);
  });

  it("jeu de clés injoignable → LÈVE (panne, pas refus)", async () => {
    const verify = await provider(false);
    await assert.rejects(
      verify(await sign(valid())),
      /vérification impossible/,
    );
  });
});
