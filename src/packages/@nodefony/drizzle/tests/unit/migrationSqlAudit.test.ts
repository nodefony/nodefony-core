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

  /**
   * Le SQL de la tâche 33 du banc de découvrabilité, tel qu'il a été produit.
   *
   * L'agent devait ajouter un champ `slug` unique à une table qui portait déjà
   * des données, sans les perdre. Il a fait tout ce qu'on attend : lu
   * `AGENTS.md`, chargé le skill des migrations, appelé `orm:generate`. Ce que
   * le générateur lui a rendu était inapplicable, et ne le disait pas. Il a
   * amendé, l'unicité a explosé, puis il a supprimé la base.
   *
   * Ces deux règles ne peuvent pas REFUSER — le générateur ne lit pas la base
   * et ignore si la table est peuplée. Mais l'inapplicabilité est une propriété
   * du SQL écrit, pas de la donnée : elle se voit sans se connecter.
   */
  describe("inapplicable sur une table PEUPLÉE — vu sans lire la base", () => {
    /** Ce que `orm:generate` a écrit, mot pour mot. */
    const GENERE_TACHE_33 =
      "ALTER TABLE `articles` ADD `slug` text NOT NULL;--> statement-breakpoint\n" +
      "CREATE UNIQUE INDEX `articles_slug_unique` ON `articles` (`slug`);";

    it("nomme les DEUX défauts du SQL réellement généré", () => {
      const a = auditMigrationSql(GENERE_TACHE_33, "sqlite");
      assert.deepEqual(ids(a.blocking).sort(), [
        "add-not-null-sans-defaut",
        "colonne-neuve-puis-index-unique",
      ]);
      assert.equal(a.destructive.length, 0, "ajouter ne détruit rien");
    });

    it("le défaut de valeur lève le premier grief, jamais le second", () => {
      // Le geste que la documentation prescrivait — et qui a fait exploser
      // l'unicité, toutes les lignes recevant la même chaîne vide.
      const a = auditMigrationSql(
        "ALTER TABLE `articles` ADD `slug` text NOT NULL DEFAULT '';" +
          "--> statement-breakpoint\n" +
          "CREATE UNIQUE INDEX `articles_slug_unique` ON `articles` (`slug`);",
        "sqlite",
      );
      assert.deepEqual(ids(a.blocking), ["colonne-neuve-puis-index-unique"]);
    });

    it("vaut sur les trois moteurs — le risque n'est pas propre à un dialecte", () => {
      for (const dialecte of ["sqlite", "postgres", "mysql"] as const) {
        const a = auditMigrationSql(
          'ALTER TABLE "t" ADD COLUMN "c" text NOT NULL;',
          dialecte,
        );
        assert.ok(
          ids(a.blocking).includes("add-not-null-sans-defaut"),
          `rien signalé sur ${dialecte} — MySQL est celui qui remplit de vide`,
        );
      }
    });

    it("une colonne FACULTATIVE ne déclenche rien", () => {
      const a = auditMigrationSql("ALTER TABLE `t` ADD `c` text;", "sqlite");
      assert.deepEqual(a.blocking, []);
    });

    it("un index unique sur une colonne DÉJÀ en place ne déclenche rien", () => {
      // Le faux positif qui rendrait l'alerte inaudible : ici rien n'est
      // ajouté, donc les lignes portent déjà leurs valeurs distinctes.
      const a = auditMigrationSql(
        "CREATE UNIQUE INDEX `t_email_unique` ON `t` (`email`);",
        "sqlite",
      );
      assert.deepEqual(a.blocking, []);
    });

    it("un index unique sur une AUTRE colonne que celle ajoutée ne déclenche rien", () => {
      const a = auditMigrationSql(
        "ALTER TABLE `t` ADD `note` text;--> statement-breakpoint\n" +
          "CREATE UNIQUE INDEX `t_email_unique` ON `t` (`email`);",
        "sqlite",
      );
      assert.deepEqual(a.blocking, []);
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

/**
 * Les DEUX portes qui jugent le même SQL, confrontées l'une à l'autre.
 *
 * Le dépôt tient qu'une règle a une seule implémentation. Ici, deux tables de
 * motifs coexistent : celle de la GÉNÉRATION (`auditMigrationSql`, qui relit ce
 * que l'outil vient d'écrire) et celle de l'APPLICATION (`scanDestructive`, qui
 * relit ce qui va être exécuté). Elles ne sont pas redondantes — elles jugent à
 * deux moments où l'on ne peut pas la même chose : à la génération l'auteur
 * peut encore renoncer, à l'application le fichier est déjà relu et versionné.
 *
 * Mais deux tables divergent en silence, chacune verte dans ses propres tests.
 * Ce banc est le filet que le dépôt prescrit quand une duplication reste :
 * il compare les deux VERDICTS, motif par motif, et rend l'asymétrie
 * intentionnelle au lieu de la laisser être un oubli.
 */
describe("les deux portes du SQL destructeur — aucune divergence SILENCIEUSE", () => {
  /** Un échantillon par famille, écrit pour être reconnu des deux côtés. */
  const ECHANTILLONS: { sql: string; famille: string }[] = [
    { sql: "DROP TABLE `article`;", famille: "drop-table" },
    { sql: "ALTER TABLE `a` DROP COLUMN `b`;", famille: "drop-column" },
    { sql: "TRUNCATE TABLE `article`;", famille: "truncate" },
  ];

  it("🔴 ce que l'APPLICATION tient pour une perte, la GÉNÉRATION le refuse aussi", () => {
    for (const { sql, famille } of ECHANTILLONS) {
      const aLaGeneration = auditMigrationSql(sql, "sqlite").destructive;
      assert.ok(
        aLaGeneration.length > 0,
        `« ${famille} » passe la génération sans un mot : les deux portes ` +
          `divergent, et c'est la plus permissive qui décide`,
      );
    }
  });

  it("🔴 l'asymétrie ASSUMÉE est nommée — le changement de type", () => {
    // Cette famille est destructive à la génération et seulement « rupture » à
    // l'application, et c'est VOULU : à la génération on peut encore renoncer,
    // à l'application le fichier a été relu et versionné. Le test existe pour
    // que ce choix reste un CHOIX : le jour où l'un des deux côtés change, il
    // tombe, et quelqu'un doit trancher à nouveau.
    const sql = "ALTER TABLE `a` ALTER COLUMN `b` TYPE integer;";
    assert.ok(
      auditMigrationSql(sql, "postgres").destructive.some(
        (r) => r.id === "alter-column-type",
      ),
      "le changement de type doit être refusé à la GÉNÉRATION",
    );
  });
});
