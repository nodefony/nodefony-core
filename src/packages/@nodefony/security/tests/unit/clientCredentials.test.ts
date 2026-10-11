import assert from "node:assert/strict";
import { requestClientCredentialsToken } from "../../nodefony/src/oauth/clientCredentials";
import { OAuth2RequestError } from "../../nodefony/src/oauth/oauth2Client";

/**
 * Flux `client_credentials` (RFC 6749 §4.4) — découverte RFC 8414, puis
 * requête au point de jeton. Le `fetch` est INJECTÉ et rend de VRAIES
 * `Response` : la lecture bornée lit les en-têtes puis le flux.
 */

const ISSUER = "https://idp.test/realms/app";
const METADATA =
  "https://idp.test/.well-known/oauth-authorization-server/realms/app";
const TOKEN = "https://idp.test/realms/app/token";

interface ISeen {
  url: string;
  headers: Record<string, string>;
  body: URLSearchParams | null;
}

function server(
  tokenReply: { status: number; body: unknown } = {
    status: 200,
    body: { access_token: "at-1", token_type: "Bearer", expires_in: 300 },
  },
): { fetch: typeof globalThis.fetch; seen: ISeen[] } {
  const seen: ISeen[] = [];
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetch = ((url: string, init?: RequestInit) => {
    seen.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body:
        typeof init?.body === "string" ? new URLSearchParams(init.body) : null,
    });
    if (url === METADATA) {
      return Promise.resolve(
        json(200, {
          issuer: ISSUER,
          authorization_endpoint: "https://idp.test/realms/app/auth",
          token_endpoint: TOKEN,
          jwks_uri: "https://idp.test/realms/app/certs",
        }),
      );
    }
    if (url === TOKEN) {
      return Promise.resolve(json(tokenReply.status, tokenReply.body));
    }
    return Promise.resolve(json(404, {}));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, seen };
}

describe("requestClientCredentialsToken — RFC 6749 §4.4", () => {
  it("découvre le point de jeton puis présente le grant, client authentifié en Basic", async () => {
    const { fetch, seen } = server();
    const tokens = await requestClientCredentialsToken({
      issuer: ISSUER,
      clientId: "app-machine",
      clientSecret: "s3cr:t",
      scopes: ["partner:read", "partner:write"],
      resource: "https://app.example/api/partner",
      fetch,
    });
    assert.equal(tokens.accessToken(), "at-1");
    const call = seen.find((s) => s.url === TOKEN);
    assert.ok(call, "le point de jeton DÉCOUVERT a été appelé");
    assert.equal(call.body?.get("grant_type"), "client_credentials");
    assert.equal(call.body?.get("scope"), "partner:read partner:write");
    assert.equal(call.body?.get("resource"), "https://app.example/api/partner");
    // Basic par défaut, et le secret ne voyage QUE dans l'en-tête.
    assert.equal(
      call.headers.Authorization,
      `Basic ${Buffer.from("app-machine:s3cr%3At").toString("base64")}`,
    );
    assert.equal(call.body?.get("client_secret"), null);
  });

  it("client_secret_post : identité et secret dans le corps, aucun en-tête Authorization", async () => {
    const { fetch, seen } = server();
    await requestClientCredentialsToken({
      issuer: ISSUER,
      clientId: "app-machine",
      clientSecret: "s",
      clientAuthMethod: "client_secret_post",
      fetch,
    });
    const call = seen.find((s) => s.url === TOKEN)!;
    assert.equal(call.headers.Authorization, undefined);
    assert.equal(call.body?.get("client_id"), "app-machine");
    assert.equal(call.body?.get("client_secret"), "s");
    assert.equal(
      call.body?.get("scope"),
      null,
      "aucune portée ajoutée d'office",
    );
  });

  it("🔴 secret vide : refusé AVANT tout appel réseau, en nommant le client", async () => {
    const { fetch, seen } = server();
    await assert.rejects(
      requestClientCredentialsToken({
        issuer: ISSUER,
        clientId: "app-machine",
        clientSecret: "",
        fetch,
      }),
      /app-machine.*secret vide/,
    );
    assert.equal(seen.length, 0);
  });

  it("un refus du serveur garde son code normalisé et son statut", async () => {
    const { fetch } = server({
      status: 401,
      body: { error: "invalid_client", error_description: "bad secret" },
    });
    await assert.rejects(
      requestClientCredentialsToken({
        issuer: ISSUER,
        clientId: "app-machine",
        clientSecret: "faux",
        fetch,
      }),
      (e: unknown) =>
        e instanceof OAuth2RequestError &&
        e.code === "invalid_client" &&
        e.status === 401,
    );
  });

  it("émetteur en clair refusé (RFC 8414 §2) — le secret ne part jamais sur http", async () => {
    const { fetch, seen } = server();
    await assert.rejects(
      requestClientCredentialsToken({
        issuer: "http://idp.test/realms/app",
        clientId: "app-machine",
        clientSecret: "s",
        fetch,
      }),
      /https/,
    );
    assert.equal(seen.length, 0);
  });
});

describe("requestClientCredentialsToken — adresse de découverte déclarée", () => {
  it("découvre ET demande le jeton par le service interne, émetteur public inchangé", async () => {
    const internal = "http://keycloak.sso:8080";
    const discovery = `${internal}/realms/app/.well-known/openid-configuration`;
    const seen: string[] = [];
    const fetch = ((url: string) => {
      seen.push(url);
      const body =
        url === discovery
          ? {
              issuer: ISSUER,
              authorization_endpoint: "https://idp.test/realms/app/auth",
              token_endpoint: `${internal}/realms/app/token`,
              jwks_uri: `${internal}/realms/app/certs`,
            }
          : url === `${internal}/realms/app/token`
            ? { access_token: "at-int", token_type: "Bearer" }
            : null;
      return Promise.resolve(
        new Response(JSON.stringify(body ?? {}), {
          status: body === null ? 404 : 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof globalThis.fetch;
    const tokens = await requestClientCredentialsToken({
      issuer: ISSUER,
      discoveryUrl: discovery,
      clientId: "app-machine",
      clientSecret: "s",
      fetch,
    });
    assert.equal(tokens.accessToken(), "at-int");
    assert.deepEqual(seen, [discovery, `${internal}/realms/app/token`]);
  });
});
