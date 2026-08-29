import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { resolveDrizzleKitBin } from "../../nodefony/src/migrator/kit";
import { MigrationToolError } from "../../nodefony/src/migrator/refusals";

/**
 * **L'outil de génération absent est une cause à part, pas un incident de base.**
 *
 * Ce que ce fichier garde, et qui a été mesuré : quand cette cause tombait dans
 * le fourre-tout des commandes de migration, la charge utile publiée portait
 * DEUX explications contradictoires — le fait disait « l'outil manque »,
 * l'explication disait « la base n'a pas répondu… vérifie qu'elle est démarrée
 * et joignable », et les deux gestes proposés interrogeaient une base qui n'y
 * était pour rien. Un lecteur qui suit l'explication cherche au mauvais endroit ;
 * un agent y perd des tours.
 */
describe("l'outil qui écrit les migrations est absent", () => {
  /** Un dossier vide, sans `node_modules` au-dessus — le cas à éprouver. */
  const nulPart = (): string =>
    mkdtempSync(path.join(os.tmpdir(), "nf-sans-outil-"));

  it("le refus est TYPÉ — la cause porte son propre remède", () => {
    // Reconnaître la cause au texte de son message serait une garde qui se
    // casse au premier reformulage : c'est le TYPE qui la transporte.
    assert.throws(
      () => resolveDrizzleKitBin(nulPart()),
      (e: unknown) =>
        e instanceof MigrationToolError &&
        e.refusal.code === "NF_GENERATE_TOOL_MISSING",
    );
  });

  it("son explication ne parle PAS de la base", () => {
    try {
      resolveDrizzleKitBin(nulPart());
      assert.fail("un dossier sans l'outil doit être refusé");
    } catch (e) {
      assert.ok(e instanceof MigrationToolError);
      const { meaning, summary } = e.refusal;
      // Le défaut exact : l'explication envoyait vérifier un serveur.
      assert.doesNotMatch(meaning, /démarrée|joignable/u);
      // …et elle dit ce qui manque VRAIMENT.
      assert.match(meaning, /développement/u);
      assert.match(summary, /drizzle-kit/u);
    }
  });

  it("son premier geste est celui qui répare", () => {
    try {
      resolveDrizzleKitBin(nulPart());
      assert.fail("un dossier sans l'outil doit être refusé");
    } catch (e) {
      assert.ok(e instanceof MigrationToolError);
      const gestes = e.refusal.nextActions.map((a) => a.command);
      assert.equal(gestes[0], "npm install");
      // Aucun geste n'envoie interroger la base : elle n'est pas en cause.
      assert.ok(
        !gestes.some((g) => g.includes("orm:migrate:status")),
        `un geste interroge la base : ${JSON.stringify(gestes)}`,
      );
    }
  });
});
