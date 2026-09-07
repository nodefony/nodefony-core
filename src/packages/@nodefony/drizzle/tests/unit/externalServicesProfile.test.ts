import assert from "node:assert/strict";
import {
  Container,
  CONSOLE_RUN_PROFILE,
  CONSOLE_DATA_RUN_PROFILE,
} from "nodefony";
import type { IRunProfile, Module } from "nodefony";
import DrizzleService from "../../nodefony/service/DrizzleService";

/**
 * **Une connexion s'ouvre parce qu'un run l'a DEMANDÉE — mais l'ORM, lui,
 * existe toujours.**
 *
 * Le service se connectait sur `onBoot` sans condition : toute commande qui
 * bootait le kernel exigeait donc la base, y compris celles qui ne lisent
 * aucune donnée. `npm create nodefony` en mourait — son propre `npm run build`
 * boote le kernel pour construire le frontend, et sortait en code 70 avant que
 * l'utilisateur n'ait pu démarrer l'infrastructure.
 *
 * 🔴 Ce banc tient DEUX faits, et le second est celui qu'une première version a
 * manqué. Court-circuiter tout le boot faisait aussi disparaître l'ORM — donc le
 * plan d'administration qu'il publie —, et `nodefony doctor --live` répondait
 * « état des migrations introuvable (404) » là où il lisait « schéma et
 * historique alignés ». Aucune suite ne l'a vu : le plan d'administration n'a de
 * consommateur qu'au boot complet. D'où l'assertion d'EXISTENCE ci-dessous, à
 * côté de celle de connexion.
 */

/**
 * Décor minimal : un connecteur sqlite en mémoire, toujours joignable.
 *
 * Le nom du connecteur est UNIQUE par cas : `ormRegistry` est un singleton de
 * processus, et deux décors qui s'appelleraient tous deux « default » se
 * refuseraient l'un l'autre — l'échec parlerait alors du registre, pas de la règle.
 */
let compteur = 0;
function decor(profil: IRunProfile): {
  boot: () => Promise<void>;
  orm: () => { isConnected(): boolean } | undefined;
} {
  let hook: (() => Promise<void>) | null = null;
  const connecteur = `banc-${++compteur}`;
  const container = new Container();
  // `resolveRuntimeEnv` : lu par la résolution du mode de schéma, qui tourne
  // AVANT la connexion — le décor doit donc le porter, sinon on mesure sa propre
  // pauvreté au lieu de la règle.
  const kernel = {
    runProfile: profil,
    once: (): void => {},
    resolveRuntimeEnv: (): string => "development",
  };
  container.set("kernel", kernel);
  const module = {
    container,
    kernel,
    options: {},
    config: {
      connectors: { [connecteur]: { dialect: "sqlite", filename: ":memory:" } },
    },
    hookKernel: (event: string, cb: () => Promise<void>): unknown => {
      if (event === "onBoot") hook = cb;
      return module;
    },
  };
  const service = new DrizzleService(module as unknown as Module);
  return {
    boot: async () => {
      assert.ok(hook, "le service n'a posé aucun hook onBoot");
      await (hook as unknown as () => Promise<void>)();
    },
    orm: () =>
      service.getOrm(connecteur) as unknown as
        { isConnected(): boolean } | undefined,
  };
}

describe("DrizzleService — la connexion suit le profil d'exécution déclaré", () => {
  it("profil console : AUCUNE connexion ouverte", async () => {
    const d = decor({ ...CONSOLE_RUN_PROFILE });
    await d.boot();
    assert.equal(d.orm()?.isConnected(), false);
  });

  it("🔴 profil console : l'ORM EXISTE quand même — il publie le plan d'administration", async () => {
    const d = decor({ ...CONSOLE_RUN_PROFILE });
    await d.boot();
    assert.ok(
      d.orm(),
      "sans ORM enregistré, `doctor --live` rend « état des migrations introuvable (404) »",
    );
  });

  it("profil qui DÉCLARE `externalServices` → la connexion a bien lieu", async () => {
    const d = decor({ ...CONSOLE_DATA_RUN_PROFILE });
    await d.boot();
    assert.equal(
      d.orm()?.isConnected(),
      true,
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
    assert.equal(d.orm()?.isConnected(), true);
  });

  it("profil absent (kernel pas encore démarré) → aucune connexion", async () => {
    const d = decor(undefined as unknown as IRunProfile);
    await d.boot();
    assert.equal(d.orm()?.isConnected(), false);
  });
});
