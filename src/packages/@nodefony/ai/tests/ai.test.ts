import { describe, it, expect } from "vitest";
import { defineAiConfig } from "../nodefony/config/defineModuleConfig";
import defaults from "../nodefony/config/config";
import AiModule from "../index";

/**
 * Ce que ce test prouve (et pourquoi il existe dès la naissance du module) :
 *  1. le module s'IMPORTE sans kernel — donc il reste testable hors serveur
 *     (un module qui déréférence le kernel au chargement est intestable) ;
 *  2. sa config a des défauts sûrs et REFUSE ce qui est invalide — la panne
 *     arrive au boot, nommée, pas en production sur un `undefined`.
 */
describe("ai", () => {
  it("s'importe sans kernel", () => {
    expect(AiModule).toBeTypeOf("function");
  });

  it("applique ses défauts", () => {
    const config = defineAiConfig({});
    expect(config.enabled).toBe(true);
    expect(config.greeting).toBe(defaults.greeting);
  });

  it("refuse une config invalide", () => {
    expect(() => defineAiConfig({ greeting: "" } as never)).toThrow(
      /greeting/u,
    );
  });

  // Une faute de frappe n'est pas une valeur invalide : Zod retire par défaut
  // les clés qu'il ne connaît PAS, si bien que l'application démarrerait en
  // ignorant ce qui a été écrit. Le schéma est `strictObject` pour cette raison,
  // et ce cas est ce qui l'empêche de redevenir un `object` au premier refactor.
  it("refuse une clé INCONNUE plutôt que de l'ignorer", () => {
    expect(() =>
      defineAiConfig({ gretting: "faute de frappe" } as never),
    ).toThrow(/gretting/u);
  });
});
