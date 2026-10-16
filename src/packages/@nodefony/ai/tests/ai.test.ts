import { describe, it, expect } from "vitest";
import { Container, type Module } from "nodefony";
import { defineAiConfig } from "../nodefony/config/defineModuleConfig";
import { aiConfigSchema, type IAiConfigInput } from "../nodefony/config/config";
import AiModule, { McpService } from "../index";

/**
 * Module minimal — juste ce que lit le constructeur d'un service : un conteneur
 * et les options que l'application passe dans `use()`.
 */
function fakeModule(options: IAiConfigInput): Module {
  return {
    container: new Container(),
    notificationsCenter: undefined,
    kernel: null,
    options,
  } as unknown as Module;
}

/**
 * Ce que ce test prouve :
 *  1. le module s'IMPORTE sans kernel — donc il reste testable hors serveur ;
 *  2. la section `mcp` a des défauts SÛRS (porte anonyme, locale, sans
 *     navigateur) et REFUSE ce qui est invalide — au boot, nommé ;
 *  3. le service `mcp` rend les réglages EFFECTIFS, et coupe la porte quand le
 *     module ou la porte est coupé.
 */
describe("ai", () => {
  it("s'importe sans kernel", () => {
    expect(AiModule).toBeTypeOf("function");
  });

  it("applique des défauts sûrs à la porte MCP", () => {
    const config = defineAiConfig({});
    expect(config.enabled).toBe(true);
    expect(config.mcp.enabled).toBe(true);
    expect(config.mcp.allowedOrigins).toEqual([]);
    expect(config.mcp.allowRemote).toBe(false);
    expect(config.mcp.authorization.authorizationServers).toEqual([]);
    expect(config.mcp.authorization.anonymous).toBe(false);
  });

  // Une faute de frappe n'est pas une valeur invalide : Zod retire par défaut
  // les clés qu'il ne connaît PAS, si bien que l'application démarrerait en
  // ignorant ce qui a été écrit. Le schéma est `strictObject` pour cette raison.
  it("refuse une clé INCONNUE plutôt que de l'ignorer", () => {
    expect(() => defineAiConfig({ mpc: {} } as never)).toThrow(/mpc/u);
  });

  // Les outils se déclarent par module (`getMcpTools()`) ; un filtre global ici
  // serait un second point de décision sur le catalogue servi.
  it("refuse `mcp.tools` : le catalogue ne se règle pas sur la porte", () => {
    expect(() =>
      defineAiConfig({ mcp: { tools: ["nodefony_card"] } } as never),
    ).toThrow(/tools/u);
  });

  it("exige `resource` dès qu'un serveur d'autorisation est déclaré", () => {
    const result = aiConfigSchema.safeParse({
      mcp: { authorization: { authorizationServers: ["https://idp.test"] } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([
      "mcp",
      "authorization",
      "resource",
    ]);
  });

  it("le service `mcp` rend les réglages effectifs de la porte", () => {
    const service = new McpService(
      fakeModule({ mcp: { allowedOrigins: ["https://app.test"] } }),
    );
    expect(service.name).toBe("mcp");
    expect(service.settings().allowedOrigins).toEqual(["https://app.test"]);
    expect(service.settings().allowRemote).toBe(false);
    expect(service.isEnabled()).toBe(true);
  });

  it("la porte est coupée si le module OU la porte est coupé", () => {
    expect(new McpService(fakeModule({ enabled: false })).isEnabled()).toBe(
      false,
    );
    expect(
      new McpService(fakeModule({ mcp: { enabled: false } })).isEnabled(),
    ).toBe(false);
  });
});
