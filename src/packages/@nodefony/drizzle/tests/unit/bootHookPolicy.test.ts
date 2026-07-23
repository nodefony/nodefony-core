import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import DrizzleService from "../../nodefony/service/DrizzleService";

/**
 * **Un échec de boot doit désigner son propriétaire.**
 *
 * Contrairement à `@nodefony/mongoose`, drizzle est l'ORM par défaut : il reste
 * critique, et une base injoignable DOIT interrompre le boot en production. Le
 * verdict ne change donc pas ici — mais il était rendu par défaut, faute de tag,
 * et non parce que le module l'avait déclaré. Conséquence visible : le journal
 * annonçait l'échec de « (anonyme) », le seul indice exploitable au moment où le
 * pod refuse de démarrer.
 *
 * Poser la connexion au nom du module (`module.hookKernel`) rend le verdict
 * *intentionnel* et le journal nominatif. Le frère `@nodefony/mongoose` porte le
 * même banc — c'est la même règle, appliquée aux deux adapters.
 */

/** Module factice qui observe COMMENT le service pose ses hooks. */
function spyModule(): {
  module: Module;
  viaModule: string[];
  viaKernel: string[];
} {
  const viaModule: string[] = [];
  const viaKernel: string[] = [];
  const container = new Container();
  const kernel = {
    once: (event: string): void => {
      viaKernel.push(event);
    },
  };
  container.set("kernel", kernel);
  const module = {
    container,
    kernel,
    options: {},
    config: {},
    hookKernel: (event: string): unknown => {
      viaModule.push(event);
      return module;
    },
  };
  return { module: module as unknown as Module, viaModule, viaKernel };
}

describe("DrizzleService — politique de boot des hooks posés à la main", () => {
  it("pose sa connexion AU NOM du module (propriétaire nommé au journal)", () => {
    const { module, viaModule } = spyModule();
    new DrizzleService(module);
    assert.ok(viaModule.includes("onBoot"));
  });

  it("ne pose plus AUCUN hook de boot directement sur le kernel", () => {
    const { module, viaKernel } = spyModule();
    new DrizzleService(module);
    assert.ok(!viaKernel.includes("onBoot"));
  });

  it("`onTerminate` reste sur le kernel (l'arrêt n'est pas une politique de boot)", () => {
    const { module, viaKernel } = spyModule();
    new DrizzleService(module);
    assert.ok(viaKernel.includes("onTerminate"));
  });
});
