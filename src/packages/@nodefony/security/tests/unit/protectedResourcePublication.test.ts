import assert from "node:assert/strict";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import { Firewall } from "../../nodefony/service/firewall";
import type { ISecurityConfigInput } from "../../nodefony/config/defineModuleConfig";

/**
 * `Firewall.publishedProtectedResources()` — ce que l'application déclare
 * protéger, à publier en RFC 9728.
 *
 * ⭐ **Ce que ce banc empêche, c'est un pointeur qui ne mène nulle part.** Le
 * défi posé sur un `401` nomme l'URL d'un document dérivé de `area.resource` ;
 * si cette méthode rend autre chose que les ressources des zones, le client
 * suit un pointeur conforme et trouve `404` — il conclut alors qu'il n'y a pas
 * d'autorisation ici, l'inverse de ce que le refus voulait lui apprendre. Le
 * défaut se voit à l'usage, jamais à la lecture.
 *
 * Les quatre décisions éprouvées ici :
 *
 * 1. une zone qui déclare sa ressource se publie, une zone sans ressource non ;
 * 2. les `authorization_servers` sont **les émetteurs de confiance**, pas une
 *    seconde liste — publier autre chose enverrait le client demander un jeton
 *    à un émetteur dont on refuse ensuite la signature ;
 * 3. aucun émetteur ⇒ **rien** (un document sans serveur d'autorisation est
 *    interdit par la RFC comme par la spécification MCP) ;
 * 4. deux zones sur la MÊME ressource (typiquement HTTP + WebSocket) ne
 *    produisent qu'une entrée.
 */

const ISSUER_A = "https://auth.example.com/realms/app";
const ISSUER_B = "https://localhost:5152";
const RESOURCE = "https://app.example/api";

/** Construit un firewall buildé (kernel factice → `#build` au onBoot). */
function bootFirewall(options: ISecurityConfigInput): Firewall {
  const container = new Container();
  const bootCbs: Array<() => void> = [];
  container.set("kernel", {
    container,
    once(ev: string, cb: () => void) {
      if (ev === "onBoot") bootCbs.push(cb);
    },
  });
  const firewall = new Firewall({
    container,
    notificationsCenter: new Event(),
    options,
  } as unknown as Module);
  container.set("firewall", firewall);
  bootCbs.forEach((cb) => cb());
  return firewall;
}

/** Décor minimal : deux émetteurs de confiance, une zone à ressource. */
function config(
  over: Partial<ISecurityConfigInput> = {},
): ISecurityConfigInput {
  return {
    resourceServer: {
      issuers: [
        { issuer: ISSUER_A, jwksUri: "https://auth.example.com/keys" },
        { issuer: ISSUER_B },
      ],
    },
    areas: {
      api: {
        pattern: "^/api",
        authenticators: ["external-jwt"],
        stateless: true,
        resource: RESOURCE,
      },
      // Une zone parfaitement ordinaire, sans ressource : elle n'a rien à
      // publier, et sa présence ne doit rien changer pour les autres.
      web: { pattern: "^/web", authenticators: ["session"] },
    },
    ...over,
  } as ISecurityConfigInput;
}

describe("Firewall.publishedProtectedResources — le document que le défi promet", () => {
  it("publie la ressource d'une zone, avec les émetteurs de confiance comme serveurs d'autorisation", () => {
    const published = bootFirewall(config()).publishedProtectedResources();

    assert.equal(published.length, 1, "une seule zone déclare une ressource");
    assert.equal(published[0].resource, RESOURCE);
    // 🔴 L'assertion qui compte : ce sont EXACTEMENT les émetteurs que le
    // vérificateur accepte. Une liste distincte se serait périmée en silence.
    assert.deepEqual(
      [...published[0].authorizationServers],
      [ISSUER_A, ISSUER_B],
    );
  });

  it("ne publie RIEN sans émetteur de confiance — un document sans serveur d'autorisation ne mène nulle part", () => {
    const published = bootFirewall(
      config({ resourceServer: { issuers: [] } } as never),
    ).publishedProtectedResources();
    assert.equal(published.length, 0);
  });

  it("ne publie RIEN quand aucune zone ne déclare de ressource", () => {
    const published = bootFirewall(
      config({
        areas: { web: { pattern: "^/web", authenticators: ["session"] } },
      } as never),
    ).publishedProtectedResources();
    assert.equal(published.length, 0);
  });

  it("dédoublonne deux zones qui protègent la MÊME ressource (HTTP + WebSocket)", () => {
    const published = bootFirewall(
      config({
        areas: {
          api: {
            pattern: "^/api",
            authenticators: ["external-jwt"],
            stateless: true,
            resource: RESOURCE,
          },
          "api-ws": {
            pattern: "^/api/socket",
            authenticators: ["external-jwt"],
            stateless: true,
            realtime: true,
            resource: RESOURCE,
          },
        },
      } as never),
    ).publishedProtectedResources();

    assert.equal(published.length, 1, "une ressource, un document");
    assert.equal(published[0].resource, RESOURCE);
  });

  it("publie une entrée par ressource DISTINCTE (plusieurs ressources par hôte — RFC 9728 §3.1)", () => {
    const second = "https://app.example/agents";
    const published = bootFirewall(
      config({
        areas: {
          api: {
            pattern: "^/api",
            authenticators: ["external-jwt"],
            stateless: true,
            resource: RESOURCE,
          },
          agents: {
            pattern: "^/agents",
            authenticators: ["external-jwt"],
            stateless: true,
            resource: second,
          },
        },
      } as never),
    ).publishedProtectedResources();

    assert.deepEqual(
      published.map((p) => p.resource).sort(),
      [second, RESOURCE].sort(),
    );
  });
});
