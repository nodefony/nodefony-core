import { describe, it, expect } from "vitest";
import {
  MCP_ENDPOINT_PATH,
  protectedResourceMetadataPath,
  buildProtectedResourceMetadata,
} from "nodefony";
import { devkitConfigSchema } from "../nodefony/config/config";

/**
 * Ce que cette suite prouve : la CONFIGURATION du rôle serveur de ressource.
 *
 * Les fonctions elles-mêmes sont éprouvées au cœur (RFC 9728/6750/8707), et la
 * route sur serveur réel dans `mcp-http.test.ts`. Reste ce qui n'appartient
 * qu'ici : que le rôle soit **éteint par défaut**, que l'allumer sans audience
 * plante au BOOT plutôt qu'à la première requête d'un agent, et que le chemin
 * publié soit DÉRIVÉ de l'endpoint au lieu d'être recopié.
 */

const AS = "https://auth.example";

/** Raccourci : ne valide que le bloc `mcp` de la config du module. */
function parseMcp(mcp: unknown) {
  return devkitConfigSchema.parse({ mcp });
}

describe("devkit — rôle serveur de ressource ÉTEINT par défaut", () => {
  it("une application qui n'écrit rien reste anonyme", () => {
    const cfg = devkitConfigSchema.parse({});
    expect(cfg.mcp.authorization.authorizationServers).to.deep.equal([]);
    expect(cfg.mcp.authorization.resource).to.equal("");
    // Le défaut sûr : sans jeton, on refuse — mais seulement si le rôle est
    // allumé. Éteint, rien de tout cela ne s'applique.
    expect(cfg.mcp.authorization.anonymous).to.equal(false);
  });

  it("les défauts du sous-objet sont bien ré-appliqués (piège Zod 4)", () => {
    // `.default({})` à plat NE ré-applique pas les défauts des champs ; le
    // dépôt utilise `.default(() => schéma.parse({}))`. Sans ce détour, les
    // quatre champs ci-dessous seraient `undefined` et le code lirait des
    // `undefined.length`.
    const cfg = parseMcp({ enabled: true });
    expect(cfg.mcp.authorization.anonymous).to.equal(false);
    expect(cfg.mcp.authorization.additionalResources).to.deep.equal([]);
    expect(cfg.mcp.authorization.authorizationServers).to.deep.equal([]);
  });
});

describe("devkit — allumer le rôle exige une audience, au BOOT", () => {
  it("un serveur d'autorisation sans `resource` est refusé", () => {
    expect(() =>
      parseMcp({ authorization: { authorizationServers: [AS] } }),
    ).to.throw(/resource/);
  });

  it("une URI qui ne peut pas servir d'audience est refusée", () => {
    // Fragment : il n'atteint jamais le serveur (RFC 8707 §2).
    expect(() =>
      parseMcp({
        authorization: {
          authorizationServers: [AS],
          resource: "https://app.example/nodefony/mcp#x",
        },
      }),
    ).to.throw(/fragment/);
    // Sans schéma : une audience relative ne se compare à rien.
    expect(() =>
      parseMcp({
        authorization: {
          authorizationServers: [AS],
          resource: "app.example/nodefony/mcp",
        },
      }),
    ).to.throw();
  });

  it("une configuration complète passe et se relit telle qu'écrite", () => {
    const cfg = parseMcp({
      authorization: {
        authorizationServers: [AS],
        resource: "https://app.example/nodefony/mcp",
        anonymous: true,
      },
    });
    const authz = cfg.mcp.authorization;
    expect(authz.authorizationServers).to.deep.equal([AS]);
    expect(authz.resource).to.equal("https://app.example/nodefony/mcp");
    expect(authz.anonymous).to.equal(true);
  });

  it("🔴 les SCOPES ne s'écrivent pas en configuration — le schéma n'en a plus", () => {
    // Le sens du test : tant que la clé existe, quelqu'un l'écrira, et ce qu'il
    // écrira sera publié à la place de ce que le code exige. La dérivation vit
    // dans `DevkitService.declaredMcpScopes()` (union de `IMcpTool.scopes`) ;
    // ici on prouve seulement qu'aucune seconde source n'a survécu.
    expect(Object.keys(parseMcp({}).mcp.authorization)).to.not.include(
      "scopesSupported",
    );
  });
});

describe("devkit — le chemin publié est DÉRIVÉ de l'endpoint", () => {
  it("suit la règle d'insertion, pas une concaténation", () => {
    // Le littéral qu'on serait tenté d'écrire dans le décorateur deviendrait
    // faux au premier déménagement de la porte — et silencieusement : un client
    // sonderait ce chemin, recevrait 404, et conclurait « pas d'autorisation ».
    expect(protectedResourceMetadataPath(MCP_ENDPOINT_PATH)).to.equal(
      "/.well-known/oauth-protected-resource/nodefony/mcp",
    );
  });

  it("le document publié annonce l'en-tête comme seule présentation", () => {
    const doc = buildProtectedResourceMetadata({
      resource: "https://app.example/nodefony/mcp",
      authorizationServers: [AS],
      scopesSupported: ["nodefony:inspect"],
    });
    expect(doc.bearer_methods_supported).to.deep.equal(["header"]);
    expect(doc.authorization_servers).to.deep.equal([AS]);
    expect(doc.scopes_supported).to.deep.equal(["nodefony:inspect"]);
  });
});
