import assert from "node:assert/strict";
import {
  touchesExistingRows,
  verifierLesDonnees,
} from "../../nodefony/src/migrator/destructive";

/**
 * Ce que cette suite protège : la sortie de SUCCÈS de `orm:migrate`.
 *
 * Elle annonçait « ✓ 1 migration appliquée » et s'arrêtait là. Mesuré sur la
 * tâche 33 du banc de découvrabilité, un agent à qui l'on demandait de PROUVER
 * que les données existantes avaient survécu a répondu « montrons-le en
 * réinitialisant la base » — et la ligne témoin, celle qu'il devait justement
 * préserver, a disparu. Le produit savait faire autrement ; il ne le disait pas
 * au seul moment où la question se pose.
 */
describe("après une migration réussie — vérifier sans détruire", () => {
  const lot = (...statements: string[]) => [{ statements }];

  describe("touchesExistingRows — un schéma initial ne pose pas la question", () => {
    it("un lot purement CREATE TABLE : rien n'existait avant", () => {
      assert.equal(
        touchesExistingRows(
          lot(
            "CREATE TABLE `articles` (`id` text PRIMARY KEY)",
            "CREATE INDEX `idx_articles_id` ON `articles` (`id`)",
          ),
        ),
        false,
      );
    });

    it("ALTER TABLE : une table qui existait déjà, donc des lignes", () => {
      assert.equal(
        touchesExistingRows(lot("ALTER TABLE `articles` ADD `slug` text")),
        true,
      );
    });

    it("le remplissage d'une colonne neuve — le cas exact du banc", () => {
      assert.equal(
        touchesExistingRows(
          lot(
            "ALTER TABLE `articles` ADD `slug` text",
            "UPDATE `articles` SET `slug` = lower(`title`)",
          ),
        ),
        true,
      );
    });

    it("la recréation de table de sqlite compte : les lignes sont recopiées", () => {
      assert.equal(
        touchesExistingRows(
          lot(
            "CREATE TABLE `__new_articles` (`id` text PRIMARY KEY, `slug` text)",
            "INSERT INTO `__new_articles` SELECT `id`, NULL FROM `articles`",
            "DROP TABLE `articles`",
          ),
        ),
        true,
      );
    });

    it("un lot vide ne déclenche rien", () => {
      assert.equal(touchesExistingRows([]), false);
      assert.equal(touchesExistingRows(lot()), false);
    });
  });

  describe("verifierLesDonnees — le moyen, pas une invitation à effacer", () => {
    const phrase = verifierLesDonnees("default");

    it("écarte explicitement la base vide — c'est le geste qu'un agent invente", () => {
      assert.match(phrase, /ne repars pas d'une base\s+vide/);
    });

    it("ne propose AUCUNE des commandes qui détruisent la base", () => {
      for (const interdit of ["orm:reset", "DROP TABLE", "DROP DATABASE"]) {
        assert.ok(
          !phrase.includes(interdit),
          `« ${interdit} » ne doit pas figurer dans un conseil de vérification`,
        );
      }
    });

    it("nomme un moyen sur place ET un moyen sur copie", () => {
      assert.match(phrase, /SELECT COUNT\(\*\)/);
      assert.match(phrase, /NF_MIGRATE_DATABASE_URL/);
    });

    it("porte les DEUX interpréteurs : « VAR=x » est refusé par Windows", () => {
      assert.match(phrase, /PowerShell/);
      assert.match(phrase, /\$env:NF_MIGRATE_DATABASE_URL/);
    });

    it("cible le connecteur demandé, et le tait quand c'est le défaut", () => {
      assert.ok(!phrase.includes("--connector"));
      assert.match(
        verifierLesDonnees("facturation"),
        /--connector facturation/,
      );
    });
  });
});
