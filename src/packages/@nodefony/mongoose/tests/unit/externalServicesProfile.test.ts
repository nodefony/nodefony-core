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

/**
 * Décor minimal : capture le hook `onBoot` et le profil que verra le service.
 *
 * Le nom du connecteur est UNIQUE par cas — `ormRegistry` est un singleton de
 * processus, et deux décors homonymes se refuseraient l'un l'autre.
 */
let compteur = 0;
function decor(profil: IRunProfile): {
  boot: () => Promise<void>;
  orm: () => unknown;
} {
  let hook: (() => Promise<void>) | null = null;
  const connecteur = `banc-${++compteur}`;
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
    config: {
      connectors: {
        [connecteur]: {
          uri: "mongodb://127.0.0.1:59999/absente",
          options: { serverSelectionTimeoutMS: 400 },
        },
      },
    },
    hookKernel: (event: string, cb: () => Promise<void>): unknown => {
      if (event === "onBoot") hook = cb;
      return module;
    },
  };
  const service = new MongooseService(module as unknown as Module);
  return {
    boot: async () => {
      assert.ok(hook, "le service n'a posé aucun hook onBoot");
      await (hook as unknown as () => Promise<void>)();
    },
    orm: () => service.getOrm(connecteur),
  };
}

describe("MongooseService — la connexion suit le profil d'exécution déclaré", () => {
  it("profil console : aucune connexion tentée — le port mort ne fait rien échouer", async () => {
    const d = decor({ ...CONSOLE_RUN_PROFILE });
    // Si une connexion était tentée, ce boot lèverait : l'adresse est morte.
    await d.boot();
  });

  it("🔴 profil console : l'ORM EXISTE quand même — il porte les sondes du plan d'administration", async () => {
    const d = decor({ ...CONSOLE_RUN_PROFILE });
    await d.boot();
    assert.ok(
      d.orm(),
      "un ORM absent rend « introuvable » ce qui est seulement « non connecté »",
    );
  });

  it("profil qui DÉCLARE `externalServices` → la connexion est bien tentée", async () => {
    const d = decor({ ...CONSOLE_DATA_RUN_PROFILE });
    // L'adresse est morte : la tentative DOIT donc échouer. C'est ce qui prouve
    // que le premier test ne passait pas pour une autre raison.
    await assert.rejects(() => d.boot());
  });
});

/**
 * **Un échec de connexion dit ce qu'il a CONSTATÉ.**
 *
 * Mongoose laissait remonter l'erreur brute du driver : elle nomme un symptôme,
 * jamais la question qui tranche (« quelqu'un a-t-il répondu ? »). L'ORM SQL a
 * reçu le même correctif, par la MÊME fonction d'`orm-core` — deux
 * implémentations parallèles diraient deux choses du même symptôme.
 */
describe("MongooseService — un échec de connexion nomme ce qu'il a constaté", () => {
  it("port mort : dit que personne n'écoute, avec l'adresse et le code", async () => {
    const container = new Container();
    const kernel = {
      runProfile: { ...CONSOLE_DATA_RUN_PROFILE },
      once: () => {},
    };
    container.set("kernel", kernel);
    const module = {
      container,
      kernel,
      options: {},
      config: {
        connectors: {
          default: {
            uri: "mongodb://127.0.0.1:59999/absente",
            options: { serverSelectionTimeoutMS: 400 },
          },
        },
      },
      hookKernel: (): unknown => module,
    };
    const service = new MongooseService(module as unknown as Module);
    await assert.rejects(
      () => service.connectAll(),
      (e: Error) => {
        assert.match(e.message, /Mongoose : le connecteur "default"/);
        // Le fait constaté, pas la déduction.
        assert.match(e.message, /127\.0\.0\.1:59999/);
        return true;
      },
    );
  });
});
