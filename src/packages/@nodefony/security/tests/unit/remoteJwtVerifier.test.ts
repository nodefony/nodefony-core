import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { RemoteJwtVerifier } from "../../nodefony/src/token/RemoteJwtVerifier";

/**
 * Vérificateur de jetons émis par un serveur d'autorisation TIERS — gates.
 *
 * Tout se joue SANS RÉSEAU : `fetch` est injecté (porte officielle de jose,
 * `customFetch`), ce qui permet d'éprouver une rotation de clés, un émetteur
 * qui ment sur son identité, un délai dépassé ou un JWKS en panne de façon
 * déterministe — et de COMPTER les requêtes sortantes, seule façon de prouver
 * qu'un jeton d'émetteur inconnu n'en déclenche aucune.
 *
 * Ce qui est prouvé ici :
 * - l'audience LIE le jeton à cette ressource (RFC 8707) — un jeton valide
 *   destiné à un autre service est refusé ;
 * - la liste d'émetteurs est fermée, et fermée AVANT toute requête ;
 * - une PANNE de l'émetteur n'est jamais rendue comme « jeton invalide » ;
 * - un algorithme à secret partagé ne peut pas entrer en configuration.
 */

const ISSUER = "https://auth.example.com/realms/nodefony";
const RESOURCE = "https://app.example/nodefony/mcp";
const OAUTH_METADATA_URL =
  "https://auth.example.com/.well-known/oauth-authorization-server/realms/nodefony";
const JWKS_URL = "https://auth.example.com/realms/nodefony/protocol/certs";

interface IFakeIssuer {
  sign: (
    claims: Record<string, unknown>,
    overrides?: ISignOverrides,
  ) => Promise<string>;
  jwks: { keys: JWK[] };
  kid: string;
}

interface ISignOverrides {
  audience?: string | string[];
  issuer?: string;
  expiresIn?: string;
  kid?: string;
  typ?: string;
  notBefore?: string;
}

/** Fabrique un émetteur factice : une paire de clés, son JWKS, son signeur. */
async function fakeIssuer(kid = "k1", alg = "ES256"): Promise<IFakeIssuer> {
  const { publicKey, privateKey } = await generateKeyPair(alg, {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = alg;
  jwk.use = "sig";
  return {
    kid,
    jwks: { keys: [jwk] },
    sign: (claims, overrides = {}) => {
      const jwt = new SignJWT(claims)
        .setProtectedHeader({
          alg,
          kid: overrides.kid ?? kid,
          ...(overrides.typ ? { typ: overrides.typ } : {}),
        })
        .setIssuer(overrides.issuer ?? ISSUER)
        .setAudience(overrides.audience ?? RESOURCE)
        .setIssuedAt()
        .setExpirationTime(overrides.expiresIn ?? "5m");
      if (overrides.notBefore) jwt.setNotBefore(overrides.notBefore);
      return jwt.sign(privateKey);
    },
  };
}

type FakeRoute = unknown | Error | { status: number };

interface IFakeNet {
  fetch: typeof globalThis.fetch;
  urls: string[];
}

/** `fetch` factice : une table d'URL, et la trace de ce qui a été demandé. */
function fakeNet(routes: Record<string, FakeRoute>): IFakeNet {
  const urls: string[] = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    const route = routes[url];
    if (route === undefined) {
      return new Response("not found", { status: 404 });
    }
    if (route instanceof Error) throw route;
    if (
      typeof route === "object" &&
      route !== null &&
      "status" in route &&
      Object.keys(route).length === 1
    ) {
      return new Response("boom", {
        status: (route as { status: number }).status,
      });
    }
    return new Response(JSON.stringify(route), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: impl as unknown as typeof globalThis.fetch, urls };
}

const metadata = { issuer: ISSUER, jwks_uri: JWKS_URL };

describe("RemoteJwtVerifier — configuration refusée au démarrage", () => {
  it("refuse un algorithme à secret partagé sur un jeu de clés PUBLIC", () => {
    assert.throws(
      () =>
        new RemoteJwtVerifier({
          issuers: [{ issuer: ISSUER, algorithms: ["HS256"] }],
        }),
      /secret partagé/,
    );
  });

  it("refuse une allowlist d'algorithmes vide", () => {
    assert.throws(
      () =>
        new RemoteJwtVerifier({
          issuers: [{ issuer: ISSUER, algorithms: [] }],
        }),
      /ne peut pas être vide/,
    );
  });

  it("refuse deux fois le même émetteur — la 2e politique serait muette", () => {
    assert.throws(
      () =>
        new RemoteJwtVerifier({
          issuers: [
            { issuer: ISSUER, algorithms: ["ES256"] },
            { issuer: `${ISSUER}/`, algorithms: ["RS256"] },
          ],
        }),
      /déclaré deux fois/,
    );
  });

  it("refuse un émetteur qui n'est pas une URL https", () => {
    assert.throws(
      () =>
        new RemoteJwtVerifier({
          issuers: [
            { issuer: "http://auth.example.com", algorithms: ["ES256"] },
          ],
        }),
      /https/,
    );
  });
});

describe("RemoteJwtVerifier — vérification d'un jeton", () => {
  it("accepte un jeton valide et rend sujet + scopes", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: issuer.jwks,
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });
    const token = await issuer.sign({
      sub: "agent-7",
      scope: "mcp:read mcp:call",
    });

    const principal = await verifier.verify(token, RESOURCE);

    assert.ok(principal);
    assert.equal(principal.subject, "agent-7");
    assert.deepEqual(principal.scopes, ["mcp:read", "mcp:call"]);
  });

  it("REFUSE un jeton valide émis pour une AUTRE ressource (RFC 8707)", async () => {
    // Le rejeu d'un jeton légitime d'un service vers un autre est exactement ce
    // que la liaison d'audience existe pour empêcher.
    const issuer = await fakeIssuer();
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: issuer.jwks,
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });
    const token = await issuer.sign(
      { sub: "agent-7" },
      { audience: "https://autre-service.example/api" },
    );

    assert.equal(await verifier.verify(token, RESOURCE), null);
  });

  it("refuse un émetteur non déclaré SANS aucune requête sortante", async () => {
    const intrus = await fakeIssuer();
    const net = fakeNet({});
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });
    const token = await intrus.sign(
      { sub: "x" },
      { issuer: "https://attaquant.example" },
    );

    assert.equal(await verifier.verify(token, RESOURCE), null);
    assert.deepEqual(net.urls, []);
  });

  it("refuse un jeton expiré", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: issuer.jwks,
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      clockToleranceS: 0,
      fetch: net.fetch,
    });
    const token = await issuer.sign({ sub: "x" }, { expiresIn: "-1m" });

    assert.equal(await verifier.verify(token, RESOURCE), null);
  });

  it("refuse une signature faite par une clé inconnue du jeu publié", async () => {
    const legitime = await fakeIssuer("k1");
    const forgeur = await fakeIssuer("k1"); // même kid, autre clé
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: legitime.jwks,
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      cooldownMs: 0,
      fetch: net.fetch,
    });
    const token = await forgeur.sign({ sub: "x" });

    assert.equal(await verifier.verify(token, RESOURCE), null);
  });

  it("refuse un jeton qui n'est pas un JWT", async () => {
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: fakeNet({}).fetch,
    });
    assert.equal(await verifier.verify("nf_opaque_abcdef", RESOURCE), null);
    assert.equal(await verifier.verify("", RESOURCE), null);
  });

  it("exige `typ` quand l'émetteur est déclaré conforme RFC 9068", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: issuer.jwks,
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"], typ: "at+jwt" }],
      fetch: net.fetch,
    });

    assert.equal(
      await verifier.verify(await issuer.sign({ sub: "x" }), RESOURCE),
      null,
    );
    const bon = await issuer.sign({ sub: "x" }, { typ: "at+jwt" });
    assert.ok(await verifier.verify(bon, RESOURCE));
  });

  it("exige les claims déclarés obligatoires", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: issuer.jwks,
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [
        { issuer: ISSUER, algorithms: ["ES256"], requiredClaims: ["sub"] },
      ],
      fetch: net.fetch,
    });

    assert.equal(await verifier.verify(await issuer.sign({}), RESOURCE), null);
    assert.ok(await verifier.verify(await issuer.sign({ sub: "x" }), RESOURCE));
  });
});

describe("RemoteJwtVerifier — découverte de l'émetteur", () => {
  it("essaie les points bien connus dans l'ordre et s'arrête au premier valide", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: issuer.jwks,
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });

    await verifier.verify(await issuer.sign({ sub: "x" }), RESOURCE);

    assert.equal(net.urls[0], OAUTH_METADATA_URL);
    assert.ok(net.urls.includes(JWKS_URL));
  });

  it("ÉCARTE un document qui se réclame d'un autre émetteur et poursuit", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({
      // Le premier point répond… au nom de quelqu'un d'autre.
      [OAUTH_METADATA_URL]: {
        issuer: "https://honnete.example",
        jwks_uri: "https://attaquant.example/keys",
      },
      "https://auth.example.com/.well-known/openid-configuration/realms/nodefony":
        metadata,
      [JWKS_URL]: issuer.jwks,
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });

    assert.ok(await verifier.verify(await issuer.sign({ sub: "x" }), RESOURCE));
    // Les clés de l'attaquant n'ont JAMAIS été demandées.
    assert.ok(!net.urls.includes("https://attaquant.example/keys"));
  });

  it("ne découvre RIEN quand `jwksUri` est déclaré", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({ [JWKS_URL]: issuer.jwks });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"], jwksUri: JWKS_URL }],
      fetch: net.fetch,
    });

    assert.ok(await verifier.verify(await issuer.sign({ sub: "x" }), RESOURCE));
    assert.deepEqual(net.urls, [JWKS_URL]);
  });

  it("ne découvre qu'UNE fois, même sur deux jetons concurrents", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: issuer.jwks,
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });
    const token = await issuer.sign({ sub: "x" });

    await Promise.all([
      verifier.verify(token, RESOURCE),
      verifier.verify(token, RESOURCE),
    ]);

    assert.equal(
      net.urls.filter((u) => u === OAUTH_METADATA_URL).length,
      1,
      "la découverte doit être partagée entre appels concurrents",
    );
  });
});

describe("RemoteJwtVerifier — une PANNE n'est pas un jeton invalide", () => {
  it("lève quand aucun point bien connu ne répond", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({});
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });
    const token = await issuer.sign({ sub: "x" });

    await assert.rejects(
      () => verifier.verify(token, RESOURCE),
      /découverte impossible/,
    );
  });

  it("lève quand le JWKS répond en erreur — jamais « jeton refusé »", async () => {
    // Cas qui a corrigé la conception : jose lève ici une erreur GÉNÉRIQUE,
    // sans code dédié. Une liste noire des pannes l'aurait classée en refus.
    const issuer = await fakeIssuer();
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: { status: 500 },
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });
    const token = await issuer.sign({ sub: "x" });

    await assert.rejects(
      () => verifier.verify(token, RESOURCE),
      /vérification impossible/,
    );
  });

  it("lève quand le réseau tombe pendant la récupération des clés", async () => {
    const issuer = await fakeIssuer();
    const net = fakeNet({
      [OAUTH_METADATA_URL]: metadata,
      [JWKS_URL]: new TypeError("fetch failed"),
    });
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });
    const token = await issuer.sign({ sub: "x" });

    await assert.rejects(
      () => verifier.verify(token, RESOURCE),
      /vérification impossible/,
    );
  });

  it("réessaie la découverte après une panne — elle n'est pas condamnée", async () => {
    const issuer = await fakeIssuer();
    const routes: Record<string, FakeRoute> = {};
    const net = fakeNet(routes);
    const verifier = new RemoteJwtVerifier({
      issuers: [{ issuer: ISSUER, algorithms: ["ES256"] }],
      fetch: net.fetch,
    });
    const token = await issuer.sign({ sub: "x" });

    await assert.rejects(() => verifier.verify(token, RESOURCE));
    // L'émetteur revient.
    routes[OAUTH_METADATA_URL] = metadata;
    routes[JWKS_URL] = issuer.jwks;

    assert.ok(await verifier.verify(token, RESOURCE));
  });
});
