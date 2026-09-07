import assert from "node:assert/strict";
import {
  Container,
  CONSOLE_RUN_PROFILE,
  CONSOLE_DATA_RUN_PROFILE,
} from "nodefony";
import type { IRunProfile, Module } from "nodefony";
import DrizzleService from "../../nodefony/service/DrizzleService";

/**
 * **Une connexion s'ouvre parce qu'un run l'a DEMANDÉE, jamais par défaut.**
 *
 * Le service se connectait sur `onBoot` sans condition : toute commande qui
 * bootait le kernel exigeait donc la base, y compris celles qui ne lisent
 * aucune donnée. `npm create nodefony` en mourait — son propre `npm run build`
 * boote le kernel pour construire le frontend, et sortait en code 70 avant que
 * l'utilisateur n'ait pu démarrer l'infrastructure que le scaffold lui conseille
 * deux lignes plus bas.
 *
 * Ce banc tient les DEUX sens de la règle. Le second est le seul qui prouve
 * quelque chose : sans lui, un service qui ne se connecterait jamais passerait
 * le premier.
 */

/** Décor minimal : capture le hook `onBoot` et le profil que verra le service. */
function decor(profil: IRunProfile): {
  service: DrizzleService;
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
    config: { connectors: {} },
    hookKernel: (event: string, cb: () => Promise<void>): unknown => {
      if (event === "onBoot") hook = cb;
      return module;
    },
  };
  const service = new DrizzleService(module as unknown as Module);
  const compteur = { n: 0 };
  service.connectAll = async (): Promise<void> => {
    compteur.n += 1;
  };
  return {
    service,
    boot: async () => {
      assert.ok(hook, "le service n'a posé aucun hook onBoot");
      await (hook as unknown as () => Promise<void>)();
    },
    get connexions() {
      return compteur.n;
    },
  };
}

describe("DrizzleService — la connexion suit le profil d'exécution déclaré", () => {
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

  it("un profil serveur déclare le besoin, comme une commande de données", async () => {
    const d = decor({
      ...CONSOLE_RUN_PROFILE,
      servers: true,
      lifetime: "longrunning",
      externalServices: true,
    });
    await d.boot();
    assert.equal(d.connexions, 1);
  });

  it("profil absent (kernel pas encore démarré) → aucune connexion", async () => {
    const d = decor(undefined as unknown as IRunProfile);
    await d.boot();
    assert.equal(d.connexions, 0);
  });
});
