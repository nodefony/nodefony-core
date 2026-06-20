/*
 *   Tests UNITAIRES du rapport status « standalone ». La collecte/rendu (runStatusReport)
 *   fait des I/O système (ps, stdout) testés en E2E runtime ; ici on verrouille la liste
 *   des commandes exécutables SANS boot kernel (statut « système », marche hors trunk).
 */

import assert from "node:assert";
import { isStandaloneDevCommand } from "../service/dev/devStatusReport";

describe("devStatusReport — commandes système standalone", () => {
  it("status est standalone (zéro boot) ; les commandes serveur ne le sont PAS", () => {
    assert.strictEqual(isStandaloneDevCommand("status"), true);
    assert.strictEqual(isStandaloneDevCommand("development"), false);
    assert.strictEqual(isStandaloneDevCommand("cluster"), false);
    assert.strictEqual(isStandaloneDevCommand("build"), false);
  });
});
