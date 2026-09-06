import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectTables,
  entityFilesOf,
  importSpecifier,
  missingProviders,
  usurpedTables,
  writeCustomMigration,
  writeKitConfig,
  writeSchemaModule,
} from "../../nodefony/src/migrator/appSchema";
import {
  generationHappened,
  runGenerate,
  stampFormatMarker,
} from "../../nodefony/src/migrator/kit";
import {
  describeDiscovery,
  styleFor,
} from "../../nodefony/src/migrator/explain";

/**
 * Ce que `nodefony orm:generate` fait AVANT et APRÈS l'outil tiers — la partie
 * dont dépend l'exactitude d'une migration, et que l'outil ne contrôle pas.
 *
 * Le décor est une petite application POSÉE SUR LE DISQUE, sous le dépôt : la
 * remontée qui résout `drizzle-kit` doit trouver les `node_modules` du dépôt, et
 * un dossier temporaire du système en est trop loin. C'est aussi ce qui permet à
 * la génération d'être jouée pour de vrai plutôt que simulée — un banc qui se
 * contenterait de relire les fichiers écrits ne prouverait rien de ce que
 * l'outil en fait.
 */
const MODULE_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
);
const REPO_ROOT = path.resolve(MODULE_ROOT, "..", "..", "..", "..");
// Le suffixe de processus rend le décor réentrant : deux exécutions du même
// banc ne partagent plus le dossier, donc ne se nettoient plus l'une l'autre.
// Il reste sous `tmp/` du dépôt pour la raison dite plus haut — la résolution
// de `drizzle-kit` remonte jusqu'aux `node_modules` du dépôt.
const APP = path.join(REPO_ROOT, "tmp", `orm-generate-banc-${process.pid}`);
const ENTITIES = path.join(APP, "nodefony", "entity");
const OUT = path.join(APP, "migrations", "sqlite");

/** Écrit un fichier du décor, dossiers compris. */
async function put(file: string, body: string): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
  return file;
}

describe("orm:generate — ce que l'application donne à lire, et ce qu'on refuse", () => {
  beforeEach(async () => {
    await fs.rm(APP, { recursive: true, force: true });
    await fs.mkdir(ENTITIES, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(APP, { recursive: true, force: true });
  });

  it("découvre les fichiers d'entités, et écarte les contrats d'entrée", async () => {
    await put(path.join(ENTITIES, "Post.ts"), "export const x = 1;\n");
    await put(path.join(ENTITIES, "Post.schema.ts"), "export const y = 2;\n");
    await put(path.join(ENTITIES, "notes.md"), "pas du code\n");

    const files = await entityFilesOf(APP);
    assert.deepEqual(
      files.map((f) => path.basename(f)),
      ["Post.ts"],
      "un `.schema.ts` décrit une frontière d'API, jamais une table",
    );
  });

  it("une cible sans entités n'est pas une anomalie", async () => {
    assert.deepEqual(
      await entityFilesOf(path.join(APP, "modules", "vide")),
      [],
    );
  });

  it("relève les tables PAR CE QU'ELLES SONT, pas par leur nom d'export", async () => {
    // Deux exports plausibles et un piège : une constante qui « ressemble » à
    // une table par son nom, et une vraie table au nom qui n'y ressemble pas.
    await put(
      path.join(ENTITIES, "Post.ts"),
      `import { sqliteTable, text } from "drizzle-orm/sqlite-core";
export const postTable = sqliteTable("post", { id: text("id").primaryKey() });
export const commentTable = "je ne suis qu'une chaîne";
export const quelqueChose = sqliteTable("tag", { id: text("id").primaryKey() });
`,
    );
    const { tables, unreadable } = await collectTables(
      await entityFilesOf(APP),
    );
    assert.deepEqual(unreadable, []);
    assert.deepEqual(
      tables.map((t) => t.tableName).sort(),
      ["post", "tag"],
      "la chaîne nommée `commentTable` n'est pas une table ; `quelqueChose` en est une",
    );
  });

  it("dit pour QUEL moteur chaque table est écrite", async () => {
    // Une entité d'application est du Drizzle natif : une table écrite pour un
    // autre moteur est IGNORÉE par l'outil, sans un mot. Sans ce relevé, la
    // commande annonce un nombre de tables supérieur à ce qu'elle a écrit —
    // constaté sur une application témoin : six annoncées, quatre écrites.
    await put(
      path.join(ENTITIES, "Melange.ts"),
      `import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
export const ici = sqliteTable("ici", { id: text("id").primaryKey() });
export const la = pgTable("la", { id: pgText("id").primaryKey() });
export const ailleurs = mysqlTable("ailleurs", {
  id: varchar("id", { length: 64 }).primaryKey(),
});
`,
    );
    const { tables } = await collectTables(await entityFilesOf(APP));
    assert.deepEqual(
      Object.fromEntries(tables.map((t) => [t.tableName, t.dialect])),
      { ici: "sqlite", la: "postgres", ailleurs: "mysql" },
    );
  });

  it("lit un fichier qui importe un VOISIN sans extension", async () => {
    // C'est ce que tout le monde écrit en TypeScript, et ce que Node refuse en
    // ESM. Sans la résolution posée par la découverte, un utilisateur qui
    // factorise ses colonnes rend ses entités invisibles à la génération.
    await put(
      path.join(ENTITIES, "colonnes.ts"),
      `import { text } from "drizzle-orm/sqlite-core";
export const id = () => text("id").primaryKey();
`,
    );
    await put(
      path.join(ENTITIES, "Post.ts"),
      `import { sqliteTable } from "drizzle-orm/sqlite-core";
import { id } from "./colonnes";
export const postTable = sqliteTable("post", { id: id() });
`,
    );
    const { tables, unreadable } = await collectTables(
      await entityFilesOf(APP),
    );
    assert.deepEqual(
      unreadable.map((u) => u.cause),
      [],
      "un import de voisin sans extension doit se résoudre comme chez un bundler",
    );
    assert.ok(tables.some((t) => t.tableName === "post"));
  });

  it("rend le fichier qu'il n'a PAS su lire, avec sa cause", async () => {
    await put(path.join(ENTITIES, "Casse.ts"), "export const = ;\n");
    const { tables, unreadable } = await collectTables(
      await entityFilesOf(APP),
    );
    assert.deepEqual(tables, []);
    assert.equal(unreadable.length, 1);
    assert.match(unreadable[0]?.file ?? "", /Casse\.ts$/);
    assert.ok(
      (unreadable[0]?.cause ?? "").length > 0,
      "un fichier illisible sans cause ne s'instruit pas",
    );
  });

  it("le module temporaire ré-exporte À PLAT, sous des alias qui ne collident pas", async () => {
    const a = path.join(ENTITIES, "A.ts");
    const b = path.join(ENTITIES, "B.ts");
    const schema = path.join(APP, "work", "schema.ts");
    const body = await writeSchemaModule(schema, [
      { file: a, exportName: "table", tableName: "alpha", dialect: "sqlite" },
      { file: b, exportName: "table", tableName: "beta", dialect: "sqlite" },
    ]);
    // Deux fichiers exportent `table` : en étoile, ESM rendrait le nom AMBIGU,
    // et un ré-export ambigu n'est pas une erreur — c'est une absence.
    const alias = [...body.matchAll(/ as (\w+) \}/g)].map((m) => m[1]);
    assert.equal(
      new Set(alias).size,
      2,
      "deux alias distincts, jamais un seul",
    );
    assert.ok(
      alias.every((a2) => (a2 as string).startsWith("nf_")),
      "les alias sont neutres : le nom de la table vit dans son appel, pas ici",
    );
    assert.ok(
      !/export \*/.test(body),
      "jamais d'étoile : c'est elle qui fabrique l'ambiguïté",
    );
  });

  it("un spécificateur d'import VOYAGE — il s'écrit en « / »", () => {
    const spec = importSpecifier(
      path.join(APP, "work", "schema.ts"),
      path.join(ENTITIES, "Post.ts"),
    );
    assert.ok(!spec.includes("\\"), "aucun séparateur natif dans un import");
    assert.ok(spec.startsWith("."), "toujours relatif et explicite");
    assert.ok(spec.endsWith("Post.ts"));
  });

  it("la configuration écrit des chemins RELATIFS, et exclut ce qui n'appartient pas à l'app", async () => {
    const body = await writeKitConfig({
      file: path.join(APP, "work", "drizzle.config.ts"),
      projectRoot: APP,
      schemaFile: path.join(APP, "work", "schema.ts"),
      outDir: OUT,
      dialect: "sqlite",
      excludedTables: ["User", "nodefony_migrations"],
    });
    // Un dossier de sortie ABSOLU est préfixé `./` par l'outil, qui lit alors
    // `.//Users/…` — et rend 0 quand même.
    assert.ok(
      !/"\/|:\\\\/.test(body),
      `chemin absolu dans la config :\n${body}`,
    );
    assert.match(body, /out: "\.\/migrations\/sqlite"/);
    assert.match(body, /dialect: "sqlite"/);
    assert.match(body, /tablesFilter: \["\*","!User","!nodefony_migrations"\]/);
  });

  it("PostgreSQL s'appelle « postgresql » chez l'outil — et nulle part ailleurs", async () => {
    const body = await writeKitConfig({
      file: path.join(APP, "work", "pg.config.ts"),
      projectRoot: APP,
      schemaFile: path.join(APP, "work", "schema.ts"),
      outDir: path.join(APP, "migrations", "postgres"),
      dialect: "postgres",
      excludedTables: [],
    });
    assert.match(body, /dialect: "postgresql"/);
    assert.match(body, /out: "\.\/migrations\/postgres"/);
  });

  describe("le REGISTRE valide — ce qu'aucun outil de génération ne peut voir", () => {
    const framework = new Set(["User", "session"]);

    it("nomme l'entité que plus aucun fichier ne fournit", () => {
      // Le cas vécu : un fichier d'entité déplacé, renommé, ou devenu illisible.
      // L'entité reste enregistrée — c'est le code du module qui la déclare —
      // mais la génération, qui lit des FICHIERS, ne la voit plus.
      const orphans = missingProviders(
        [
          { entity: "Post", table: "post" },
          { entity: "Comment", table: "comment" },
        ],
        new Set(["post"]),
        framework,
      );
      assert.deepEqual(orphans, [{ entity: "Comment", table: "comment" }]);
    });

    it("ne réclame RIEN quand tout est fourni", () => {
      assert.deepEqual(
        missingProviders(
          [{ entity: "Post", table: "post" }],
          new Set(["post"]),
          framework,
        ),
        [],
      );
    });

    it("ne réclame pas les tables du FRAMEWORK — une autre source les fournit", () => {
      // `User` est enregistrée sur ce connecteur et aucun fichier de
      // l'application ne l'exporte : c'est le cas NORMAL, ses migrations
      // viennent du framework et s'appliquent avant.
      assert.deepEqual(
        missingProviders(
          [{ entity: "User", table: "User" }],
          new Set(),
          framework,
        ),
        [],
      );
    });

    it("désigne le fichier qui usurpe une table du framework", () => {
      const conflit = usurpedTables(
        [
          {
            file: "/app/nodefony/entity/Post.ts",
            exportName: "postTable",
            tableName: "post",
            dialect: "sqlite",
          },
          {
            file: "/app/nodefony/entity/Moi.ts",
            exportName: "userTable",
            tableName: "User",
            dialect: "sqlite",
          },
        ],
        framework,
      );
      assert.deepEqual(
        conflit.map((t) => `${t.exportName}:${t.tableName}`),
        ["userTable:User"],
        "un refus qui ne dit pas QUEL export est en cause ne se corrige pas",
      );
    });
  });

  describe("migration LIBRE (--custom)", () => {
    it("écrit un fichier VIDE et son entrée de journal", async () => {
      const { tag, file } = await writeCustomMigration({
        outDir: OUT,
        dialect: "sqlite",
        name: "vue_des_ventes",
        now: 1_700_000_000_000,
      });
      assert.equal(tag, "0000_vue_des_ventes");
      const sql = await fs.readFile(file, "utf8");
      assert.ok(
        sql.startsWith("-- nodefony:migration format=1"),
        "le marqueur de format ouvre le fichier",
      );
      assert.ok(
        !/CREATE|ALTER|DROP|INSERT/i.test(sql),
        "un squelette qui PROPOSE du SQL est un squelette qu'on applique sans le lire",
      );
      const journal = JSON.parse(
        await fs.readFile(path.join(OUT, "meta", "_journal.json"), "utf8"),
      ) as { version: string; dialect: string; entries: { tag: string }[] };
      assert.equal(journal.version, "7");
      assert.equal(journal.dialect, "sqlite");
      assert.deepEqual(
        journal.entries.map((e) => e.tag),
        ["0000_vue_des_ventes"],
      );
    });

    it("se range APRÈS ce qui existe, sans toucher à l'historique", async () => {
      await writeCustomMigration({
        outDir: OUT,
        dialect: "sqlite",
        name: "une",
        now: 1,
      });
      const { tag } = await writeCustomMigration({
        outDir: OUT,
        dialect: "sqlite",
        name: "deux",
        now: 2,
      });
      assert.equal(tag, "0001_deux");
      const journal = JSON.parse(
        await fs.readFile(path.join(OUT, "meta", "_journal.json"), "utf8"),
      ) as { entries: { idx: number; tag: string }[] };
      assert.deepEqual(
        journal.entries.map((e) => `${e.idx}:${e.tag}`),
        ["0:0000_une", "1:0001_deux"],
      );
    });

    it("REFUSE d'écraser un journal illisible", async () => {
      await put(path.join(OUT, "meta", "_journal.json"), "{ ceci n'est pas");
      await assert.rejects(
        () =>
          writeCustomMigration({
            outDir: OUT,
            dialect: "sqlite",
            name: "essai",
          }),
        // En repartir d'un neuf ferait rejouer toutes les migrations sur une
        // base qui les a déjà reçues.
        /illisible/,
      );
    });
  });

  describe("la PREUVE que l'outil a travaillé — il rend 0 même en échec", () => {
    // La sortie EXACTE d'une forge, qui pose FORCE_COLOR : la coche est
    // entourée de séquences de style, et « [✓] » n'est plus une sous-chaîne.
    const AVEC_COULEUR =
      "\u001B[1m1 tables\u001B[22m\n" +
      "[\u001B[32m✓\u001B[31m] Your SQL migration file \u2794 " +
      "\u001B[1m\u001B[34mmigrations/sqlite/0000_premier.sql\u001B[39m\n";

    it("reconnaît la coche même COLORÉE", () => {
      assert.equal(generationHappened(AVEC_COULEUR), true);
    });

    it("reconnaît la coche nue, et « rien à faire »", () => {
      assert.equal(
        generationHappened("[✓] Your SQL migration file \u2794 x.sql"),
        true,
      );
      assert.equal(
        generationHappened("No schema changes, nothing to do"),
        true,
      );
    });

    it("REFUSE une sortie qui ne prouve rien — le silence n'est pas un succès", () => {
      assert.equal(generationHappened(""), false);
      assert.equal(generationHappened("Reading config file 'x.ts'\n"), false);
    });
  });

  describe("bout en bout — l'outil tourne pour de vrai", () => {
    it("produit la table de l'application, et AUCUNE de celles qu'on exclut", async () => {
      await put(
        path.join(ENTITIES, "Post.ts"),
        `import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { userTable } from "./Emprunt";
export const postTable = sqliteTable("post", {
  id: text("id").primaryKey(),
  // Une référence VERS une table du framework : c'est le cas qui fabrique un
  // second CREATE de cette table si rien ne l'exclut.
  author: text("author").references(() => userTable.id),
});
`,
      );
      await put(
        path.join(ENTITIES, "Emprunt.ts"),
        `import { sqliteTable, text } from "drizzle-orm/sqlite-core";
export const userTable = sqliteTable("User", { id: text("id").primaryKey() });
`,
      );
      const { tables } = await collectTables([path.join(ENTITIES, "Post.ts")]);
      const schemaFile = path.join(APP, "work", "schema.ts");
      const configFile = path.join(APP, "work", "drizzle.config.ts");
      await writeSchemaModule(schemaFile, tables);
      await writeKitConfig({
        file: configFile,
        projectRoot: APP,
        schemaFile,
        outDir: OUT,
        dialect: "sqlite",
        excludedTables: ["User", "nodefony_migrations"],
      });
      runGenerate({
        cwd: APP,
        configRel: path.relative(APP, configFile).split(path.sep).join("/"),
        name: "premier",
        label: "le banc",
      });
      stampFormatMarker(OUT);

      const journal = JSON.parse(
        await fs.readFile(path.join(OUT, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      assert.deepEqual(
        journal.entries.map((e) => e.tag),
        ["0000_premier"],
        "la PREUVE est le journal, jamais un message de l'outil : il rend 0 même en échec",
      );
      const sql = await fs.readFile(path.join(OUT, "0000_premier.sql"), "utf8");
      assert.ok(sql.startsWith("-- nodefony:migration format=1"));
      assert.match(sql, /CREATE TABLE `post`/);
      assert.doesNotMatch(
        sql,
        /CREATE TABLE `User`/,
        "la table du framework est exclue : un second CREATE échoue sur toute base DÉJÀ migrée — donc en production, et nulle part ailleurs",
      );
    });
  });
});

describe("ce que la découverte a vu — le bloc posé sous un refus", () => {
  const nu = styleFor(false);

  it("nomme les fichiers non lus, et dit où chercher la cause", () => {
    const texte = describeDiscovery(
      {
        filesScanned: 4,
        tables: ["post"],
        otherDialect: [
          {
            table: "article",
            dialect: "postgres",
            file: "nodefony/entity/a.ts",
          },
        ],
        unreadable: [
          {
            file: "nodefony/entity/b.ts",
            cause: "Cannot read properties of null",
          },
        ],
      },
      nu,
    );
    assert.match(texte, /4 fichier\(s\) d'entités examiné\(s\)/);
    assert.match(texte, /1 table\(s\) de l'application retenue\(s\) : post/);
    assert.match(
      texte,
      /article \(postgres\)/,
      "l'écartée doit être NOMMÉE avec son moteur",
    );
    assert.match(texte, /nodefony\/entity\/b\.ts — Cannot read/);
    // 🔴 La phrase qui évite la mauvaise correction : sans elle, le lecteur
    // conclut que la base est fautive et la détruit.
    assert.match(
      texte,
      /se présente à l'outil de diff comme une table SUPPRIMÉE/,
    );
    assert.match(texte, /la base n'y est pour rien/);
  });

  it("se tait sur l'avertissement quand la découverte est COMPLÈTE", () => {
    const texte = describeDiscovery(
      {
        filesScanned: 3,
        tables: ["post", "tag"],
        otherDialect: [],
        unreadable: [],
      },
      nu,
    );
    assert.match(texte, /2 table\(s\) de l'application retenue\(s\)/);
    // Un avertissement permanent ne se lit plus : il n'est dû que si quelque
    // chose manque à l'appel.
    assert.doesNotMatch(texte, /SUPPRIMÉE/);
  });

  it("avertit quand AUCUNE table n'a été retenue, même sans fichier illisible", () => {
    const texte = describeDiscovery(
      { filesScanned: 2, tables: [], otherDialect: [], unreadable: [] },
      nu,
    );
    assert.match(texte, /0 table\(s\)/);
    assert.match(
      texte,
      /SUPPRIMÉE/,
      "zéro table déclarée rend TOUTE migration destructive",
    );
  });
});
