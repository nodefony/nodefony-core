import { describe, it, expect } from "vitest";
import { defineAiConfig } from "../nodefony/config/defineModuleConfig";
import AiModule, { defineMcpGate, mcpText } from "../index";

/**
 * Ce que ce test prouve :
 *  1. le module s'IMPORTE sans kernel — donc il reste testable hors serveur ;
 *  2. sa config ne porte AUCUNE porte : une porte se définit par
 *     `defineMcpGate`, à côté du controller qui la sert ;
 *  3. une porte définie sans réglage est la plus FERMÉE possible, et refuse ce
 *     qui est invalide — au boot, nommé.
 */
describe("ai", () => {
  it("s'importe sans kernel", () => {
    expect(AiModule).toBeTypeOf("function");
  });

  // Une faute de frappe n'est pas une valeur invalide : Zod retire par défaut
  // les clés qu'il ne connaît PAS, si bien que l'application démarrerait en
  // ignorant ce qui a été écrit. Le schéma est `strictObject` pour cette raison.
  it("refuse une clé INCONNUE plutôt que de l'ignorer", () => {
    expect(() => defineAiConfig({ mpc: {} } as never)).toThrow(/mpc/u);
  });

  // `ai` ne monte aucune route : une section `mcp` ici laisserait croire
  // qu'une porte s'ouvre en la remplissant.
  it("refuse `mcp` : une porte se définit par defineMcpGate, pas dans la config du module", () => {
    expect(() => defineAiConfig({ mcp: {} } as never)).toThrow(/mcp/u);
  });
});

describe("defineMcpGate — défauts sûrs", () => {
  const tools = [
    {
      name: "app_ping",
      description: "répond",
      inputSchema: { type: "object", properties: {} },
      handler: () => mcpText("pong"),
    },
  ];

  it("locale, sans navigateur, sans jeton, sans rôle, toutes révisions", () => {
    const { settings } = defineMcpGate({ tools });
    expect(settings.enabled).toBe(true);
    expect(settings.allowedOrigins).toEqual([]);
    expect(settings.allowRemote).toBe(false);
    expect(settings.authorization.authorizationServers).toEqual([]);
    expect(settings.authorization.anonymous).toBe(false);
    expect(settings.unprotectedRoles).toEqual([]);
    expect(settings.protocol.versions).toBeUndefined();
    expect(settings.cache).toEqual({ ttlMs: 0, scope: "private" });
  });

  it("exige `resource` dès qu'un serveur d'autorisation est déclaré", () => {
    expect(() =>
      defineMcpGate({
        tools,
        authorization: { authorizationServers: ["https://idp.test"] },
      }),
    ).toThrow(/resource/u);
  });
});
