/**
 * Le bilan de boot — ce qu'il dit d'un démarrage qui n'a rien tenté.
 *
 * Ce que ces tests protègent : un boot où le manifeste `modules` est VIDE ne
 * remplit aucune des listes du bilan — ni chargés, ni en échec, ni gatés, parce
 * que rien n'a été tenté. Vécu : une application dont la configuration lue ne
 * déclarait aucun module démarrait avec son seul module local, puis échouait sur
 * « profil serveur mais aucun serveur en écoute ». Le diagnostic était exact et
 * ne menait nulle part — il décrivait l'absence de serveurs, jamais celle des
 * modules. Le décompte du manifeste est ce qui manquait.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert";

import Kernel from "../kernel/Kernel";
import { Nodefony } from "../Nodefony";

/** Kernel nu (aucun boot) — seul le bilan nous intéresse ici. */
function makeKernel(opts: Record<string, unknown> = {}): Kernel {
  return new Kernel("development", null, { log: { active: false }, ...opts });
}

/** Pose le profil d'exécution : attend-il des serveurs réseau ? */
function withServers(kernel: Kernel, servers: boolean): Kernel {
  kernel.runProfile = { ...kernel.runProfile, servers };
  return kernel;
}

describe("bilan de boot — le manifeste `modules` est une donnée du verdict", () => {
  // `new Kernel()` écrase le singleton `Nodefony.getKernel()` → restauration,
  // sinon les autres fichiers de la suite héritent du nôtre (piège connu).
  let prevKernel: Kernel | null;
  beforeAll(() => {
    prevKernel = Nodefony.getKernel();
  });
  afterAll(() => {
    Nodefony.setKernel(prevKernel as Kernel);
  });

  it("compte les entrées DÉCLARÉES, indépendamment de ce qui a été chargé", () => {
    const kernel = makeKernel({
      modules: ["@nodefony/http", "@nodefony/framework", "@nodefony/security"],
    });
    const report = kernel.getBootReport();
    assert.strictEqual(
      report.manifestEntries,
      3,
      "le bilan doit dire ce que la configuration DEMANDAIT",
    );
    // Aucun n'a été chargé (pas de boot) : les deux nombres sont bien distincts.
    assert.strictEqual(report.modulesLoaded.length, 0);
  });

  it("manifeste VIDE sous profil serveur : le bilan le nomme et propose une action", () => {
    const kernel = withServers(makeKernel({ modules: [] }), true);
    const report = kernel.getBootReport();
    assert.strictEqual(report.manifestEntries, 0);
    assert.ok(
      report.remediation,
      "un profil serveur sans aucun module déclaré ne doit JAMAIS rester muet — " +
        "c'est l'état qui a coûté une enquête entière",
    );
    assert.match(
      report.remediation as string,
      /modules/,
      `la remédiation doit parler du manifeste, pas des serveurs : ${report.remediation}`,
    );
  });

  it("manifeste vide SANS profil serveur : aucun diagnostic (cas nominal d'une commande)", () => {
    const kernel = withServers(makeKernel({ modules: [] }), false);
    const report = kernel.getBootReport();
    assert.strictEqual(report.manifestEntries, 0);
    assert.strictEqual(
      report.remediation,
      undefined,
      "une commande batch boote légitimement sans manifeste — poser une " +
        "remédiation ici la recopierait partout où le bilan est lu",
    );
  });
});
