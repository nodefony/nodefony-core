import assert from "node:assert/strict";
import {
  auditMigrationSql,
  isInteractivePromptFailure,
} from "../../scripts/drizzleKit";

/**
 * Ce que cette suite protège : la relecture d'une migration AVANT qu'elle entre
 * au journal. Un générateur de diff ne voit pas une intention — une colonne qui
 * disparaît et une autre qui apparaît, c'est un renommage ou une perte de
 * données, et lui ne peut pas trancher. Chaque cas ci-dessous correspond à une
 * manière connue de perdre des données ou d'arrêter une application en
 * production.
 */
describe("auditMigrationSql — ce qui détruit, ce qui verrouille", () => {
  const ids = (list: Array<{ id: string }>): string[] =>
    list.map((r) => r.id).sort();

  describe("destructeur — refusé sans consentement explicite", () => {
    it("DROP TABLE : la table et toutes ses lignes", () => {
      const a = auditMigrationSql("DROP TABLE `webhook_endpoint`;", "sqlite");
      assert.deepEqual(ids(a.destructive), ["drop-table"]);
    });

    it("DROP COLUMN : le cas du renommage mal interprété", () => {
      for (const dialect of ["sqlite", "postgres", "mysql"] as const) {
        const a = auditMigrationSql(
          `ALTER TABLE "t" DROP COLUMN "description";`,
          dialect,
        );
        assert.deepEqual(
          ids(a.destructive),
          ["drop-column"],
          `non détecté sur ${dialect}`,
        );
        assert.match(
          a.destructive[0].todo,
          /renomm/i,
          "le message doit ORIENTER vers le renommage, pas seulement refuser",
        );
      }
    });

    it("changement de type : PostgreSQL et MySQL s'écrivent différemment", () => {
      const pg = auditMigrationSql(
        `ALTER TABLE "audit_event" ALTER COLUMN "ts" SET DATA TYPE text;`,
        "postgres",
      );
      assert.deepEqual(ids(pg.destructive), ["alter-column-type"]);

      const my = auditMigrationSql(
        "ALTER TABLE `audit_event` MODIFY COLUMN `ts` text NOT NULL;",
        "mysql",
      );
      assert.deepEqual(ids(my.destructive), ["modify-column"]);
    });

    it("TRUNCATE : n'a rien à faire dans une migration", () => {
      const a = auditMigrationSql("TRUNCATE TABLE session;", "postgres");
      assert.deepEqual(ids(a.destructive), ["truncate"]);
    });

    it("plusieurs dangers dans un même fichier sont TOUS nommés", () => {
      const a = auditMigrationSql(
        `ALTER TABLE "a" DROP COLUMN "x";\nDROP TABLE "b";`,
        "postgres",
      );
      assert.deepEqual(ids(a.destructive), ["drop-column", "drop-table"]);
    });
  });

  describe("verrouillant — signalé, jamais bloquant", () => {
    it("CREATE INDEX PostgreSQL sans CONCURRENTLY bloque les écritures", () => {
      const a = auditMigrationSql(
        `CREATE INDEX "audit_event_ts_idx" ON "audit_event" USING btree ("ts");`,
        "postgres",
      );
      assert.deepEqual(ids(a.blocking), ["create-index-not-concurrent"]);
      assert.equal(a.destructive.length, 0, "un index ne détruit rien");
      assert.match(a.blocking[0].todo, /CONCURRENTLY/);
    });

    it("CONCURRENTLY présent : plus rien à signaler", () => {
      const a = auditMigrationSql(
        `CREATE INDEX CONCURRENTLY "i" ON "t" ("c");`,
        "postgres",
      );
      assert.deepEqual(a.blocking, []);
    });

    it("SET NOT NULL scanne la table entière sous verrou", () => {
      const a = auditMigrationSql(
        `ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL;`,
        "postgres",
      );
      assert.deepEqual(ids(a.blocking), ["set-not-null"]);
    });

    it("le risque est propre au dialecte : sqlite ne verrouille pas ainsi", () => {
      const a = auditMigrationSql("CREATE INDEX `i` ON `t` (`c`);", "sqlite");
      assert.deepEqual(
        a.blocking,
        [],
        "signaler un risque PostgreSQL sur sqlite apprendrait à ignorer l'alerte",
      );
    });
  });

  describe("faux positifs — ce qui ferait ignorer l'alerte", () => {
    it("un mot-clé dans un COMMENTAIRE ne déclenche rien", () => {
      const a = auditMigrationSql(
        `-- nodefony:migration format=1\n` +
          `-- cette migration ne fait AUCUN DROP TABLE ni DROP COLUMN\n` +
          `CREATE TABLE "t" ("id" text PRIMARY KEY NOT NULL);`,
        "postgres",
      );
      assert.deepEqual(a.destructive, []);
      assert.deepEqual(a.blocking, []);
    });

    it("la migration initiale RÉELLE ne déclenche aucun refus", async () => {
      const { readInitialMigration } =
        await import("../integration/migrations-parity");
      for (const dialect of ["sqlite", "postgres", "mysql"] as const) {
        const sql = readInitialMigration(dialect).join("\n");
        const a = auditMigrationSql(sql, dialect);
        assert.deepEqual(
          a.destructive,
          [],
          `0000_framework_init crée des tables, il ne détruit rien (${dialect})`,
        );
      }
    });
  });

  describe("l'échec sans terminal se RECONNAÎT", () => {
    it("le message de l'outil est identifié comme une question restée sans réponse", () => {
      assert.equal(
        isInteractivePromptFailure(
          "Error: Interactive prompts require a TTY terminal " +
            "(process.stdin.isTTY or process.stdout.isTTY is false).",
        ),
        true,
      );
    });

    it("un autre échec n'est pas confondu avec celui-là", () => {
      assert.equal(
        isInteractivePromptFailure("Error: ENOENT: no such file or directory"),
        false,
        "confondre les deux enverrait ouvrir un terminal pour un fichier absent",
      );
    });
  });
});
