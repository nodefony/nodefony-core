import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import MongooseService from "../../nodefony/service/MongooseService";

/**
 * **La promesse `static critical = false` doit couvrir la connexion, pas
 * seulement les hooks de classe.**
 *
 * `@nodefony/mongoose` se déclare non critique : une base injoignable ne doit
 * pas empêcher l'application de démarrer. Mais le service posait sa connexion
 * par un `kernel.once("onBoot", …)` **nu**. Un listener sans tag n'a pas de
 * criticité, et le kernel traite l'absence de tag comme « critique » : en
 * production, Mongo injoignable interrompait le boot — au nom d'un module qui
 * avait déclaré l'inverse — et le journal désignait « (anonyme) ».
 *
 * Ce banc vérifie le seul point qui appartient au service : sa connexion est
 * posée **au nom du module** (`module.hookKernel`), pas directement sur le
 * kernel. Que ce chemin pose bien le bon tag est prouvé côté cœur
 * (`KernelLifecycle.test.ts`), contrôle négatif compris.
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

describe("MongooseService — politique de boot des hooks posés à la main", () => {
  it("pose sa connexion AU NOM du module (héritage de la criticité)", () => {
    const { module, viaModule } = spyModule();
    new MongooseService(module);
    assert.ok(
      viaModule.includes("onBoot"),
      "la connexion doit passer par `module.hookKernel` — un `kernel.once` nu " +
        "ferait échouer le boot en production malgré `critical = false`",
    );
  });

  it("ne pose plus AUCUN hook de boot directement sur le kernel", () => {
    const { module, viaKernel } = spyModule();
    new MongooseService(module);
    assert.ok(
      !viaKernel.includes("onBoot"),
      "un hook de boot non tagué est traité comme critique",
    );
  });

  it("`onTerminate` reste sur le kernel (l'arrêt n'est pas une politique de boot)", () => {
    const { module, viaKernel } = spyModule();
    new MongooseService(module);
    assert.ok(
      viaKernel.includes("onTerminate"),
      "la fermeture des connexions n'a rien à voir avec la criticité de boot",
    );
  });
});
