import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  authorizeProtectedResource,
  missingScopes,
  protectedResourceMetadataUrl,
  type IAccessTokenVerifier,
  type IProtectedResourcePolicy,
} from "nodefony";
import { RemoteJwtVerifier } from "../../nodefony/src/token/RemoteJwtVerifier";

/**
 * La CHAÎNE complète : la doctrine de refus du cœur (`nodefony/src/oauth/`)
 * branchée sur le vérificateur réel de ce module.
 *
 * Les deux moitiés étaient éprouvées séparément — le cœur avec un vérificateur
 * factice, le vérificateur sans la porte. Ce banc-ci est le seul endroit où un
 * jeton RÉELLEMENT signé traverse la décision d'autorisation, et où l'on
 * constate ce qu'un client recevrait vraiment : un statut, un en-tête
 * `WWW-Authenticate`, et de quoi remonter jusqu'au serveur d'autorisation.
 *
 * Il n'ouvre aucun port : la fonction du cœur est pure, et le `fetch` du
 * vérificateur est injecté. Ce qui est prouvé ici vaut donc pour n'importe
 * quelle porte qui consomme le contrat — le serveur MCP aujourd'hui, une porte
 * agentique ensuite.
 */

const ISSUER = "https://auth.example.com/realms/nodefony";
const RESOURCE = "https://app.example/nodefony/mcp";
const METADATA_URL =
  "https://auth.example.com/.well-known/oauth-authorization-server/realms/nodefony";
const JWKS_URL = "https://auth.example.com/keys";

const policy: IProtectedResourcePolicy = {
  resource: RESOURCE,
  metadataUrl: protectedResourceMetadataUrl(RESOURCE),
  scopes: ["mcp:call"],
  allowAnonymous: false,
};

interface IDecor {
  verify: IAccessTokenVerifier;
  sign: (claims: Record<string, unknown>, audience?: string) => Promise<string>;
}

async function decor(options: { jwksDown?: boolean } = {}): Promise<IDecor> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "k1";
  jwk.alg = "ES256";
  const routes: Record<string, unknown> = {
    [METADATA_URL]: { issuer: ISSUER, jwks_uri: JWKS_URL },
    [JWKS_URL]: { keys: [jwk] },
  };
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === JWKS_URL && options.jwksDown) {
      return new Response("nope", { status: 503 });
    }
    const body = routes[url];
    if (body === undefined) return new Response("", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const verifier = new RemoteJwtVerifier({
    issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
  });
  return {
    verify: (token, audience) => verifier.verify(token, audience),
    sign: (claims, audience = RESOURCE) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "ES256", kid: "k1" })
        .setIssuer(ISSUER)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey),
  };
}

describe("Porte protégée + vérificateur réel — ce qu'un client reçoit", () => {
  it("sans jeton : 401, l'adresse des métadonnées, et AUCUN code d'erreur", async () => {
    const { verify } = await decor();

    const outcome = await authorizeProtectedResource(undefined, policy, verify);

    assert.ok(outcome.outcome === "challenge");
    assert.equal(outcome.status, 401);
    assert.match(
      outcome.wwwAuthenticate,
      /resource_metadata="https:\/\/app\.example\/\.well-known\/oauth-protected-resource\/nodefony\/mcp"/,
    );
    assert.match(outcome.wwwAuthenticate, /scope="mcp:call"/);
    // RFC 6750 §3 : rien n'a été présenté, donc rien n'est déclaré invalide —
    // sinon le client croit son jeton mauvais et le renouvelle en boucle.
    assert.ok(!outcome.wwwAuthenticate.includes("error="));
  });

  it("jeton valide : identité établie, scopes lisibles par la porte", async () => {
    const { verify, sign } = await decor();
    const token = await sign({ sub: "agent-7", scope: "mcp:read mcp:call" });

    const outcome = await authorizeProtectedResource(
      `Bearer ${token}`,
      policy,
      verify,
    );

    assert.ok(outcome.outcome === "authenticated");
    assert.equal(outcome.principal.subject, "agent-7");
    assert.deepEqual(missingScopes(outcome.principal.scopes, ["mcp:call"]), []);
    assert.deepEqual(missingScopes(outcome.principal.scopes, ["admin:purge"]), [
      "admin:purge",
    ]);
  });

  it("jeton d'une AUTRE ressource : 401 invalid_token, sans dire pourquoi", async () => {
    const { verify, sign } = await decor();
    const token = await sign({ sub: "agent-7" }, "https://autre.example/api");

    const outcome = await authorizeProtectedResource(
      `Bearer ${token}`,
      policy,
      verify,
    );

    assert.ok(outcome.outcome === "challenge");
    assert.equal(outcome.status, 401);
    assert.match(outcome.wwwAuthenticate, /error="invalid_token"/);
    // Aucune trace de la cause fine : un refus ne doit pas aider à fabriquer
    // un jeton acceptable.
    assert.ok(!/audience|aud/i.test(outcome.wwwAuthenticate));
  });

  it("en-tête mal formé : 400 invalid_request, pas 401", async () => {
    const { verify } = await decor();

    const outcome = await authorizeProtectedResource(
      "Basic abc",
      policy,
      verify,
    );

    assert.ok(outcome.outcome === "challenge");
    assert.equal(outcome.status, 400);
    assert.match(outcome.wwwAuthenticate, /error="invalid_request"/);
  });

  it("émetteur EN PANNE : l'exception remonte, jamais un « jeton refusé »", async () => {
    // La porte doit traduire ça en 5xx. Rendre 401 ici enverrait un agent
    // parfaitement autorisé renouveler un jeton qui n'était pas en cause.
    const { verify, sign } = await decor({ jwksDown: true });
    const token = await sign({ sub: "agent-7" });

    await assert.rejects(
      () => authorizeProtectedResource(`Bearer ${token}`, policy, verify),
      /vérification impossible/,
    );
  });

  it("sans vérificateur du tout : verdict `unverifiable` (la porte refusera)", async () => {
    const outcome = await authorizeProtectedResource(
      "Bearer peu-importe",
      policy,
      undefined,
    );

    assert.equal(outcome.outcome, "unverifiable");
  });
});
