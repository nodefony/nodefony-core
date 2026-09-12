import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { runGenerate } from "../../nodefony/src/migrator/kit";
import {
  MigrationToolError,
  formatToolOutput,
} from "../../nodefony/src/migrator/refusals";

/**
 * **Un refus de génération doit NOMMER ce qui l'a arrêté.**
 *
 * Ce que ce fichier garde, et qui a été mesuré : la génération levait une
 * `Error` nue, qui tombait dans le fourre-tout des commandes de migration.
 * Celui-ci avoue ne rien savoir, puis propose deux explications — base muette,
 * droits insuffisants — dont AUCUNE n'était la bonne : la génération
 * n'interroge même pas la base. Elle envoyait donc vérifier un serveur qui
 * répond très bien, pendant que la cause était dans le fichier d'entité qu'on
 * venait d'éditer. Un message d'erreur est cru PARCE QU'il est précis.
 */
describe("la génération refuse en nommant sa cause", () => {
  /**
   * Une racine portant un FAUX `drizzle-kit` qui écrit `sortie` puis sort 0.
   *
   * Le code 0 n'est pas une facilité de décor : c'est le comportement RÉEL de
   * l'outil, qui rend zéro même en échec. Un faux binaire qui sortirait 1
   * éprouverait un chemin que personne ne rencontre.
   */
  const racineAvecFauxOutil = (sortie: string): string => {
    const racine = mkdtempSync(path.join(os.tmpdir(), "nf-faux-kit-"));
    const dir = path.join(racine, "node_modules", "drizzle-kit");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "bin.cjs"),
      `process.stderr.write(${JSON.stringify(sortie)});\nprocess.exit(0);\n`,
    );
    return racine;
  };

  const refus = (sortie: string): MigrationToolError => {
    try {
      runGenerate({
        cwd: racineAvecFauxOutil(sortie),
        configRel: "drizzle.config.ts",
        name: "add_team",
        label: "le connecteur « default » (sqlite)",
        regenerateCommand: "nodefony orm:generate --name add_team",
      });
    } catch (e) {
      assert.ok(
        e instanceof MigrationToolError,
        `refus non typé : ${String(e)}`,
      );
      return e;
    }
    throw new Error("la génération aurait dû être refusée");
  };

  it("REMONTE ce que l'outil a dit, au lieu de le remplacer par deux hypothèses", () => {
    const e = refus(
      "Error: cannot drop column 'department' — sqlite ne sait pas faire\n",
    );
    assert.equal(e.refusal.code, "NF_GENERATE_TOOL_FAILED");
    // La cause RÉELLE, mot pour mot : c'est elle qui manquait.
    assert.match(e.refusal.meaning, /cannot drop column 'department'/u);
    // Et surtout, plus le fourre-tout : son code le dit (il valait
    // « NF_MIGRATE_UNAVAILABLE »), et son explication ne s'ouvre plus sur deux
    // hypothèses qu'aucune observation ne soutient.
    assert.doesNotMatch(
      e.refusal.meaning,
      /explications les plus fréquentes|sans avoir pu nommer la cause/u,
    );
    // Elle dit au contraire ce qu'on SAIT : cette étape n'interroge pas la base.
    assert.match(e.refusal.meaning, /n'est PAS en cause/u);
  });

  it("ses gestes parlent de l'ENTITÉ, jamais de la base", () => {
    const e = refus("Error: something broke\n");
    const gestes = e.refusal.nextActions.map((a) => a.command);
    // Le défaut exact : `orm:migrate:status` répondait « ✓ à jour », donc le
    // geste ne menait nulle part.
    assert.ok(
      !gestes.some((g) => g.includes("orm:migrate:status")),
      `un geste interroge la base : ${JSON.stringify(gestes)}`,
    );
    assert.ok(
      gestes.some((g) => g.includes("entities")),
      `aucun geste ne mène au schéma déclaré : ${JSON.stringify(gestes)}`,
    );
  });

  it("distingue la QUESTION de l'outil d'un échec, et donne la commande à rejouer", () => {
    const e = refus("Interactive prompts require a TTY\n");
    assert.equal(e.refusal.code, "NF_GENERATE_NEEDS_ANSWER");
    assert.equal(
      e.refusal.nextActions[0]?.command,
      "nodefony orm:generate --name add_team",
    );
    // Le piège qui suit la réponse « renamed » — un type changé disparaît.
    assert.match(e.refusal.meaning, /3826/u);
  });

  describe("citation de la sortie d'un outil", () => {
    it("ANNONCE sa troncature — une coupe muette fait chercher dans le vide", () => {
      const long = Array.from({ length: 50 }, (_, i) => `ligne ${i}`).join(
        "\n",
      );
      const cite = formatToolOutput(long, 10);
      // Ce qui a cassé est à la FIN, jamais au début.
      assert.match(cite, /ligne 49/u);
      assert.doesNotMatch(cite, /ligne 39/u);
      assert.match(cite, /40 ligne\(s\) plus haut/u);
    });

    it("dit quand l'outil n'a RIEN écrit, plutôt que de rendre du vide", () => {
      assert.match(formatToolOutput("\n  \n"), /n'a rien écrit/u);
    });
  });
});
