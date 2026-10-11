import assert from "node:assert/strict";
import {
  authorizationServerMetadataPath,
  buildAuthorizationServerMetadata,
  canonicalIssuer,
  extractScopes,
  issuerMetadataUrls,
  isBackChannelTransportAllowed,
  metadataCandidateUrls,
  parseDiscoveryUrl,
  validateIssuerMetadata,
  JWKS_PATH,
} from "../oauth/authorizationServer";

/**
 * Rôle serveur d'autorisation (RFC 8414) — gates des DEUX faces :
 * - un émetteur est en https, sans requête ni fragment (RFC 8414 §2).
 * - l'ordre des points bien connus est celui de la norme (insertion d'abord),
 *   sinon un émetteur multi-tenant interroge le tenant au lieu du serveur.
 * - un document qui parle au nom d'un AUTRE émetteur est rejeté (RFC 8414 §3.3)
 *   — c'est la garde qui empêche un attaquant de publier des clés au nom d'un
 *   émetteur légitime.
 * - les deux formes de scopes du parc réel (`scope` et `scp`) sont lues.
 * - ⭐ **ce qu'on PUBLIE est exactement ce qu'un lecteur VA CHERCHER** : la
 *   dernière suite ferme la boucle, seul moyen que deux applications Nodefony
 *   se découvrent l'une l'autre.
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

describe("authorizationServerMetadataPath — où PUBLIER", () => {
  it("sert à la racine quand l'émetteur n'a pas de chemin", () => {
    assert.equal(
      authorizationServerMetadataPath("https://app.example"),
      "/.well-known/oauth-authorization-server",
    );
  });

  it("INSÈRE le suffixe avant le chemin, jamais après (RFC 8414 §3.1)", () => {
    assert.equal(
      authorizationServerMetadataPath("https://app.example/tenant1"),
      "/.well-known/oauth-authorization-server/tenant1",
    );
  });

  it("retire la barre terminale avant d'insérer", () => {
    assert.equal(
      authorizationServerMetadataPath("https://app.example/tenant1/"),
      "/.well-known/oauth-authorization-server/tenant1",
    );
  });

  it("refuse ce qui ne peut pas être un émetteur", () => {
    assert.throws(
      () => authorizationServerMetadataPath("http://app.example"),
      /https/,
    );
  });
});

describe("buildAuthorizationServerMetadata — ce qu'on publie de soi", () => {
  it("porte l'émetteur canonique et une URL de clés absolue", () => {
    const doc = buildAuthorizationServerMetadata({
      issuer: "https://app.example/",
    });
    assert.equal(doc.issuer, "https://app.example");
    assert.equal(doc.jwks_uri, `https://app.example${JWKS_PATH}`);
  });

  it("ANNONCE l'absence de flux au lieu de laisser jouer les défauts", () => {
    // `grant_types_supported` omis vaudrait ["authorization_code","implicit"]
    // (RFC 8414 §2) — deux flux que cette application n'offre pas.
    const doc = buildAuthorizationServerMetadata({
      issuer: "https://app.example",
    });
    assert.deepEqual(doc.response_types_supported, []);
    assert.deepEqual(doc.grant_types_supported, []);
  });

  it("refuse un émetteur qui n'est pas un identifiant RFC 8414 §2", () => {
    assert.throws(
      () => buildAuthorizationServerMetadata({ issuer: "http://app.example" }),
      /https/,
    );
    assert.throws(
      () => buildAuthorizationServerMetadata({ issuer: "nodefony" }),
      /URL absolue/,
    );
  });

  it("refuse un jeu de clés hors https, même explicitement demandé", () => {
    assert.throws(
      () =>
        buildAuthorizationServerMetadata({
          issuer: "https://app.example",
          jwksPath: "http://ailleurs.example/keys",
        }),
      /https/,
    );
  });
});

describe("⭐ la boucle : ce qu'on publie est ce qu'un lecteur cherche", () => {
  // Si quelqu'un réécrit un littéral d'un côté, cette suite tombe — c'est la
  // seule garde contre deux applications Nodefony qui ne se voient pas.
  for (const issuer of [
    "https://app.example",
    "https://app.example/tenant1",
    "https://app.example/realms/mon-royaume",
  ]) {
    it(`« ${issuer} » se découvre là où il se publie`, () => {
      const { origin } = new URL(issuer);
      assert.equal(
        issuerMetadataUrls(canonicalIssuer(issuer))[0],
        `${origin}${authorizationServerMetadataPath(issuer)}`,
      );
    });
  }

  it("le document renvoie vers le chemin de clés RÉELLEMENT servi", () => {
    const doc = buildAuthorizationServerMetadata({
      issuer: "https://app.example/tenant1",
    });
    assert.equal(new URL(doc.jwks_uri).pathname, JWKS_PATH);
  });
});

/**
 * `discoveryUrl` — lire le document ailleurs que chez l'émetteur (service
 * interne d'un cluster), SANS relâcher l'égalité de l'émetteur (RFC 8414 §3.3).
 */
describe("authorizationServer — adresse de découverte déclarée", () => {
  const PUBLIC = "https://sso.example.com/realms/app";
  const INTERNAL =
    "http://keycloak.sso:8080/realms/app/.well-known/openid-configuration";

  it("l'adresse déclarée REMPLACE les points bien connus, et elle seule", () => {
    assert.deepEqual(metadataCandidateUrls(PUBLIC, INTERNAL), [INTERNAL]);
    assert.deepEqual(metadataCandidateUrls(PUBLIC), issuerMetadataUrls(PUBLIC));
  });

  it("refuse une adresse qui n'est pas http(s), ou qui porte identifiants ou fragment", () => {
    assert.throws(() => parseDiscoveryUrl("keycloak:8080"), /http ou https/);
    assert.throws(() => parseDiscoveryUrl("pas une url"), /pas une URL/);
    assert.throws(
      () => parseDiscoveryUrl("http://u:p@keycloak.sso:8080/x"),
      /identifiants/,
    );
    assert.throws(
      () => parseDiscoveryUrl("http://keycloak.sso:8080/x#f"),
      /fragment/,
    );
  });

  it("le document lu à l'adresse interne doit TOUJOURS se déclarer de l'émetteur public", () => {
    assert.throws(
      () =>
        validateIssuerMetadata(
          {
            issuer: "https://keycloak.sso:8443/realms/app",
            jwks_uri: "http://keycloak.sso:8080/realms/app/certs",
          },
          PUBLIC,
          INTERNAL,
        ),
      /égalité/,
    );
  });

  it("jwks_uri en http admis sur l'origine EXACTE de l'adresse déclarée", () => {
    const keys =
      "http://keycloak.sso:8080/realms/app/protocol/openid-connect/certs";
    assert.equal(
      validateIssuerMetadata(
        { issuer: PUBLIC, jwks_uri: keys },
        PUBLIC,
        INTERNAL,
      ).jwksUri,
      keys,
    );
  });

  it("jwks_uri en http refusé sur une AUTRE origine — port compris", () => {
    for (const keys of [
      "http://ailleurs.sso:8080/certs",
      "http://keycloak.sso:9090/certs",
    ]) {
      assert.throws(
        () =>
          validateIssuerMetadata(
            { issuer: PUBLIC, jwks_uri: keys },
            PUBLIC,
            INTERNAL,
          ),
        /origine de discoveryUrl/,
      );
    }
  });

  it("transport serveur à serveur : https toujours, http seulement sur l'origine déclarée", () => {
    assert.equal(
      isBackChannelTransportAllowed(new URL("https://x.example/t")),
      true,
    );
    assert.equal(
      isBackChannelTransportAllowed(new URL("http://keycloak.sso:8080/t")),
      false,
    );
    assert.equal(
      isBackChannelTransportAllowed(
        new URL("http://keycloak.sso:8080/t"),
        INTERNAL,
      ),
      true,
    );
  });
});
