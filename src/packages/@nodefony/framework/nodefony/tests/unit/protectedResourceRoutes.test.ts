import assert from "node:assert/strict";
import type { IProtectedResourceInput } from "nodefony";
import {
  protectedResourceRoutePaths,
  collectProtectedResources,
  type IServiceScan,
} from "../../controller/ProtectedResourceMetadataController";
import {
  askedAuthority,
  onDeclaredAuthority,
} from "../../controller/oauthAuthority";

/**
 * Les deux décisions PURES qui séparent un document servi d'un `404` :
 * **où** monter la route (dérivation du chemin, RFC 9728 §3.1) et **sur quelle
 * autorité** répondre (§3.3).
 *
 * Elles sont testées ici plutôt qu'à travers le serveur parce qu'elles n'ont
 * besoin d'aucun décor — et parce que le banc d'intégration, lui, ne peut pas
 * exercer les cas tordus : une ressource d'un autre hôte, une URI invalide, deux
 * zones sur le même chemin.
 *
 * 🔴 La garde d'autorité n'est pas une précaution de style : le document
 * d'émetteur a réellement été servi sur TOUTE autorité, et un vrai client MCP
 * s'est arrêté net en recevant le document de `https://localhost:5152` sur
 * `http://localhost:5151` — alors qu'un `404` l'aurait laissé continuer.
 */

function input(resource: string): IProtectedResourceInput {
  return { resource, authorizationServers: ["https://auth.example"] };
}

describe("protectedResourceRoutePaths — où monter le document (RFC 9728 §3.1)", () => {
  it("INSÈRE le chemin de la ressource dans l'URL bien connue, ne le concatène pas", () => {
    assert.deepEqual(
      protectedResourceRoutePaths([input("https://app.example/nodefony/mcp")]),
      ["/.well-known/oauth-protected-resource/nodefony/mcp"],
    );
  });

  it("sert à la racine quand la ressource EST l'hôte", () => {
    assert.deepEqual(
      protectedResourceRoutePaths([input("https://localhost:5152")]),
      ["/.well-known/oauth-protected-resource"],
    );
  });

  it("ne monte QU'UNE route pour deux ressources de même chemin — `createRoute` empile sans vérifier, la seconde ne serait jamais atteinte", () => {
    const paths = protectedResourceRoutePaths([
      input("https://a.example/api"),
      input("https://b.example/api"),
    ]);
    assert.deepEqual(paths, ["/.well-known/oauth-protected-resource/api"]);
  });

  it("ignore une URI qui ne peut pas servir d'audience, sans empêcher les autres de se publier", () => {
    const paths = protectedResourceRoutePaths([
      input("pas-une-uri"),
      input("https://app.example/api"),
    ]);
    assert.deepEqual(paths, ["/.well-known/oauth-protected-resource/api"]);
  });

  it("ne monte rien quand rien n'est déclaré", () => {
    assert.deepEqual(protectedResourceRoutePaths([]), []);
  });
});

describe("onDeclaredAuthority — sur quelle autorité répondre (RFC 9728 §3.3 / RFC 8414 §3.3)", () => {
  it("sert sur l'autorité déclarée", () => {
    assert.equal(
      onDeclaredAuthority("localhost:5152", "https://localhost:5152"),
      true,
    );
  });

  it("REFUSE une autre autorité — c'est la faille du document d'émetteur, transposée", () => {
    assert.equal(
      onDeclaredAuthority("localhost:5151", "https://localhost:5152"),
      false,
    );
  });

  it("ignore le SCHÉMA : derrière un relais qui termine TLS, le processus voit `http` d'une requête faite en `https`", () => {
    assert.equal(
      onDeclaredAuthority("app.example", "https://app.example/api"),
      true,
    );
  });

  it("normalise le port par défaut — `app.example:443` et `app.example` sont le même serveur", () => {
    assert.equal(
      onDeclaredAuthority("app.example:443", "https://app.example"),
      true,
    );
  });

  it("refuse une autorité absente ou illisible plutôt que de publier au hasard", () => {
    assert.equal(onDeclaredAuthority(undefined, "https://app.example"), false);
    assert.equal(onDeclaredAuthority("", "https://app.example"), false);
    assert.equal(onDeclaredAuthority("a b c", "https://app.example"), false);
  });

  it("refuse une URL déclarée illisible", () => {
    assert.equal(onDeclaredAuthority("app.example", "pas-une-url"), false);
  });
});

describe("askedAuthority — la même valeur quel que soit le transport", () => {
  it("préfère le pseudo-en-tête HTTP/2 au `Host`", () => {
    assert.equal(
      askedAuthority({ ":authority": "h2.example", host: "h1.example" }),
      "h2.example",
    );
  });

  it("retombe sur `Host` en HTTP/1.1", () => {
    assert.equal(askedAuthority({ host: "h1.example" }), "h1.example");
  });

  it("prend la première valeur d'un en-tête répété", () => {
    assert.equal(
      askedAuthority({ host: ["a.example", "b.example"] }),
      "a.example",
    );
  });

  it("rend `undefined` quand la requête ne nomme aucune autorité", () => {
    assert.equal(askedAuthority({}), undefined);
    assert.equal(askedAuthority(null), undefined);
    assert.equal(askedAuthority(undefined), undefined);
  });
});

/** Conteneur factice : des services nommés, dont certains publient. */
function scan(services: Record<string, unknown>): IServiceScan {
  return {
    keys: () => Object.keys(services),
    get: <T>(name: string) => (services[name] ?? null) as T | null,
  };
}

describe("collectProtectedResources — plusieurs sources, une seule règle", () => {
  it("rassemble ce que TOUS les services déclarent, pas seulement le pare-feu", () => {
    const collected = collectProtectedResources(
      scan({
        firewall: {
          publishedProtectedResources: () => [input("https://app.example/api")],
        },
        devkit: {
          publishedProtectedResources: () => [input("https://app.example/mcp")],
        },
        // Un service ordinaire : il ne doit ni contribuer, ni gêner.
        template: { render: () => "" },
      }),
    );
    assert.deepEqual(collected.map((r) => r.resource).sort(), [
      "https://app.example/api",
      "https://app.example/mcp",
    ]);
  });

  it("ignore un service dont la méthode LÈVE — un document ne fait pas tomber le boot", () => {
    const collected = collectProtectedResources(
      scan({
        casse: {
          publishedProtectedResources: () => {
            throw new Error("config illisible");
          },
        },
        sain: {
          publishedProtectedResources: () => [input("https://app.example/api")],
        },
      }),
    );
    assert.deepEqual(
      collected.map((r) => r.resource),
      ["https://app.example/api"],
    );
  });

  it("rend une liste vide quand aucun service ne publie", () => {
    assert.deepEqual(collectProtectedResources(scan({ template: {} })), []);
  });
});
