import assert from "node:assert/strict";
import {
  canonicalIssuer,
  extractScopes,
  issuerMetadataUrls,
  validateIssuerMetadata,
} from "../../nodefony/src/token/issuerDiscovery";

/**
 * Découverte d'un serveur d'autorisation TIERS — gates :
 * - un émetteur est en https, sans requête ni fragment (RFC 8414 §2).
 * - l'ordre des points bien connus est celui de la norme (insertion d'abord),
 *   sinon un émetteur multi-tenant interroge le tenant au lieu du serveur.
 * - un document qui parle au nom d'un AUTRE émetteur est rejeté (RFC 8414 §3.3)
 *   — c'est la garde qui empêche un attaquant de publier des clés au nom d'un
 *   émetteur légitime.
 * - les deux formes de scopes du parc réel (`scope` et `scp`) sont lues.
 */

const ISSUER = "https://auth.example.com/tenant1";

describe("canonicalIssuer — ce qui peut servir d'émetteur", () => {
  it("normalise et retire la barre oblique terminale", () => {
    assert.equal(
      canonicalIssuer("https://auth.example.com/tenant1/"),
      "https://auth.example.com/tenant1",
    );
    assert.equal(
      canonicalIssuer("https://auth.example.com"),
      "https://auth.example.com",
    );
  });

  it("refuse http — les clés de signature transitent par ce canal", () => {
    assert.throws(() => canonicalIssuer("http://auth.example.com"), /https/);
  });

  it("refuse une requête ou un fragment (RFC 8414 §2)", () => {
    assert.throws(() => canonicalIssuer("https://a.example?x=1"), /requête/);
    assert.throws(() => canonicalIssuer("https://a.example#f"), /fragment/);
  });

  it("refuse ce qui n'est pas une URL absolue", () => {
    assert.throws(() => canonicalIssuer("auth.example.com"), /URL absolue/);
  });
});

describe("issuerMetadataUrls — l'ordre est normatif", () => {
  it("émetteur AVEC chemin : insertion d'abord, ajout en dernier", () => {
    assert.deepEqual(issuerMetadataUrls(ISSUER), [
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
      "https://auth.example.com/.well-known/openid-configuration/tenant1",
      "https://auth.example.com/tenant1/.well-known/openid-configuration",
    ]);
  });

  it("émetteur SANS chemin : deux formes seulement", () => {
    assert.deepEqual(issuerMetadataUrls("https://auth.example.com"), [
      "https://auth.example.com/.well-known/oauth-authorization-server",
      "https://auth.example.com/.well-known/openid-configuration",
    ]);
  });
});

describe("validateIssuerMetadata — à qui appartient ce document ?", () => {
  it("accepte un document cohérent et rend le jwks_uri", () => {
    const metadata = validateIssuerMetadata(
      { issuer: ISSUER, jwks_uri: "https://auth.example.com/keys" },
      ISSUER,
    );
    assert.equal(metadata.issuer, ISSUER);
    assert.equal(metadata.jwksUri, "https://auth.example.com/keys");
  });

  it("tolère une barre terminale de part et d'autre", () => {
    const metadata = validateIssuerMetadata(
      { issuer: `${ISSUER}/`, jwks_uri: "https://auth.example.com/keys" },
      ISSUER,
    );
    assert.equal(metadata.issuer, ISSUER);
  });

  it("REJETTE un document qui se réclame d'un autre émetteur", () => {
    // Le cas nommé par la norme : servi par attaquant.example, il se déclare
    // honnête.example. L'accepter ferait vérifier des jetons avec SES clés.
    assert.throws(
      () =>
        validateIssuerMetadata(
          {
            issuer: "https://honnete.example",
            jwks_uri: "https://attaquant.example/keys",
          },
          "https://attaquant.example",
        ),
      /égalité/,
    );
  });

  it("refuse un jwks_uri absent, non-URL, ou en clair", () => {
    assert.throws(
      () => validateIssuerMetadata({ issuer: ISSUER }, ISSUER),
      /jwks_uri` absent/,
    );
    assert.throws(
      () =>
        validateIssuerMetadata({ issuer: ISSUER, jwks_uri: "keys" }, ISSUER),
      /n'est pas une URL/,
    );
    assert.throws(
      () =>
        validateIssuerMetadata(
          { issuer: ISSUER, jwks_uri: "http://auth.example.com/keys" },
          ISSUER,
        ),
      /https/,
    );
  });

  it("refuse ce qui n'est pas un document", () => {
    assert.throws(() => validateIssuerMetadata(null, ISSUER), /JSON attendu/);
    assert.throws(() => validateIssuerMetadata("{}", ISSUER), /JSON attendu/);
  });
});

describe("extractScopes — les deux formes du parc réel", () => {
  it("lit `scope` (chaîne séparée par des espaces)", () => {
    assert.deepEqual(extractScopes({ scope: "read write" }), ["read", "write"]);
    assert.deepEqual(extractScopes({ scope: "" }), []);
    assert.deepEqual(extractScopes({ scope: "  read   write " }), [
      "read",
      "write",
    ]);
  });

  it("lit `scp` (tableau) — sinon des jetons valides paraissent sans droits", () => {
    assert.deepEqual(extractScopes({ scp: ["read", "write"] }), [
      "read",
      "write",
    ]);
    assert.deepEqual(extractScopes({ scp: ["read", 42, null] }), ["read"]);
  });

  it("rend un tableau vide quand rien n'est accordé", () => {
    assert.deepEqual(extractScopes({}), []);
    assert.deepEqual(extractScopes({ scope: 42 }), []);
  });
});
