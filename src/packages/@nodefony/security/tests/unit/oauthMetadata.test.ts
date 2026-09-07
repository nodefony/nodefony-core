import assert from "node:assert/strict";
import { discoverAuthorizationServer } from "../../nodefony/src/oauth/metadata";

/**
 * Découverte des métadonnées (RFC 8414) — la face CLIENTE de la règle que le cœur
 * porte déjà (`nodefony` → `src/oauth/authorizationServer.ts`). On y éprouve donc
 * ce que ce module ajoute — le transport et les deux points d'entrée — ET le fait
 * qu'il APPELLE bien la règle du cœur au lieu de la refaire : ordre normatif des
 * URL candidates, et égalité stricte de l'émetteur.
 */

const ISSUER = "https://idp.test/realms/app";

/** Ordre NORMATIF (RFC 8414 §3.1) : insertion oauth → insertion oidc → ajout oidc. */
const CANDIDATES = [
  "https://idp.test/.well-known/oauth-authorization-server/realms/app",
  "https://idp.test/.well-known/openid-configuration/realms/app",
  "https://idp.test/realms/app/.well-known/openid-configuration",
];

function document(overrides: Record<string, unknown> = {}): unknown {
  return {
    issuer: ISSUER,
    authorization_endpoint: "https://idp.test/realms/app/auth",
    token_endpoint: "https://idp.test/realms/app/token",
    jwks_uri: "https://idp.test/realms/app/certs",
    code_challenge_methods_supported: ["S256"],
    ...overrides,
  };
}

/**
 * Sert `routes` et rend de VRAIS objets `Response` — un double partiel ne
 * traverserait pas la lecture bornée, qui lit les en-têtes puis le flux.
 * Le `fetch` est INJECTÉ, jamais posé sur l'objet global.
 */
function serve(routes: Record<string, unknown>): {
  fetch: typeof globalThis.fetch;
  seen: string[];
} {
  const seen: string[] = [];
  const fetch = ((url: string) => {
    seen.push(url);
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
  return { fetch, seen };
}

describe("discoverAuthorizationServer", () => {
  it("suit l'ordre NORMATIF du cœur et rend les points d'entrée", async () => {
    const { fetch, seen } = serve({ [CANDIDATES[0]!]: document() });
    const metadata = await discoverAuthorizationServer(ISSUER, { fetch });
    assert.deepEqual(seen, [CANDIDATES[0]]);
    assert.equal(metadata.issuer, ISSUER);
    assert.equal(
      metadata.authorizationEndpoint,
      "https://idp.test/realms/app/auth",
    );
    assert.equal(metadata.tokenEndpoint, "https://idp.test/realms/app/token");
    assert.equal(metadata.jwksUri, "https://idp.test/realms/app/certs");
    assert.deepEqual(metadata.codeChallengeMethodsSupported, ["S256"]);
  });

  it("essaie les trois formes, dans l'ordre, jusqu'à la dernière", async () => {
    const { fetch, seen } = serve({ [CANDIDATES[2]!]: document() });
    const metadata = await discoverAuthorizationServer(ISSUER, { fetch });
    assert.deepEqual(seen, CANDIDATES);
    assert.equal(metadata.tokenEndpoint, "https://idp.test/realms/app/token");
  });

  it("émetteur sans chemin : deux formes seulement", async () => {
    const root = "https://idp.test";
    const { fetch, seen } = serve({
      "https://idp.test/.well-known/openid-configuration": {
        issuer: root,
        authorization_endpoint: "https://idp.test/auth",
        token_endpoint: "https://idp.test/token",
        jwks_uri: "https://idp.test/certs",
      },
    });
    const metadata = await discoverAuthorizationServer(root, { fetch });
    assert.deepEqual(seen, [
      "https://idp.test/.well-known/oauth-authorization-server",
      "https://idp.test/.well-known/openid-configuration",
    ]);
    assert.equal(metadata.codeChallengeMethodsSupported, null);
  });

  it("une barre oblique terminale ne change RIEN (formes canonisées des deux côtés)", async () => {
    const { fetch } = serve({ [CANDIDATES[0]!]: document() });
    const metadata = await discoverAuthorizationServer(`${ISSUER}/`, { fetch });
    assert.equal(metadata.issuer, ISSUER);
  });

  it("émetteur DISCORDANT → refus, même si le document est par ailleurs valide (RFC 8414 §3.3)", async () => {
    const { fetch } = serve({
      [CANDIDATES[0]!]: document({ issuer: "https://attaquant.test" }),
    });
    await assert.rejects(
      () => discoverAuthorizationServer(ISSUER, { fetch }),
      /RFC 8414 §3.3/,
    );
  });

  it("un document trouvé mais discordant n'est PAS contourné par la voie suivante", async () => {
    const { fetch, seen } = serve({
      [CANDIDATES[0]!]: document({ issuer: "https://attaquant.test" }),
      [CANDIDATES[1]!]: document(),
    });
    await assert.rejects(() => discoverAuthorizationServer(ISSUER, { fetch }));
    assert.equal(seen.length, 1, "la seconde voie ne doit pas être tentée");
  });

  it("point d'entrée manquant → refus nommant le champ", async () => {
    const { fetch } = serve({
      [CANDIDATES[0]!]: document({ token_endpoint: undefined }),
    });
    await assert.rejects(
      () => discoverAuthorizationServer(ISSUER, { fetch }),
      /token_endpoint/,
    );
  });

  it("point d'entrée en clair → refus", async () => {
    const { fetch } = serve({
      [CANDIDATES[0]!]: document({ token_endpoint: "http://idp.test/token" }),
    });
    await assert.rejects(
      () => discoverAuthorizationServer(ISSUER, { fetch }),
      /https/,
    );
  });

  it("jeu de clés absent → refus (garde du cœur, pas d'une copie locale)", async () => {
    const { fetch } = serve({
      [CANDIDATES[0]!]: document({ jwks_uri: undefined }),
    });
    await assert.rejects(
      () => discoverAuthorizationServer(ISSUER, { fetch }),
      /jwks_uri/,
    );
  });

  it("aucune voie ne répond → refus qui rapporte les tentatives", async () => {
    const { fetch } = serve({});
    await assert.rejects(
      () => discoverAuthorizationServer(ISSUER, { fetch }),
      /métadonnées introuvables/,
    );
  });

  it("émetteur en clair ou porteur d'une requête → refus (RFC 8414 §2, règle du cœur)", async () => {
    const { fetch } = serve({});
    await assert.rejects(
      () => discoverAuthorizationServer("http://idp.test", { fetch }),
      /https/,
    );
    await assert.rejects(
      () =>
        discoverAuthorizationServer("https://idp.test/realms/app?x=1", {
          fetch,
        }),
      /requête ou/,
    );
  });

  it("corps hors gabarit → refus AVANT d'analyser", async () => {
    const fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(document()), {
          status: 200,
          headers: { "content-length": "9999999" },
        }),
      )) as unknown as typeof globalThis.fetch;
    await assert.rejects(
      () => discoverAuthorizationServer(ISSUER, { fetch }),
      /hors gabarit/,
    );
  });
});
