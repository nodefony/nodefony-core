import assert from "node:assert/strict";
import type { OAuth2ClientAuthMethod } from "../../nodefony/src/oauth/oauth2Client";
import {
  OAuth2Client,
  OAuth2RequestError,
  OAuth2Tokens,
  createCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "../../nodefony/src/oauth/oauth2Client";

/**
 * Client OAuth 2.0 du module — ce qui remplace la dépendance tierce retirée.
 * On y prouve les points où une erreur ne se verrait PAS à l'usage : le calcul du
 * `code_challenge`, ce qui part réellement sur le fil, et le refus du serveur.
 */

const ENDPOINTS = {
  authorizationEndpoint: "https://idp.test/authorize",
  tokenEndpoint: "https://idp.test/token",
  clientId: "client id",
  clientSecret: "s3cr3t:+/",
  clientAuthMethod: "client_secret_basic" as OAuth2ClientAuthMethod,
  redirectUri: "https://app.test/callback",
};

type Sortie = { url: string; init: RequestInit };

/**
 * Fabrique un client dont le transport est INJECTÉ — jamais en remplaçant le
 * `fetch` du processus : deux fichiers de test qui le font en parallèle se
 * marchent dessus, et rien ne le dit.
 */
function client(
  reponse: () => Response,
  overrides: Partial<typeof ENDPOINTS> = {},
): { client: OAuth2Client; calls: Sortie[] } {
  const calls: Sortie[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(reponse());
  }) as unknown as typeof globalThis.fetch;
  return {
    client: new OAuth2Client({ ...ENDPOINTS, ...overrides, fetch }),
    calls,
  };
}

/** Un VRAI objet `Response` : c'est lui que le lecteur borné doit savoir lire. */
function json(status: number, body: unknown): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

/** Client sans transport — pour les cas qui ne sortent pas sur le réseau. */
function pureClient(overrides: Partial<typeof ENDPOINTS> = {}): OAuth2Client {
  return new OAuth2Client({ ...ENDPOINTS, ...overrides });
}

describe("Entropie OAuth (state, PKCE)", () => {
  it("state et code_verifier tiennent dans l'alphabet unreserved, 43 caractères (RFC 7636 §4.1)", () => {
    for (const value of [generateState(), generateCodeVerifier()]) {
      assert.equal(value.length, 43);
      assert.ok(
        /^[A-Za-z0-9\-._~]+$/.test(value),
        `caractère hors alphabet : ${value}`,
      );
    }
  });

  it("deux tirages successifs diffèrent", () => {
    assert.notEqual(generateState(), generateState());
  });

  it("un code_verifier hors grammaire est refusé ICI, pas par le serveur", () => {
    // Sans cette garde, un appelant qui fournit son propre secret obtiendrait un
    // défi calculé sur une valeur que l'IdP rejettera : l'erreur sortirait au
    // retour, sous la forme d'un `invalid_grant` que rien ne relie à sa cause.
    assert.throws(() => createCodeChallenge("trop-court"), /RFC 7636/);
    assert.throws(() => createCodeChallenge(`${"a".repeat(43)}!`), /RFC 7636/);
    assert.throws(() => createCodeChallenge("a".repeat(129)), /RFC 7636/);
    assert.doesNotThrow(() => createCodeChallenge("a".repeat(43)));
  });

  it("code_challenge S256 — vecteur officiel de la RFC 7636 annexe B", () => {
    assert.equal(
      createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("OAuth2Client — URL d'autorisation", () => {
  it("porte les paramètres du code flow et le défi PKCE S256", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const url = pureClient().createAuthorizationURL({
      state: "st-1",
      codeVerifier: verifier,
      scopes: ["openid", "email"],
    });
    assert.equal(url.origin + url.pathname, "https://idp.test/authorize");
    const p = url.searchParams;
    assert.equal(p.get("response_type"), "code");
    assert.equal(p.get("client_id"), "client id");
    assert.equal(p.get("redirect_uri"), "https://app.test/callback");
    assert.equal(p.get("state"), "st-1");
    assert.equal(p.get("scope"), "openid email");
    assert.equal(p.get("code_challenge_method"), "S256");
    assert.equal(
      p.get("code_challenge"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("sans PKCE : aucun défi n'est envoyé", () => {
    const p = pureClient().createAuthorizationURL({
      state: "st-1",
      codeVerifier: null,
      scopes: ["read:user"],
    }).searchParams;
    assert.equal(p.get("code_challenge"), null);
    assert.equal(p.get("code_challenge_method"), null);
  });

  it("aucune portée demandée → pas de paramètre scope (rien n'est ajouté d'office)", () => {
    const p = pureClient().createAuthorizationURL({
      state: "st",
      codeVerifier: null,
      scopes: [],
    }).searchParams;
    assert.equal(p.get("scope"), null);
  });
});

describe("OAuth2Client — échange du code", () => {
  const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  it("poste le code, le verifier PKCE et s'authentifie en Basic (RFC 6749 §2.3.1)", async () => {
    const { client: c, calls } = client(
      json(200, { access_token: "at", token_type: "Bearer" }),
    );
    await c.validateAuthorizationCode({
      code: "the-code",
      codeVerifier: VERIFIER,
    });
    assert.equal(calls.length, 1);
    const { url, init } = calls[0]!;
    assert.equal(url, "https://idp.test/token");
    assert.equal(init.method, "POST");
    // Un POST redirigé est rejoué en GET sans corps, et l'en-tête Authorization
    // porte le secret client : aucune redirection ne se suit.
    assert.equal(init.redirect, "error");
    const headers = init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
    // Sans cet en-tête GitHub répond en x-www-form-urlencoded.
    assert.equal(headers.Accept, "application/json");
    // Chaque moitié est encodée en `application/x-www-form-urlencoded` AVANT le
    // base64 (RFC 6749 §2.3.1) : l'espace devient « + », et « : » « + » « / » du
    // secret sont échappés.
    assert.equal(
      headers.Authorization,
      `Basic ${Buffer.from("client+id:s3cr3t%3A%2B%2F").toString("base64")}`,
    );
    const body = new URLSearchParams(init.body as string);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "the-code");
    assert.equal(body.get("code_verifier"), VERIFIER);
    assert.equal(body.get("redirect_uri"), "https://app.test/callback");
    // Authentifié en Basic : l'identité ne se répète pas dans le corps.
    assert.equal(body.get("client_id"), null);
  });

  it("client public (secret vide) : pas de Basic, identité dans le corps", async () => {
    const { client: c, calls } = client(json(200, { access_token: "at" }), {
      clientSecret: "",
      clientAuthMethod: "none",
    });
    await c.validateAuthorizationCode({ code: "c", codeVerifier: null });
    const { init } = calls[0]!;
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      undefined,
    );
    assert.equal(
      new URLSearchParams(init.body as string).get("client_id"),
      "client id",
    );
  });

  it("sans PKCE : aucun code_verifier n'est posté", async () => {
    const { client: c, calls } = client(json(200, { access_token: "at" }));
    await c.validateAuthorizationCode({ code: "c", codeVerifier: null });
    assert.equal(
      new URLSearchParams(calls[0]!.init.body as string).get("code_verifier"),
      null,
    );
  });

  it("PKCE — un code_verifier faux fait ÉCHOUER l'échange, le refus est nommé", async () => {
    const { client: c } = client(
      json(400, {
        error: "invalid_grant",
        error_description: "PKCE verification failed",
      }),
    );
    await assert.rejects(
      () =>
        c.validateAuthorizationCode({
          code: "the-code",
          codeVerifier: "MAUVAIS-verifier-mais-de-longueur-reglementaire",
        }),
      (error: unknown) => {
        assert.ok(error instanceof OAuth2RequestError);
        assert.equal(error.code, "invalid_grant");
        assert.equal(error.description, "PKCE verification failed");
        return true;
      },
    );
  });

  it("refus annoncé en HTTP 200 (cas GitHub) → erreur quand même", async () => {
    const { client: c } = client(json(200, { error: "bad_verification_code" }));
    await assert.rejects(
      () => c.validateAuthorizationCode({ code: "c", codeVerifier: null }),
      OAuth2RequestError,
    );
  });

  it("réponse illisible → erreur explicite, jamais des jetons vides", async () => {
    const { client: c } = client(
      () => new Response("<html>maintenance</html>", { status: 200 }),
    );
    await assert.rejects(
      () => c.validateAuthorizationCode({ code: "c", codeVerifier: null }),
      /illisible/,
    );
  });

  it("corps hors gabarit annoncé → refus AVANT d'analyser", async () => {
    const { client: c } = client(
      () =>
        new Response(JSON.stringify({ access_token: "at" }), {
          status: 200,
          headers: { "content-length": "99999999" },
        }),
    );
    await assert.rejects(
      () => c.validateAuthorizationCode({ code: "c", codeVerifier: null }),
      /hors gabarit/,
    );
  });

  it("échec HTTP sans champ error → erreur portant le statut", async () => {
    const { client: c } = client(json(502, { whatever: true }));
    await assert.rejects(
      () => c.validateAuthorizationCode({ code: "c", codeVerifier: null }),
      /HTTP 502/,
    );
  });
});

describe("OAuth2Tokens", () => {
  it("rend les jetons présents", () => {
    const tokens = new OAuth2Tokens({
      access_token: "at",
      id_token: "it",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email",
      refresh_token: "rt",
    });
    assert.equal(tokens.accessToken(), "at");
    assert.equal(tokens.idToken(), "it");
    assert.equal(tokens.tokenType(), "Bearer");
    assert.equal(tokens.accessTokenExpiresInSeconds(), 3600);
    assert.deepEqual(tokens.scopes(), ["openid", "email"]);
    assert.equal(tokens.hasRefreshToken(), true);
    assert.equal(tokens.refreshToken(), "rt");
    assert.ok(tokens.accessTokenExpiresAt() > new Date());
  });

  it("champ attendu mais absent → erreur NOMMÉE (jamais un undefined qui se propage)", () => {
    const tokens = new OAuth2Tokens({ access_token: "at" });
    assert.equal(tokens.hasRefreshToken(), false);
    assert.equal(tokens.hasScopes(), false);
    assert.throws(() => tokens.idToken(), /id_token/);
    assert.throws(() => tokens.refreshToken(), /refresh_token/);
    assert.throws(() => tokens.accessTokenExpiresInSeconds(), /expires_in/);
  });

  it("garde l'accès au corps brut (extensions du fournisseur)", () => {
    assert.equal(new OAuth2Tokens({ x_custom: 1 }).data.x_custom, 1);
  });
});

/*
 *   Ce que ce banc protège vraiment : la CAPACITÉ D'AJOUT.
 *
 *   Les deux méthodes prenaient leurs arguments par position, et ce contrat est
 *   EXPORTÉ — donc gelé à la publication de la 10.0.0. Plusieurs paramètres
 *   normalisés manquaient déjà, dont `resource` (RFC 8707), que le Model Context
 *   Protocol EXIGE dans les deux requêtes. Ce banc ne livre aucun d'eux : il
 *   éprouve qu'ils POURRONT être livrés sans toucher à un seul appelant, et que
 *   ce supplément ne peut pas se retourner contre le protocole.
 */
describe("OAuth2Client — la forme accueille ce qui n'est pas encore livré", () => {
  it("🔴 un paramètre supplémentaire atteint l'URL d'autorisation", () => {
    const p = pureClient().createAuthorizationURL({
      state: "st",
      codeVerifier: null,
      scopes: [],
      // Ni `resource` ni `nonce` ne sont implémentés — et c'est le sujet :
      // ils traversent sans que le client ait à les connaître.
      additionalParameters: {
        resource: "https://api.test/mcp",
        nonce: "n-42",
      },
    }).searchParams;
    assert.equal(p.get("resource"), "https://api.test/mcp");
    assert.equal(p.get("nonce"), "n-42");
    // Et ce que le protocole pose reste posé.
    assert.equal(p.get("response_type"), "code");
    assert.equal(p.get("client_id"), "client id");
  });

  it("🔴 un paramètre supplémentaire atteint le CORPS de la requête de jeton", async () => {
    // RFC 8707 §2.2 : `resource` doit être répété à l'échange. Sans cette
    // seconde traversée, la première ne servirait à rien.
    const { client: c, calls } = client(json(200, { access_token: "at" }));
    await c.validateAuthorizationCode({
      code: "c",
      codeVerifier: null,
      additionalParameters: { resource: "https://api.test/mcp" },
    });
    const body = new URLSearchParams(calls[0]!.init.body as string);
    assert.equal(body.get("resource"), "https://api.test/mcp");
    assert.equal(body.get("grant_type"), "authorization_code");
  });

  it("🔴 un supplément NE PEUT PAS recouvrir un paramètre du protocole", () => {
    // La porte d'extension ne doit pas devenir une porte pour faire émettre par
    // ce client une requête qui ne le désigne plus. Le refus NOMME la clé :
    // ignorer en silence serait pire, l'appelant croirait l'avoir envoyée.
    assert.throws(
      () =>
        pureClient().createAuthorizationURL({
          state: "st",
          codeVerifier: null,
          scopes: [],
          additionalParameters: { client_id: "un-autre-client" },
        }),
      /client_id/,
    );
  });

  it("🔴 `client_secret_post` met l'identité ET le secret dans le corps", async () => {
    // La méthode que la convention « secret non vide ⇒ Basic » ne pouvait pas
    // exprimer, et que des serveurs EXIGENT en l'annonçant dans leurs métadonnées.
    const { client: c, calls } = client(json(200, { access_token: "at" }), {
      clientAuthMethod: "client_secret_post",
    });
    await c.validateAuthorizationCode({ code: "c", codeVerifier: null });
    const { init } = calls[0]!;
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      undefined,
      "Basic et le corps sont exclusifs — un serveur strict refuse les deux",
    );
    const body = new URLSearchParams(init.body as string);
    assert.equal(body.get("client_id"), "client id");
    assert.equal(body.get("client_secret"), "s3cr3t:+/");
  });
});
