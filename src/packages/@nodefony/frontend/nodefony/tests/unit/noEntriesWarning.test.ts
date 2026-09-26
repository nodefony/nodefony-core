/// <reference types="node" />
/**
 * Unit — ce que le démarrage DIT quand aucune interface web n'est posée.
 *
 * Le module est installé et câblé dans toute application générée, mais ne pose
 * aucune interface tant qu'on ne le demande pas. La ligne émise dans ce cas est
 * donc le SEUL endroit où la capacité se signale à qui ne la connaît pas — un
 * agent qui ne la lit pas en conclut que le framework ne fait pas de front, et
 * écrit ses pages à la main. Ce banc verrouille les trois choses qui font la
 * différence : le NIVEAU (une ligne `INFO` se perd dans un flot de démarrage),
 * la COMMANDE qui pose une interface, et les MOTEURS qu'elle accepte.
 *
 * Les moteurs ne sont pas littéralisés ici : ils sont relus depuis
 * `FRONTEND_CHOICES`, la même liste que celle dont la commande dérive ses
 * choix. Un moteur ajouté au cœur fait donc tomber ce banc s'il n'atteint pas
 * le message — ce qu'une liste recopiée dans le test n'aurait jamais dit.
 *
 * Le service est instancié SANS kernel booté : le faux kernel ne sert qu'à
 * capter le rappel `onServersReady`, le seul point d'entrée de la branche.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import { Container, FRONTEND_CHOICES } from "nodefony";
import FrontendService from "../../service/FrontendService";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder";

type LigneJournal = { message: unknown; severite?: unknown };

/**
 * Module factice. Le conteneur doit être un VRAI `Container` (cf
 * `originDerivationPolicy`) ; le kernel n'expose que ce que la branche touche,
 * et retient ses rappels au lieu de les déclencher — c'est le test qui choisit
 * le moment.
 */
function moduleFactice(options: object = {}) {
  const noop = () => undefined;
  const rappels = new Map<string, (...a: unknown[]) => unknown>();
  const journal: LigneJournal[] = [];
  const container = new Container();
  container.set("kernel", {
    environment: "development",
    domain: "nodefony.com",
    once: (ev: string, cb: (...a: unknown[]) => unknown) => {
      rappels.set(ev, cb);
    },
    fire: noop,
    reportBootLine: noop,
  });
  const module = {
    kernel: container.get("kernel"),
    container,
    notificationsCenter: { on: noop, fire: noop, removeListener: noop },
    options,
    log: noop,
  } as unknown as ConstructorParameters<typeof FrontendService>[0];
  return { module, rappels, journal };
}

/** Instancie le service, capte son journal, et rend de quoi jouer le boot. */
async function serviceDemarre(options: object = {}) {
  const { module, rappels, journal } = moduleFactice(options);
  const service = new FrontendService(module);
  // `log` est la surface observée : on la remplace APRÈS construction pour ne
  // pas rater les lignes émises par `init()` lui-même.
  (service as unknown as { log: unknown }).log = (
    message: unknown,
    severite?: unknown,
  ) => {
    journal.push({ message, severite });
  };
  await service.init();
  const boot = rappels.get("onServersReady");
  expect(boot, "le service doit s'abonner à onServersReady").to.be.a(
    "function",
  );
  return { service, journal, boot: boot as () => Promise<void> };
}

describe("aucune interface web posée — ce que le démarrage en dit", () => {
  it("avertit, nomme `nodefony create front` et TOUS ses moteurs", async () => {
    const { journal, boot } = await serviceDemarre();
    await boot();

    const avertissements = journal.filter((l) => l.severite === "WARNING");
    expect(
      avertissements,
      "un INFO se perd dans le flot de démarrage : le niveau fait partie du correctif",
    ).to.have.lengthOf(1);

    const texte = String(avertissements[0].message);
    expect(texte).to.contain("nodefony create front");
    // `none` est un choix de la commande, pas un moteur : il n'a rien à faire
    // dans une invite qui propose d'en POSER un.
    const moteurs = FRONTEND_CHOICES.filter((c) => c !== "none");
    for (const moteur of moteurs) {
      expect(texte, `le moteur « ${moteur} » doit être nommé`).to.contain(
        moteur,
      );
    }
    expect(texte).to.not.contain("none");
  });

  it("se tait — et démarre Vite — dès qu'une entrée est déclarée", async () => {
    const { service, journal, boot } = await serviceDemarre();
    // Entrée posée directement : `registerEntry` résoudrait des chemins sur le
    // disque, ce que cette décision n'observe pas.
    (service as unknown as { entries: IResolvedFrontendEntry[] }).entries.push({
      moduleName: "test",
      entryName: "test",
      type: "react19",
      root: "/tmp",
      entryFile: "src/main.tsx",
      outDir: "/tmp/dist",
      publicPath: "/_assets/test/",
      apiProxyPaths: [],
    });
    let demarre = false;
    (service as unknown as { startDev: unknown }).startDev = async () => {
      demarre = true;
    };

    await boot();

    expect(
      journal.filter((l) => l.severite === "WARNING"),
      "avertir une application QUI A un front est le pire des deux défauts",
    ).to.have.lengthOf(0);
    expect(demarre, "le superviseur doit démarrer").to.equal(true);
  });
});
