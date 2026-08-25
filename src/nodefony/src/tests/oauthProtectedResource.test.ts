/// <reference types="node" />
import { describe, it, expect } from "vitest";
import {
  canonicalResourceUri,
  protectedResourceMetadataPath,
  protectedResourceMetadataUrl,
  buildProtectedResourceMetadata,
  buildBearerChallenge,
  authorizeProtectedResource,
  missingScopes,
  BearerError,
  type IAccessTokenVerifier,
  type IProtectedResourcePolicy,
} from "../oauth/protectedResource";

/**
 * Rôle serveur de ressource OAuth 2.1 — RFC 9728 · 6750 · 8707.
 *
 * Chaque cas est ancré sur une exigence CITÉE, pas sur ce qui « paraît
 * raisonnable » : deux des comportements ci-dessous (le `400` d'une requête mal
 * formée, l'ABSENCE de code d'erreur quand rien n'a été présenté) sont
 * précisément ceux qu'on écrit faux de mémoire.
 */

const AS = "https://auth.example";

describe("canonicalResourceUri — l'audience se compare par chaîne exacte", () => {
  it("retire la barre oblique terminale (deux formes valides, une seule audience)", () => {
    expect(canonicalResourceUri("https://app.example/nodefony/mcp/")).to.equal(
      "https://app.example/nodefony/mcp",
    );
    expect(canonicalResourceUri("https://app.example/")).to.equal(
      "https://app.example",
    );
  });

  it("conserve le port et la requête, qui font partie de l'identité", () => {
    expect(canonicalResourceUri("https://app.example:8443/mcp")).to.equal(
      "https://app.example:8443/mcp",
    );
    expect(canonicalResourceUri("https://app.example/mcp?t=1")).to.equal(
      "https://app.example/mcp?t=1",
    );
  });

  it("refuse ce qui ne peut pas servir d'audience (RFC 8707 §2)", () => {
    // Sans schéma : une audience relative ne se compare à rien.
    expect(() => canonicalResourceUri("app.example/mcp")).to.throw();
    // Fragment : il n'atteint jamais le serveur, deux URI seraient reçues égales.
    expect(() => canonicalResourceUri("https://app.example/mcp#x")).to.throw(
      /fragment/,
    );
    expect(() => canonicalResourceUri("ftp://app.example/mcp")).to.throw(
      /schéma/,
    );
  });
});

describe("protectedResourceMetadataPath — INSERTION, pas concaténation (RFC 9728 §3.1)", () => {
  it("insère le suffixe entre l'hôte et le chemin", () => {
    expect(
      protectedResourceMetadataPath("https://app.example/nodefony/mcp"),
    ).to.equal("/.well-known/oauth-protected-resource/nodefony/mcp");
  });

  it("reproduit l'exemple littéral de la RFC", () => {
    expect(
      protectedResourceMetadataPath("https://resource.example.com/resource1"),
    ).to.equal("/.well-known/oauth-protected-resource/resource1");
  });

  it("sans composant de chemin, sert la racine", () => {
    expect(protectedResourceMetadataPath("https://app.example")).to.equal(
      "/.well-known/oauth-protected-resource",
    );
    expect(protectedResourceMetadataPath("https://app.example/")).to.equal(
      "/.well-known/oauth-protected-resource",
    );
  });

  it("accepte un chemin nu (plusieurs ressources par hôte)", () => {
    expect(protectedResourceMetadataPath("/nodefony/agents")).to.equal(
      "/.well-known/oauth-protected-resource/nodefony/agents",
    );
  });

  it("compose l'URL absolue du défi", () => {
    expect(
      protectedResourceMetadataUrl("https://app.example:8443/nodefony/mcp"),
    ).to.equal(
      "https://app.example:8443/.well-known/oauth-protected-resource/nodefony/mcp",
    );
  });
});

describe("buildProtectedResourceMetadata — un document qui mène quelque part", () => {
  it("refuse de publier sans serveur d'autorisation", () => {
    // La spec MCP l'exige (« MUST include […] at least one authorization
    // server ») ; un document sans lui apprend au client qu'un jeton existe,
    // sans jamais lui dire où le demander.
    expect(() =>
      buildProtectedResourceMetadata({
        resource: "https://app.example/nodefony/mcp",
        authorizationServers: [],
      }),
    ).to.throw(/serveur d'autorisation/);
    expect(() =>
      buildProtectedResourceMetadata({
        resource: "https://app.example/nodefony/mcp",
        authorizationServers: ["", ""],
      }),
    ).to.throw(/serveur d'autorisation/);
  });

  it("annonce l'en-tête comme SEULE présentation admise", () => {
    const doc = buildProtectedResourceMetadata({
      resource: "https://app.example/nodefony/mcp/",
      authorizationServers: [AS],
    });
    // « Access tokens MUST NOT be included in the URI query string ».
    expect(doc.bearer_methods_supported).to.deep.equal(["header"]);
    // L'URI publiée est la forme canonique, pas celle écrite en config.
    expect(doc.resource).to.equal("https://app.example/nodefony/mcp");
    expect(doc.authorization_servers).to.deep.equal([AS]);
  });

  it("omet les champs facultatifs vides plutôt que de publier du bruit", () => {
    const doc = buildProtectedResourceMetadata({
      resource: "https://app.example/nodefony/mcp",
      authorizationServers: [AS],
      scopesSupported: [],
    });
    expect(doc).to.not.have.property("scopes_supported");
    expect(doc).to.not.have.property("resource_name");
  });

  it("publie scopes et nom quand ils sont déclarés", () => {
    const doc = buildProtectedResourceMetadata({
      resource: "https://app.example/nodefony/mcp",
      authorizationServers: [AS, "https://auth2.example"],
      scopesSupported: ["nodefony:inspect"],
      resourceName: "Mon application",
      resourceDocumentation: "https://app.example/docs",
    });
    expect(doc.scopes_supported).to.deep.equal(["nodefony:inspect"]);
    expect(doc.resource_name).to.equal("Mon application");
    expect(doc.resource_documentation).to.equal("https://app.example/docs");
    expect(doc.authorization_servers).to.have.length(2);
  });

  it("copie les tableaux reçus (un appelant ne mute pas le document publié)", () => {
    const servers = [AS];
    const doc = buildProtectedResourceMetadata({
      resource: "https://app.example/mcp",
      authorizationServers: servers,
    });
    servers.push("https://intrus.example");
    expect(doc.authorization_servers).to.deep.equal([AS]);
  });
});

describe("buildBearerChallenge — ce qui rend l'autorisation APPRENABLE", () => {
  const url = "https://app.example/.well-known/oauth-protected-resource/mcp";

  it("cite toujours les métadonnées (RFC 9728 §5.1)", () => {
    expect(buildBearerChallenge({ resourceMetadataUrl: url })).to.equal(
      `Bearer resource_metadata="${url}"`,
    );
  });

  it("n'ajoute AUCUN code d'erreur quand on ne lui en donne pas", () => {
    // RFC 6750 §3 : « If the request lacks any authentication information […]
    // the resource server SHOULD NOT include an error code ». Un
    // `invalid_token` ferait renouveler en boucle un jeton qui n'existe pas.
    const challenge = buildBearerChallenge({ resourceMetadataUrl: url });
    expect(challenge).to.not.contain("error=");
  });

  it("joint les scopes par une espace, comme la grammaire l'impose", () => {
    const challenge = buildBearerChallenge({
      resourceMetadataUrl: url,
      scopes: ["a:read", "a:write"],
      error: BearerError.INSUFFICIENT_SCOPE,
    });
    expect(challenge).to.contain('scope="a:read a:write"');
    expect(challenge).to.contain('error="insufficient_scope"');
  });

  it("neutralise un guillemet de description, qui casserait l'en-tête", () => {
    const challenge = buildBearerChallenge({
      resourceMetadataUrl: url,
      description: 'jeton "x" rejete',
    });
    expect(challenge).to.contain("error_description=\"jeton 'x' rejete\"");
    // Une seule paire de guillemets ouvrante/fermante par paramètre.
    expect(challenge.split('"').length - 1).to.equal(4);
  });

  it("🔴 réduit la description au jeu de caractères de la RFC 6750 §3", () => {
    // Un en-tête HTTP n'est pas de l'UTF-8 : un accent y ressort en mojibake
    // chez le client. Constaté en LIVE — « jeton refusé » arrivait « jeton
    // refus? ». La grammaire de la RFC est `%x20-21 / %x23-5B / %x5D-7E`.
    const challenge = buildBearerChallenge({
      resourceMetadataUrl: url,
      description: "en-tête mal formé — schéma attendu",
    });
    expect(challenge).to.contain(
      'error_description="en-t te mal form sch ma attendu"',
    );
    // Aucun octet hors ASCII imprimable ne subsiste dans l'en-tête entier.
    // eslint-disable-next-line no-control-regex
    expect(/[^\x20-\x7e]/.test(challenge)).to.equal(false);
  });

  it("un antislash ne survit pas non plus — il casserait la chaîne citée", () => {
    const challenge = buildBearerChallenge({
      resourceMetadataUrl: url,
      description: 'a\\"b',
    });
    expect(challenge).to.not.contain("\\");
  });
});

describe("authorizeProtectedResource — les six issues, sans serveur", () => {
  const policy: IProtectedResourcePolicy = {
    resource: "https://app.example/nodefony/mcp",
    metadataUrl:
      "https://app.example/.well-known/oauth-protected-resource/nodefony/mcp",
    scopes: ["nodefony:inspect"],
    allowAnonymous: false,
  };
  const accept: IAccessTokenVerifier = async (token) =>
    token === "bon"
      ? {
          issuer: "https://idp.example",
          subject: "alice",
          scopes: ["nodefony:inspect"],
        }
      : null;

  it("sans jeton et porte fermée : 401 SANS code d'erreur", async () => {
    const r = await authorizeProtectedResource(undefined, policy, accept);
    expect(r.outcome).to.equal("challenge");
    if (r.outcome !== "challenge") return;
    expect(r.status).to.equal(401);
    expect(r.wwwAuthenticate).to.contain("resource_metadata=");
    expect(r.wwwAuthenticate).to.not.contain("error=");
  });

  it("sans jeton et porte ouverte : anonyme", async () => {
    const r = await authorizeProtectedResource(
      undefined,
      { ...policy, allowAnonymous: true },
      accept,
    );
    expect(r.outcome).to.equal("anonymous");
  });

  it("en-tête mal formé : 400 invalid_request (et non 401)", async () => {
    // RFC 6750 §3.1 : « The resource server SHOULD respond with the HTTP 400 ».
    // Un AUTRE schéma, ou un schéma collé à sa valeur : le client croit
    // s'authentifier et ne le fait pas — le lui dire est le service à rendre.
    for (const bad of ["Basic dXNlcjpw", "Bearerabc"]) {
      const r = await authorizeProtectedResource(bad, policy, accept);
      expect(r.outcome, bad).to.equal("challenge");
      if (r.outcome !== "challenge") return;
      expect(r.status, bad).to.equal(400);
      expect(r.wwwAuthenticate, bad).to.contain('error="invalid_request"');
    }
  });

  it("🔴 `Bearer` SANS jeton ne vaut pas mieux ni pire qu'aucun en-tête", async () => {
    // Le cas COURANT, et celui qui a coûté la capacité : un client dont la
    // variable d'environnement n'est pas substituée envoie `Authorization:
    // Bearer `. Il n'affirme RIEN — RFC 6750 §3, « the request lacks any
    // authentication information » : ni code d'erreur, ni 400. La porte lui
    // doit exactement ce qu'elle doit à un client muet, sans quoi elle punit
    // plus sévèrement celui qui n'a rien à dire que celui qui se tait.
    for (const vide of ["Bearer", "Bearer ", "Bearer   ", "bearer\t"]) {
      const ferme = await authorizeProtectedResource(vide, policy, accept);
      expect(ferme.outcome, vide).to.equal("challenge");
      if (ferme.outcome !== "challenge") return;
      expect(ferme.status, vide).to.equal(401);
      // Aucun code d'erreur : il n'y a rien à juger.
      expect(ferme.wwwAuthenticate, vide).to.not.contain("error=");

      // Et porte ouverte, il est servi comme l'anonyme qu'il est — c'est CE
      // chemin qui rendait un agent sans outils alors que la porte en publie.
      const ouverte = await authorizeProtectedResource(
        vide,
        { ...policy, allowAnonymous: true },
        accept,
      );
      expect(ouverte.outcome, vide).to.equal("anonymous");
    }
  });

  it("🔴 porte TOLÉRANTE : un jeton rejeté est servi en anonyme, et le rejet se DIT", async () => {
    // Le paradoxe que ce cas ferme : sans en-tête, le client obtenait les
    // outils publics ; avec un jeton EXPIRÉ, il obtenait `401` et plus rien —
    // un client MCP marque alors le serveur « failed » pour toute la session.
    // Présenter mal ne peut pas valoir moins que ne rien présenter.
    const r = await authorizeProtectedResource(
      "Bearer perime",
      { ...policy, allowAnonymous: true },
      accept,
    );
    expect(r.outcome).to.equal("anonymous");
    // …et le rejet n'est pas tu : la porte a de quoi le journaliser. Sans ce
    // drapeau, un jeton périmé serait indistinguable d'une requête muette.
    if (r.outcome !== "anonymous") return;
    expect(r.rejected).to.equal(true);
    // Aucun privilège accordé au passage : c'est un anonyme, pas un porteur.
    const muet = await authorizeProtectedResource(
      undefined,
      { ...policy, allowAnonymous: true },
      accept,
    );
    expect(muet.outcome).to.equal("anonymous");
    expect((muet as { rejected?: true }).rejected).to.equal(undefined);
  });

  it("porte FERMÉE : un jeton rejeté reste un 401 — c'est là que le drapeau compte", async () => {
    const r = await authorizeProtectedResource("Bearer perime", policy, accept);
    expect(r.outcome).to.equal("challenge");
    if (r.outcome !== "challenge") return;
    expect(r.status).to.equal(401);
  });

  it("jeton refusé : 401 invalid_token, sans dire POURQUOI", async () => {
    const r = await authorizeProtectedResource("Bearer faux", policy, accept);
    expect(r.outcome).to.equal("challenge");
    if (r.outcome !== "challenge") return;
    expect(r.status).to.equal(401);
    expect(r.wwwAuthenticate).to.contain('error="invalid_token"');
    // Anti-oracle : aucune cause fine ne sort (expiré / audience / signature).
    expect(r.wwwAuthenticate).to.not.match(/expir|audience|signature/i);
  });

  it("jeton validé : le principal remonte", async () => {
    const r = await authorizeProtectedResource("Bearer bon", policy, accept);
    expect(r.outcome).to.equal("authenticated");
    if (r.outcome !== "authenticated") return;
    expect(r.principal.subject).to.equal("alice");
    expect(r.principal.scopes).to.deep.equal(["nodefony:inspect"]);
  });

  it("un porteur présenté sans rien pour le juger : JAMAIS servi", async () => {
    // Le défaut sûr : servir en anonyme reviendrait à traiter le jeton comme
    // s'il n'existait pas — donc à accepter en pratique n'importe lequel.
    const r = await authorizeProtectedResource("Bearer bon", policy, undefined);
    expect(r.outcome).to.equal("unverifiable");
  });

  it("l'audience passée au vérificateur est CELLE de la ressource", async () => {
    // RFC 8707 : c'est la seule chose qui empêche un jeton émis pour un autre
    // service d'être rejoué ici.
    let vu = "";
    await authorizeProtectedResource(
      "Bearer bon",
      policy,
      async (_t, audience) => {
        vu = audience;
        return { issuer: "https://idp.example", scopes: [] };
      },
    );
    expect(vu).to.equal("https://app.example/nodefony/mcp");
  });
});

describe("missingScopes — TOUS, jamais « au moins un »", () => {
  it("rend ce qui manque", () => {
    expect(missingScopes(["a"], ["a", "b"])).to.deep.equal(["b"]);
    expect(missingScopes(["a", "b"], ["a", "b"])).to.deep.equal([]);
    expect(missingScopes([], [])).to.deep.equal([]);
  });

  it("un scope accordé ne suffit pas quand deux sont exigés", () => {
    // La disjonction reviendrait à accorder le plus large de la liste.
    expect(missingScopes(["lecture"], ["lecture", "ecriture"])).to.deep.equal([
      "ecriture",
    ]);
  });
});

/**
 * Ce que cette suite prouve : qu'une ressource peut avoir PLUSIEURS adresses
 * sans que la liaison d'audience cesse de mordre, et qu'une PANNE de
 * vérification ne se confond ni avec un refus, ni avec une erreur du client.
 */
describe("authorizeProtectedResource — plusieurs adresses, et la panne", () => {
  const base: IProtectedResourcePolicy = {
    resource: "http://app.example:5151/nodefony/mcp",
    metadataUrl:
      "http://app.example:5151/.well-known/oauth-protected-resource/nodefony/mcp",
    allowAnonymous: false,
  };

  /** Un vérificateur qui n'accepte QU'UNE audience — comme un vrai. */
  const lie =
    (audienceAttendue: string, vues: string[]): IAccessTokenVerifier =>
    async (_token, audience) => {
      vues.push(audience);
      return audience === audienceAttendue
        ? { issuer: "https://idp.example", subject: "agent", scopes: [] }
        : null;
    };

  it("accepte un jeton émis pour une AUTRE adresse de la même ressource", async () => {
    const vues: string[] = [];
    const r = await authorizeProtectedResource(
      "Bearer jeton",
      { ...base, acceptedResources: ["https://app.example:5152/nodefony/mcp"] },
      lie("https://app.example:5152/nodefony/mcp", vues),
    );
    expect(r.outcome).to.equal("authenticated");
    // L'adresse PUBLIÉE est essayée en premier — c'est celle qu'un client
    // conforme aura suivie ; la seconde n'est un repli que parce qu'elle est
    // ÉCRITE dans la configuration.
    expect(vues).to.deep.equal([
      "http://app.example:5151/nodefony/mcp",
      "https://app.example:5152/nodefony/mcp",
    ]);
  });

  it("🔴 refuse une audience qui n'est PAS déclarée — la liaison mord toujours", async () => {
    // Sens du test : élargir la liste ne doit pas la supprimer. Un jeton émis
    // pour un autre service reste un jeton pour un autre service.
    const vues: string[] = [];
    const r = await authorizeProtectedResource(
      "Bearer jeton",
      { ...base, acceptedResources: ["https://app.example:5152/nodefony/mcp"] },
      lie("https://api.etranger.example/v1", vues),
    );
    expect(r.outcome).to.equal("challenge");
    if (r.outcome !== "challenge") return;
    expect(r.status).to.equal(401);
    // Rien n'a été essayé hors de la liste ÉCRITE.
    expect(vues).to.not.contain("https://api.etranger.example/v1");
  });

  it("sans autres adresses déclarées, une seule audience est essayée", async () => {
    const vues: string[] = [];
    await authorizeProtectedResource("Bearer jeton", base, lie("aucune", vues));
    expect(vues).to.deep.equal(["http://app.example:5151/nodefony/mcp"]);
  });

  it("🔴 un vérificateur qui LÈVE rend `unverifiable`, jamais une exception", async () => {
    // Sens du test : sans ce rattrapage, l'exception traversait la porte et
    // sortait en 500 avec sa trace d'appels — le porteur d'un jeton valide
    // lisait une pile Node, et l'exploitant cherchait la faute dans le jeton.
    const panne: IAccessTokenVerifier = async () => {
      throw new Error("émetteur injoignable — SELF_SIGNED_CERT_IN_CHAIN");
    };
    const r = await authorizeProtectedResource("Bearer jeton", base, panne);
    expect(r.outcome).to.equal("unverifiable");
    if (r.outcome !== "unverifiable") return;
    // La cause est portée POUR LE JOURNAL — le client, lui, reçoit un refus nu.
    expect(r.why).to.contain("SELF_SIGNED_CERT_IN_CHAIN");
  });

  it("distingue la panne de l'ABSENCE de vérificateur", async () => {
    const r = await authorizeProtectedResource("Bearer jeton", base, undefined);
    expect(r.outcome).to.equal("unverifiable");
    if (r.outcome !== "unverifiable") return;
    // Rien n'a échoué : rien n'était posé. Le journal doit pouvoir le dire.
    expect(r.why).to.equal(undefined);
  });
});
