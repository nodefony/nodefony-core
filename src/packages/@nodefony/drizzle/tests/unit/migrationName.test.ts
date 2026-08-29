import assert from "node:assert/strict";
import {
  checkMigrationName,
  MIGRATION_NAME_MAX,
  suggestMigrationName,
} from "../../nodefony/src/migrator/name";

/**
 * Le nom d'une migration — **la seule chose de la chaîne qui ne se corrige plus**.
 *
 * Un tag entre dans le journal, puis dans la table d'historique de chaque base
 * qui a reçu la migration. Le renommer plus tard reviendrait à dire à ces bases
 * qu'elles n'ont jamais reçu ce qu'elles ont pourtant appliqué. La validation
 * qui le garde est donc le dernier moment où quelque chose est rattrapable.
 *
 * Deux exigences, et la seconde est celle qu'on oublie : refuser ce qui ne va
 * pas, et **proposer un geste qui MARCHE**. Une suggestion que la commande
 * refuserait ensuite coûte un aller-retour et, surtout, la confiance dans
 * toutes les autres suggestions de l'outil.
 */
describe("@nodefony/drizzle — nom d'une migration", () => {
  describe("ce qui passe", () => {
    for (const nom of [
      "ajout_du_titre",
      "init",
      "v2",
      "ajout_colonne_2024",
      "a",
    ]) {
      it(`accepte « ${nom} »`, () => {
        assert.deepEqual(checkMigrationName(nom), { ok: true, name: nom });
      });
    }

    it("accepte un nom exactement à la limite", () => {
      const nom = "a".repeat(MIGRATION_NAME_MAX);
      assert.equal(checkMigrationName(nom).ok, true);
    });
  });

  describe("ce qui est refusé, et ce qu'on propose à la place", () => {
    it("un nom absent est refusé sans suggestion — il n'y a rien à dériver", () => {
      const v = checkMigrationName(undefined);
      assert.equal(v.ok, false);
      assert.ok(!v.ok && v.suggestion === undefined);
    });

    it("une chaîne vide est traitée comme un nom absent", () => {
      assert.equal(checkMigrationName("").ok, false);
    });

    it("🔴 les MAJUSCULES sont refusées, et la suggestion les abaisse", () => {
      // Le cas le plus fréquent : un nom recopié d'un ticket ou d'un tableau.
      const v = checkMigrationName("AjoutDuTitre");
      assert.equal(v.ok, false);
      assert.ok(!v.ok && v.suggestion === "ajoutdutitre");
    });

    it("les espaces deviennent des traits bas", () => {
      const v = checkMigrationName("ajout du titre");
      assert.ok(!v.ok && v.suggestion === "ajout_du_titre");
    });

    it("🔴 les accents sont refusés — un fichier accentué ne voyage pas", () => {
      const v = checkMigrationName("ajout_entête");
      assert.ok(!v.ok && v.suggestion === "ajout_ent_te");
    });

    it("le tiret est refusé, et remplacé par le trait bas", () => {
      const v = checkMigrationName("ajout-du-titre");
      assert.ok(!v.ok && v.suggestion === "ajout_du_titre");
    });

    it("les traits bas de bord sont retirés de la suggestion", () => {
      // `_ajout_` produirait un tag `0001__ajout_` — deux traits bas collés,
      // qu'on relit mal et qu'on retape encore plus mal.
      const v = checkMigrationName(" ajout ");
      assert.ok(!v.ok && v.suggestion === "ajout");
    });

    it("🔴 un nom entièrement non latin ne rend AUCUNE suggestion", () => {
      // La dérivation ne laisserait que des traits bas : le geste proposé
      // produirait `0001__`, illisible dans six mois. Ne rien proposer et
      // laisser l'utilisateur choisir vaut mieux qu'un geste absurde qui, lui,
      // serait accepté.
      for (const nom of ["日本語", "ΑΒΓ", "—", "***"]) {
        const v = checkMigrationName(nom);
        assert.equal(v.ok, false, `« ${nom} » aurait dû être refusé`);
        assert.ok(
          !v.ok && v.suggestion === undefined,
          `« ${nom} » a produit la suggestion « ${!v.ok ? v.suggestion : ""} »`,
        );
      }
    });

    it("🔴 un nom fait UNIQUEMENT de traits bas est refusé", () => {
      // Il passe la forme (`[a-z0-9_]+`) mais ne porte aucune substance.
      const v = checkMigrationName("___");
      assert.equal(v.ok, false);
      assert.ok(!v.ok && /aucune lettre ni chiffre/.test(v.reason));
    });

    it("🔴 un nom trop long est refusé AVANT d'écrire un fichier", () => {
      // Sinon l'échec arrive à l'écriture, sous forme de code d'erreur système,
      // après que le journal a peut-être déjà été touché.
      const v = checkMigrationName("a".repeat(MIGRATION_NAME_MAX + 1));
      assert.equal(v.ok, false);
      assert.ok(!v.ok && v.reason.includes(String(MIGRATION_NAME_MAX)));
    });

    it("la suggestion d'un nom trop long est TRONQUÉE à la limite", () => {
      const v = checkMigrationName(`${"ajout ".repeat(60)}`);
      assert.ok(!v.ok && v.suggestion);
      assert.ok((v.suggestion as string).length <= MIGRATION_NAME_MAX);
    });
  });

  describe("🔴 le contrat qui tient tout : une suggestion est TOUJOURS acceptable", () => {
    it("toute suggestion produite repasse la validation avec succès", () => {
      // C'est l'invariant qui empêche la classe entière de défauts « le geste
      // proposé est une commande qui va refuser ». Il se vérifie sur la
      // dérivation elle-même, pas cas par cas.
      const saisies = [
        "AjoutDuTitre",
        "ajout du titre",
        "ajout-entête",
        "  ",
        "___ajout___",
        "日本語",
        "MiXeD 123 Ω",
        "a".repeat(400),
        "!!!",
        "2024_01_01 Ajout",
      ];
      for (const saisie of saisies) {
        const suggestion = suggestMigrationName(saisie);
        if (suggestion === undefined) {
          continue;
        }
        const relu = checkMigrationName(suggestion);
        assert.equal(
          relu.ok,
          true,
          `« ${saisie} » a suggéré « ${suggestion} », que la commande refuse`,
        );
      }
    });
  });
});
