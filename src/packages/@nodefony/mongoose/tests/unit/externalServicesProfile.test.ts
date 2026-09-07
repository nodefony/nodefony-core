import assert from "node:assert/strict";
import {
  Container,
  CONSOLE_RUN_PROFILE,
  CONSOLE_DATA_RUN_PROFILE,
} from "nodefony";
import type { IRunProfile, Module } from "nodefony";
import MongooseService from "../../nodefony/service/MongooseService";

/**
 * **La même règle que l'ORM SQL, appliquée à l'ORM document.**
 *
 * Le banc jumeau vit dans `@nodefony/drizzle`. Il existe en double parce que la
 * frontière de paquets l'impose — mais les deux services appellent le MÊME
 * `runNeedsExternalServices` du cœur : c'est cet appel partagé, et non deux
 * lectures parallèles de `runProfile`, qui empêche les deux bases de diverger
 * le jour où l'axe gagnera une nuance.
 */

/** Décor minimal : capture le hook `onBoot` et le profil que verra le service. */
function decor(profil: IRunProfile): {
  boot: () => Promise<void>;
  connexions: number;
} {
  let hook: (() => Promise<void>) | null = null;
  const container = new Container();
  const kernel = {
    runProfile: profil,
    once: (): void => {},
  };
  container.set("kernel", kernel);
  const module = {
    container,
    kernel,
    options: {},
    config: { connections: {} },
    hookKernel: (event: string, cb: () => Promise<void>): unknown => {
      if (event === "onBoot") hook = cb;
      return module;
    },
  };
  const service = new MongooseService(module as unknown as Module);
  const compteur = { n: 0 };
  service.connectAll = async (): Promise<void> => {
    compteur.n += 1;
  };
  return {
    boot: async () => {
      assert.ok(hook, "le service n'a posé aucun hook onBoot");
      await (hook as unknown as () => Promise<void>)();
    },
    get connexions() {
      return compteur.n;
    },
  };
}

describe("MongooseService — la connexion suit le profil d'exécution déclaré", () => {
  it("profil console (rien de déclaré) → AUCUNE connexion au boot", async () => {
    const d = decor({ ...CONSOLE_RUN_PROFILE });
    await d.boot();
    assert.equal(d.connexions, 0);
  });

  it("profil qui DÉCLARE `externalServices` → la connexion a bien lieu", async () => {
    const d = decor({ ...CONSOLE_DATA_RUN_PROFILE });
    await d.boot();
    assert.equal(
      d.connexions,
      1,
      "débrancher la déclaration doit faire revenir la connexion — sinon le premier test ne prouve rien",
    );
  });
});
