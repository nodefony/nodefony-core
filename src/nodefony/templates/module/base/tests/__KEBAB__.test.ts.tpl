import { describe, it, expect } from "vitest";
import { define<%= it.pascal %>Config } from "../nodefony/config/defineModuleConfig";
import defaults from "../nodefony/config/config";
import <%= it.pascal %>Module from "../index";

/**
 * Ce que ce test prouve (et pourquoi il existe dès la naissance du module) :
 *  1. le module s'IMPORTE sans kernel — donc il reste testable hors serveur
 *     (un module qui déréférence le kernel au chargement est intestable) ;
 *  2. sa config a des défauts sûrs et REFUSE ce qui est invalide — la panne
 *     arrive au boot, nommée, pas en production sur un `undefined`.
 */
describe("<%= it.name %>", () => {
  it("s'importe sans kernel", () => {
    expect(<%= it.pascal %>Module).toBeTypeOf("function");
  });

  it("applique ses défauts", () => {
    const config = define<%= it.pascal %>Config({});
    expect(config.enabled).toBe(true);
    expect(config.greeting).toBe(defaults.greeting);
  });

  it("refuse une config invalide", () => {
    expect(() =>
      define<%= it.pascal %>Config({ greeting: "" } as never),
    ).toThrow(/greeting/u);
  });
});
