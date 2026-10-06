import assert from "node:assert/strict";
import { diagnoseOAuthProvider } from "../../nodefony/src/oauth/providerDiagnosis";
import { createDiscoveredOidcProvider } from "../../nodefony/src/oauth/providers/oidc";
import type {
  IOAuthDiagnosis,
  OAuthCheckName,
} from "../../nodefony/src/oauth/providerDiagnosis";

/**
 * Diagnostic d'un fournisseur OAuth sans connexion humaine (#520, lot 2).
 *
 * Le décor est un serveur d'autorisation joué par un `fetch` injecté — le VRAI
 * fournisseur OIDC du module est construit dessus, pour que les sondes passent
 * par le code du login et non par une requête écrite pour le test. Les réponses
 * imitent celles que Keycloak 26.8 rend réellement (relevées sur le décor du
 * dépôt) : `unauthorized_client` en 401 sur un secret faux, `invalid_client` en
 * 401 sur un client inconnu, une page 400 qui nomme `redirect_uri`.
 */

const ISSUER = "https://idp.example/realms/app";
const AUTH = `${ISSUER}/protocol/openid-connect/auth`;
const TOKEN = `${ISSUER}/protocol/openid-connect/token`;
const REDIRECT =
  "https://app.example/nodefony/security/api/oauth2/keycloak/callback";
const CLIENT_ID = "app";
const SECRET = "le-vrai-secret";

type Reply = () => Response;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const html = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "Content-Type": "text/html" } });

const redirect = (location: string): Response =>
  new Response(null, { status: 302, headers: { Location: location } });

const LOGIN_PAGE: Reply = () => html(200, "<form id=kc-form-login></form>");
const CODE_REFUSED: Reply = () =>
  json(400, { error: "invalid_grant", error_description: "Code not valid" });

interface IDecor {
  issuerDeclared?: string;
  authorization?: Reply;
  token?: Reply | "down";
}

/** Un serveur d'autorisation joué par `fetch`, et le journal de ce qu'il a reçu. */
function idp(decor: IDecor) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url =
      input instanceof URL
        ? input.href
        : typeof input === "string"
          ? input
          : input.url;
    seen.push({ url, init });
    if (url.includes("/.well-known/")) {
      return Promise.resolve(
        json(200, {
          issuer: decor.issuerDeclared ?? ISSUER,
          authorization_endpoint: AUTH,
          token_endpoint: TOKEN,
          jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
          code_challenge_methods_supported: ["S256"],
        }),
      );
    }
    if (url.startsWith(AUTH)) {
      return Promise.resolve((decor.authorization ?? LOGIN_PAGE)());
    }
    if (url === TOKEN) {
      if (decor.token === "down") {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve((decor.token ?? CODE_REFUSED)());
    }
    return Promise.resolve(html(404, "inconnu"));
  };
  return { fetch, seen };
}

function diagnose(
  decor: IDecor,
  overrides: { clientAuthMethod?: "none" } = {},
): Promise<IOAuthDiagnosis> & { seen: ReturnType<typeof idp>["seen"] } {
  const server = idp(decor);
  const run = diagnoseOAuthProvider({
    name: "keycloak",
    clientId: CLIENT_ID,
    redirectUri: REDIRECT,
    clientAuthMethod: overrides.clientAuthMethod,
    fetch: server.fetch,
    build: () =>
      createDiscoveredOidcProvider(
        "keycloak",
        {
          clientId: CLIENT_ID,
          clientSecret: overrides.clientAuthMethod === "none" ? "" : SECRET,
          clientAuthMethod: overrides.clientAuthMethod,
          redirectUri: REDIRECT,
          issuer: ISSUER,
        },
        { fetch: server.fetch },
      ),
  });
  return Object.assign(run, { seen: server.seen });
}

const check = (d: IOAuthDiagnosis, name: OAuthCheckName) => {
  const found = d.checks.find((c) => c.name === name);
  assert.ok(found, `sonde « ${name} » absente`);
  return found;
};

describe("diagnoseOAuthProvider — un branchement sain", () => {
  it("page de connexion + code refusé en invalid_grant : les trois sondes passent", async () => {
    const d = await diagnose({});
    assert.equal(d.ok, true);
    assert.deepEqual(
      d.checks.map((c) => [c.name, c.status]),
      [
        ["discovery", "ok"],
        ["authorization", "ok"],
        ["token", "ok"],
      ],
    );
    assert.match(check(d, "token").message, /secret accepté/);
  });

  it("🔴 les sondes passent par le fournisseur du LOGIN : URL de retour, client, secret, PKCE", async () => {
    const run = diagnose({});
    await run;
    const auth = run.seen.find((r) => r.url.startsWith(AUTH));
    assert.ok(auth);
    const url = new URL(auth.url);
    assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
    assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    // Le renvoi ne doit pas être SUIVI : c'est sa destination qui est le verdict.
    assert.equal(auth.init?.redirect, "manual");

    const token = run.seen.find((r) => r.url === TOKEN);
    assert.ok(token);
    const headers = token.init?.headers as Record<string, string>;
    assert.equal(
      headers.Authorization,
      `Basic ${Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64")}`,
    );
    const raw = token.init?.body;
    assert.equal(typeof raw, "string", "corps de formulaire attendu");
    const body = new URLSearchParams(raw as string);
    assert.equal(body.get("redirect_uri"), REDIRECT);
    assert.ok(body.get("code_verifier"), "PKCE : code_verifier attendu");
  });

  it("client public : invalid_grant prouve que le client est reconnu, sans secret", async () => {
    const d = await diagnose({}, { clientAuthMethod: "none" });
    assert.equal(d.ok, true);
    assert.match(check(d, "token").message, /client public reconnu/);
  });

  it("un renvoi vers l'URL de retour SANS erreur vaut acceptation", async () => {
    const d = await diagnose({
      authorization: () => redirect(`${REDIRECT}?code=x`),
    });
    assert.equal(check(d, "authorization").status, "ok");
  });
});

describe("diagnoseOAuthProvider — trois verdicts distincts", () => {
  it("⭐ émetteur différent : issuer-mismatch, et les sondes suivantes se DISENT sautées", async () => {
    const d = await diagnose({
      issuerDeclared: "https://localhost:8443/realms/app",
    });
    assert.equal(d.ok, false);
    const discovery = check(d, "discovery");
    assert.equal(discovery.kind, "issuer-mismatch");
    assert.match(discovery.message, /localhost:8443/);
    assert.equal(check(d, "authorization").status, "skipped");
    assert.equal(check(d, "token").status, "skipped");
  });

  it("⭐ URL de retour inconnue : redirect-uri-rejected, nommée dans le message", async () => {
    const d = await diagnose({
      authorization: () =>
        html(
          400,
          "<p id=kc-error-message>Paramètre invalide : redirect_uri</p>",
        ),
    });
    const authorization = check(d, "authorization");
    assert.equal(authorization.kind, "redirect-uri-rejected");
    assert.ok(authorization.message.includes(REDIRECT));
    // Le secret, lui, est bon : les deux faits ne se confondent pas.
    assert.equal(check(d, "token").status, "ok");
  });

  it("⭐ secret faux : le client EXISTE (page servie), le 401 ne peut venir que du secret", async () => {
    const d = await diagnose({
      token: () =>
        json(401, {
          error: "unauthorized_client",
          error_description: "Invalid client or Invalid client credentials",
        }),
    });
    assert.equal(check(d, "authorization").status, "ok");
    const token = check(d, "token");
    assert.equal(token.kind, "secret-rejected");
  });
});

describe("diagnoseOAuthProvider — ce qui ne se tranche pas ne se tranche pas", () => {
  it("client inconnu : refus d'autorisation + client-rejected, jamais « secret faux »", async () => {
    const d = await diagnose({
      authorization: () => html(400, "<p>Client not found.</p>"),
      token: () =>
        json(401, {
          error: "invalid_client",
          error_description: "Invalid client or Invalid client credentials",
        }),
    });
    assert.equal(check(d, "authorization").kind, "authorization-refused");
    assert.equal(check(d, "token").kind, "client-rejected");
  });

  it("URL de retour acceptée mais demande refusée : l'erreur renvoyée est rapportée", async () => {
    const d = await diagnose({
      authorization: () =>
        redirect(
          `${REDIRECT}?error=invalid_scope&error_description=scope+inconnu`,
        ),
    });
    const authorization = check(d, "authorization");
    assert.equal(authorization.kind, "authorization-refused");
    assert.match(authorization.message, /« invalid_scope » — scope inconnu/);
  });

  it("renvoi vers une autre page : non concluant, et ce n'est pas un échec", async () => {
    const d = await diagnose({
      authorization: () => redirect("https://login.example/signin"),
    });
    assert.equal(check(d, "authorization").status, "inconclusive");
    assert.equal(d.ok, true);
  });

  it("flux refusé au client (400 unauthorized_client) : token-refused, pas un secret faux", async () => {
    const d = await diagnose({
      token: () =>
        json(400, {
          error: "unauthorized_client",
          error_description: "Client not allowed to exchange code",
        }),
    });
    assert.equal(check(d, "token").kind, "token-refused");
  });

  it("point de jeton injoignable : token-unreachable, sans lever", async () => {
    const d = await diagnose({ token: "down" });
    assert.equal(check(d, "token").kind, "token-unreachable");
  });

  it("un code inventé ACCEPTÉ : non concluant, jamais un quitus", async () => {
    const d = await diagnose({
      token: () => json(200, { access_token: "x", token_type: "Bearer" }),
    });
    assert.equal(check(d, "token").status, "inconclusive");
  });
});
