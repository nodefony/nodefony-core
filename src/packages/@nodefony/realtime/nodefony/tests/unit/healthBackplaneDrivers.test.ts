import { expect } from "chai";
// Import du BARREL du module, pas seulement du registre : les drivers natifs
// s'enregistrent au chargement du module (`index.ts`), exactement comme en runtime.
// Importer le registre seul donnerait un registre vide — et un test qui prouve le
// contraire de ce que voit une application.
import "../../../index";
import { buildOwnHealth } from "../../src/server/RealtimeAdminApi";
import {
  listBackplaneDrivers,
  registerBackplaneDriver,
} from "../../src/backplane/backplaneRegistry";

/**
 * La sonde doit dire ce qu'on POURRAIT brancher, pas seulement ce qui l'est.
 *
 * `backplane.driver` répond « qui transporte mes messages maintenant ». Il ne dit
 * rien de l'alternative déjà présente dans le process — or c'est exactement la
 * question que pose un exploitant devant un fan-out qui ne franchit pas les pods.
 * Sans cette liste, un écran d'administration ne peut que constater l'actif : il
 * lui faudrait deviner le catalogue, donc le figer en dur, donc mentir le jour où
 * une application enregistre le sien.
 */
describe("sonde realtime — drivers de backplane disponibles", () => {
  it("expose les drivers du registre à côté du driver actif", () => {
    const health = buildOwnHealth();
    expect(health.backplaneDrivers).to.be.an("array");
    // Les trois natifs, tels que le module les enregistre.
    expect(health.backplaneDrivers).to.include("loopback");
    expect(health.backplaneDrivers).to.include("cluster");
    expect(health.backplaneDrivers).to.include("redis");
  });

  it("reflète un driver ajouté par une application (registre OUVERT)", () => {
    registerBackplaneDriver("banc-transport", () => {
      throw new Error("fabrique jamais appelée : seul le NOM est sondé ici");
    });
    expect(listBackplaneDrivers()).to.include("banc-transport");
    expect(buildOwnHealth().backplaneDrivers).to.include("banc-transport");
  });

  it("ne prétend jamais qu'un driver non enregistré est disponible", () => {
    // Garde-fou de la règle « pas de nom mort » : ce qui n'est pas dans le
    // registre ne doit apparaître nulle part comme branchable.
    expect(buildOwnHealth().backplaneDrivers).to.not.include("kafka");
  });
});
