import assert from "node:assert/strict";
import {
  dataLoss,
  renderDestructive,
  scanDestructive,
  summarizeDestructive,
  type IDestructiveFinding,
} from "../../nodefony/src/migrator/destructive";
import type { IMigrationFile } from "../../nodefony/src/migrator/types";

/**
 * Le garde qui empêche d'appliquer une suppression sans le savoir.
 *
 * Deux erreurs sont possibles, et elles ne coûtent pas pareil. **Rater une
 * suppression** coûte des données. **Crier au loup** coûte la confiance : un
 * garde qui se déclenche sur des migrations ordinaires est désarmé au bout de
 * trois fois, et il ne protège alors plus de rien. Les deux familles de cas
 * ci-dessous pèsent donc autant l'une que l'autre.
 */

function fichier(sql: string[], tag = "0001_x"): IMigrationFile {
  return {
    source: "app",
    tag,
    idx: 1,
    hash: "sha256:x",
    statements: sql,
    path: `/m/${tag}.sql`,
  };
}

function kinds(f: IDestructiveFinding[]): string[] {
  return f.map((x) => x.kind);
}

describe("garde destructif — ce qui DOIT être vu", () => {
  it("une table supprimée est une perte de données", () => {
    const f = scanDestructive([fichier(["DROP TABLE `post`"])]);
    assert.deepEqual(kinds(f), ["drop-table"]);
    assert.equal(f[0]?.severity, "data-loss");
  });

  it("une colonne supprimée est une perte, avec ou SANS le mot `COLUMN`", () => {
    // 🔴 Le piège : PostgreSQL et MySQL acceptent `DROP nom` tout court. Un
    // motif qui n'attendrait que `DROP COLUMN` laisserait passer la moitié des
    // suppressions réelles.
    for (const sql of [
      'ALTER TABLE "post" DROP COLUMN "brouillon"',
      'ALTER TABLE "post" DROP "brouillon"',
      "ALTER TABLE `post` DROP `brouillon`",
    ]) {
      const f = scanDestructive([fichier([sql])]);
      assert.deepEqual(kinds(f), ["drop-column"], sql);
      assert.equal(f[0]?.severity, "data-loss", sql);
    }
  });

  it("vider une table est une perte — `TRUNCATE` comme `DELETE` sans filtre", () => {
    assert.equal(
      scanDestructive([fichier(["TRUNCATE TABLE session"])])[0]?.kind,
      "truncate",
    );
    assert.equal(
      scanDestructive([fichier(["DELETE FROM session"])])[0]?.kind,
      "delete-all",
    );
  });

  it("supprimer une base ou un schéma entier est le cas le plus grave", () => {
    assert.equal(
      scanDestructive([fichier(["DROP SCHEMA public CASCADE"])])[0]?.severity,
      "data-loss",
    );
  });
});

describe("garde destructif — ce qui ne DOIT PAS crier au loup", () => {
  it("créer une table ou ajouter une colonne ne déclenche RIEN", () => {
    const f = scanDestructive([
      fichier([
        'CREATE TABLE "post" ("id" text PRIMARY KEY, "titre" text NOT NULL)',
        'ALTER TABLE "post" ADD COLUMN "resume" text',
        'CREATE INDEX "post_titre_idx" ON "post" ("titre")',
      ]),
    ]);
    assert.deepEqual(f, [], JSON.stringify(f));
  });

  it("🔴 un `DELETE` AVEC filtre est une migration de données ordinaire", () => {
    // Recopier, nettoyer une valeur héritée, corriger une ligne : c'est le
    // travail normal d'une migration. Le signaler noierait les vraies pertes.
    assert.deepEqual(
      scanDestructive([
        fichier(["DELETE FROM session WHERE expires_at < 1700000000"]),
      ]),
      [],
    );
  });

  it("🔴 retirer une contrainte ou un index n'est PAS une perte de données", () => {
    // Les données restent, les protections partent : c'est un avertissement,
    // pas un refus. Le confondre bloquerait des migrations légitimes.
    for (const sql of [
      'ALTER TABLE "post" DROP CONSTRAINT "post_auteur_fk"',
      'DROP INDEX "post_titre_idx"',
      'ALTER TABLE "post" ALTER COLUMN "titre" DROP NOT NULL',
      'ALTER TABLE "post" ALTER COLUMN "titre" DROP DEFAULT',
    ]) {
      const f = scanDestructive([fichier([sql])]);
      assert.equal(
        dataLoss(f).length,
        0,
        `${sql} → ${JSON.stringify(kinds(f))}`,
      );
    }
  });

  it("🔴 la recréation de table SQLite n'est pas une perte — mais reste signalée", () => {
    // SQLite ne sait pas modifier une colonne : l'outil recrée la table et
    // recopie les lignes. Compter ce `DROP TABLE` comme une perte ferait
    // refuser chaque changement de colonne en développement, et le garde serait
    // désarmé au bout de trois fois. Il reste signalé, parce qu'une colonne
    // absente du `INSERT … SELECT` serait, elle, bel et bien perdue.
    const f = scanDestructive([
      fichier([
        "PRAGMA foreign_keys=OFF",
        "CREATE TABLE `__new_post` (`id` text PRIMARY KEY, `titre` text)",
        "INSERT INTO `__new_post`(`id`, `titre`) SELECT `id`, `titre` FROM `post`",
        "DROP TABLE `post`",
        "ALTER TABLE `__new_post` RENAME TO `post`",
        "PRAGMA foreign_keys=ON",
      ]),
    ]);
    assert.equal(dataLoss(f).length, 0, JSON.stringify(kinds(f)));
    assert.ok(
      f.some((x) => x.kind === "table-rebuild"),
      "la recréation doit être SIGNALÉE, pas passée sous silence",
    );
    assert.ok(
      f.every((x) => x.severity === "breaking"),
      "une recréation reste un avertissement",
    );
  });

  it("changer un type ou rendre obligatoire avertit sans bloquer", () => {
    for (const sql of [
      'ALTER TABLE "post" ALTER COLUMN "vues" TYPE bigint',
      "ALTER TABLE `post` MODIFY COLUMN `vues` bigint NOT NULL",
      'ALTER TABLE "post" ALTER COLUMN "titre" SET NOT NULL',
    ]) {
      const f = scanDestructive([fichier([sql])]);
      assert.equal(f.length, 1, sql);
      assert.equal(f[0]?.severity, "breaking", sql);
    }
  });
});

describe("garde destructif — ce qu'il DIT", () => {
  const trouvailles = scanDestructive([
    fichier(['ALTER TABLE "post" DROP COLUMN "brouillon"'], "0002_nettoyage"),
  ]);

  it("le refus nomme la migration, l'instruction, et ce qui est perdu", () => {
    const texte = renderDestructive(trouvailles, true);
    assert.ok(
      texte.includes("app/0002_nettoyage"),
      "la migration n'est pas nommée",
    );
    assert.ok(texte.includes("DROP COLUMN"), "l'instruction exacte manque");
    assert.ok(
      texte.includes("TOUTES ses valeurs"),
      "ce qui est perdu n'est pas dit",
    );
    assert.ok(
      texte.includes("rien n'a été appliqué"),
      "l'état de la base n'est pas dit",
    );
  });

  it("🔴 il explique pourquoi l'outil ne sauvegarde PAS, et ce qui protège vraiment", () => {
    // C'est le bloc qui évite la mauvaise conclusion (« l'outil devrait faire
    // un backup ») et qui enseigne la seule protection qui marche.
    const texte = renderDestructive(trouvailles, true);
    assert.ok(
      texte.includes("aucun outil de migration ne le"),
      "le refus laisse croire qu'une sauvegarde automatique était possible",
    );
    assert.ok(
      texte.includes("version suivante"),
      "le refus n'enseigne pas la règle qui protège (étendre puis retirer)",
    );
  });

  it("un avertissement ne prétend jamais que rien n'a été appliqué", () => {
    const texte = renderDestructive(trouvailles, false);
    assert.ok(!texte.includes("rien n'a été appliqué"));
  });

  it("le résumé d'une ligne compte les instructions ET nomme les migrations", () => {
    const r = summarizeDestructive(trouvailles, "default");
    assert.ok(r.includes("1 instruction"));
    assert.ok(r.includes("0002_nettoyage"));
  });
});
