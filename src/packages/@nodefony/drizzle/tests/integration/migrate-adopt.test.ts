import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlDialect } from "../../nodefony/config/config";
import {
  adoptFromDatabase,
  tablesPresentIn,
  uncommentIntrospection,
} from "../../nodefony/src/migrator/adopt";
import type { ISchemaReader } from "../../nodefony/src/migrator/catalog";
import {
  collectTables,
  writeKitConfig,
  writeSchemaModule,
} from "../../nodefony/src/migrator/appSchema";
import {
  openMigrationDriver,
  type IMigrationTarget,
} from "../../nodefony/src/migrator/drivers/index";
import { splitStatements } from "../../nodefony/src/migrator/sources";
import {
  runGenerate,
  stampFormatMarker,
} from "../../nodefony/src/migrator/kit";

/**
 * Adopter une base qui EXISTAIT avant les migrations.
 *
 * Le décor est celui d'une application passée du mode dérivé — où le démarrage
 * fabrique le schéma — au mode de production, où il ne le fabrique plus : la
 * base porte ses tables ET ses données, et le dossier des migrations est vide.
 * C'est le seul état dans lequel le générateur, qui ne lit que le journal des
 * FICHIERS, émettait le schéma initial d'une table déjà là — un `CREATE TABLE`
 * inapplicable, qui referme la dernière porte une fois adopté.
 *
 * 🔴 **Joué sur les TROIS moteurs.** L'introspection n'est pas la même chose
 * d'un serveur à l'autre : les types, la casse des identifiants et la façon de
 * nommer une clé primaire diffèrent. Un vert obtenu sur SQLite seul ne dirait
 * rien des deux autres — et c'est exactement là que se cachaient les défauts de
 * la génération multi-dialecte.
 *
 * L'application est posée SOUS le dépôt : la remontée qui résout `drizzle-kit`
 * doit trouver ses `node_modules`, et un dossier temporaire du système en est
 * trop loin.
 */
const MODULE_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
);
const REPO_ROOT = path.resolve(MODULE_ROOT, "..", "..", "..", "..");

/**
 * Un nom propre à ce banc.
 *
 * Les bases de serveur sont PARTAGÉES entre les bancs du module : une table
 * `articles` y entrerait en collision avec un voisin qui tourne en parallèle,
 * et l'échec serait attribué au mauvais code.
 */
const TABLE = "adopt_articles";

/** La ligne qu'aucune adoption n'a le droit de perdre. */
/**
 * Table à colonne JSON, posée UNIQUEMENT sur MariaDB.
 *
 * MariaDB n'a pas de type JSON natif : il l'écrit en « longtext »
 * assorti d'une contrainte « CHECK (json_valid(…)) », que l'outil de lecture
 * de schéma ne sait pas lire — c'est CE défaut que le refus doit nommer.
 *
 * 🔴 Elle existe parce que le décor était HÉRITÉ. Le refus ne se produit que
 * si la base porte une telle contrainte quelque part (l'outil lit la base
 * ENTIÈRE avant de filtrer). Sur une base qui traîne, les tables du framework
 * en portent et le cas passait ; sur un conteneur frais — l'intégration
 * continue — la base est vierge, la lecture RÉUSSIT, et l'attente de rejet
 * tombait. Un test qui dépend de ce qu'une autre suite a laissé derrière elle
 * est vert ou rouge selon l'ordre d'exécution : la condition se POSE.
 */
const TABLE_JSON = "adopt_json_temoin";

/**
 * Table à index COMPOSITE de types mixtes, posée uniquement sur PostgreSQL.
 *
 * 🔴 L'introspection rend UNE classe d'opérateur pour tout l'index et
 * l'applique à chaque colonne. Sur `(uuid, timestamptz)` la référence sort
 * donc avec `("author" timestamptz_ops, "created_at" timestamptz_ops)`, que
 * PostgreSQL refuse — mais seulement au REJEU : la base adoptée a déjà son
 * index, et rien ne se voit tant qu'on ne monte pas un exemplaire neuf.
 *
 * Les deux colonnes doivent avoir des types DIFFÉRENTS : c'est la condition
 * du défaut. Un index composite homogène survit à la recopie, ce qui est
 * précisément ce qui l'a rendu invisible si longtemps.
 */
const TABLE_INDEX = "adopt_index_composite";

const TEMOIN = "article-temoin-a-ne-pas-perdre";

/** Un moteur à exercer, et de quoi lui poser le décor. */
interface ICible {
  dialect: SqlDialect;
  /** Suffixe du `describe` — la forme que le rapporteur de gates reconnaît. */
  label: string;
  actif: boolean;
  target: IMigrationTarget;
  /** La table telle qu'elle EXISTE déjà, dans la grammaire du moteur. */
  ddl: string;
  /** L'entité, avec ou sans le champ que l'agent ajoute. */
  entite(extra: string): string;
}

const APP = (dialect: SqlDialect): string =>
  path.join(REPO_ROOT, "tmp", `orm-adopt-${dialect}`);

const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

const CIBLES: ICible[] = [
  {
    dialect: "sqlite",
    label: "(sqlite)",
    actif: true,
    target: {
      dialect: "sqlite",
      filename: path.join(APP("sqlite"), "app.db"),
    },
    ddl:
      `CREATE TABLE \`${TABLE}\` (\`id\` text PRIMARY KEY NOT NULL, ` +
      `\`title\` text NOT NULL, \`code\` text NOT NULL UNIQUE)`,
    entite: (extra) =>
      `import { sqliteTable, text } from "drizzle-orm/sqlite-core";
export const articleTable = sqliteTable("${TABLE}", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  code: text("code").notNull().unique(),${extra}
});
`,
  },
  {
    dialect: "postgres",
    label: "(postgres)",
    actif: PG_URL !== undefined,
    target: { dialect: "postgres", url: PG_URL },
    ddl:
      `CREATE TABLE "${TABLE}" ("id" text PRIMARY KEY NOT NULL, ` +
      `"title" text NOT NULL, "code" text NOT NULL UNIQUE)`,
    entite: (extra) =>
      `import { pgTable, text } from "drizzle-orm/pg-core";
export const articleTable = pgTable("${TABLE}", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  code: text("code").notNull().unique(),${extra}
});
`,
  },
  {
    dialect: "mysql",
    label: "(mysql)",
    actif: MYSQL_URL !== undefined,
    target: { dialect: "mysql", url: MYSQL_URL },
    // MySQL refuse une clé primaire sur un `text` sans longueur : le décor est
    // celui que le moteur PERMET, pas la transposition littérale de l'autre.
    // Le `code` est un `varchar` : MySQL refuse l'unicité sur un `text` sans
    // longueur de préfixe — le décor est celui que le moteur PERMET.
    ddl:
      `CREATE TABLE \`${TABLE}\` (\`id\` varchar(36) NOT NULL, ` +
      `\`title\` text NOT NULL, \`code\` varchar(64) NOT NULL UNIQUE, ` +
      `PRIMARY KEY (\`id\`))`,
    entite: (extra) =>
      `import { mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
export const articleTable = mysqlTable("${TABLE}", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: text("title").notNull(),
  code: varchar("code", { length: 64 }).notNull().unique(),${extra}
});
`,
  },
];

async function put(file: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
}

describe("tablesPresentIn — la décision qui empêche un CREATE inapplicable", () => {
  /**
   * Un lecteur de catalogue qui ne connaît que les tables qu'on lui donne.
   *
   * Le lecteur est INJECTÉ, et c'est tout l'intérêt : la règle qui empêche
   * d'écrire un schéma initial inapplicable s'éprouve sans kernel, sans
   * serveur et sans variable d'environnement — et une règle qu'on ne peut pas
   * voir rouge n'est pas une règle.
   */
  const baseAvec = (tables: readonly string[]): ISchemaReader => ({
    sameColumnName: (a, b) => a === b,
    tableExists: (t) => Promise.resolve(tables.includes(t)),
    columnsOf: () => Promise.resolve([]),
  });

  it("rend les tables que la base porte, et ne conclut que sur ce qu'elle a vu", async () => {
    assert.deepEqual(
      await tablesPresentIn(baseAvec(["a", "c"]), ["a", "b", "c"]),
      ["a", "c"],
      "la BASE est interrogée : ce qu'elle porte est présent, le reste ne l'est pas",
    );
    assert.deepEqual(
      await tablesPresentIn(baseAvec([]), ["a", "b"]),
      [],
      "une base vierge : le schéma initial y est LÉGITIME",
    );
  });

  it("🔴 rien n'est déclaré présent sur la foi d'une comparaison au CODE", async () => {
    // Le défaut vécu, réduit à sa forme pure. La version précédente déduisait
    // la présence de l'absence dans une comparaison au registre — or la
    // génération part des FICHIERS, qui portent d'autres tables : celles d'un
    // module désactivé, d'un connecteur différent, ou d'un module pas encore
    // câblé. Résultat mesuré sur une base fraîchement migrée : `orm:generate`
    // refusait la première migration en nommant SEPT tables qui n'existaient
    // nulle part, et renvoyait vers une adoption qui échouait pour la raison
    // inverse. Deux commandes se prescrivant l'une l'autre en se refusant.
    assert.deepEqual(
      await tablesPresentIn(baseAvec([]), ["Calendar", "Event", "Room"]),
      [],
      "des tables absentes de la base ne peuvent JAMAIS être annoncées présentes",
    );
  });
});

describe("uncommentIntrospection — rendre exécutable ce que l'outil commente", () => {
  it("décommente le corps, et refuse de deviner une autre forme", () => {
    const brut = `-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE \`articles\` (
\t\`id\` text PRIMARY KEY NOT NULL
);

*/`;
    assert.equal(
      uncommentIntrospection(brut),
      "CREATE TABLE `articles` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n",
      "une baseline commentée ne recrée RIEN : une base neuve montée depuis ces fichiers sortirait vide",
    );
    assert.equal(
      uncommentIntrospection("ALTER TABLE `articles` ADD `slug` text;\n"),
      null,
      "sans bloc commenté, ne rien toucher — et le DIRE, plutôt que rendre un fichier tronqué",
    );
  });
});

for (const cible of CIBLES) {
  const app = APP(cible.dialect);
  const entities = path.join(app, "nodefony", "entity");
  const out = path.join(app, "migrations", cible.dialect);

  /** Joue du DDL sur la base du décor. */
  const sql = async (statements: string[]): Promise<void> => {
    const pilote = await openMigrationDriver(cible.target);
    try {
      for (const s of statements) {
        await pilote.exec(s);
      }
    } finally {
      await pilote.close();
    }
  };

  /** Les titres présents en base — la preuve que rien n'a été perdu. */
  const titres = async (): Promise<string[]> => {
    const pilote = await openMigrationDriver(cible.target);
    try {
      const lignes = await pilote.query<{ title: string }>(
        `SELECT title FROM ${cible.dialect === "postgres" ? `"${TABLE}"` : `\`${TABLE}\``}`,
      );
      return lignes.map((l) => l.title);
    } finally {
      await pilote.close();
    }
  };

  const suite = cible.actif ? describe : describe.skip;

  suite(`Adopter une base déjà en place ${cible.label}`, () => {
    /**
     * MariaDB écrit le type JSON en `longtext` + `CHECK (json_valid(…))`, et
     * l'outil de lecture de schéma meurt sur ces contraintes — sans un mot, et
     * même quand les tables concernées ne sont pas celles qu'on adopte, car il
     * lit la base ENTIÈRE avant de filtrer. Les tables du framework en portent.
     *
     * Constaté sur le serveur, jamais déduit du port : les deux serveurs MySQL
     * du dépôt partagent la même variable et se jouent en deux passes.
     */
    let mariadb = false;

    beforeAll(async () => {
      // Seul MySQL pose la question : SQLite n'a pas de contrainte CHECK à
      // lire, et PostgreSQL porte un type JSON natif. Interroger une base
      // SQLite qui n'existe pas encore ferait JETER ce hook — et un hook qui
      // jette transforme toute la suite en SKIPS, c'est-à-dire en vert muet.
      if (!cible.actif || cible.dialect !== "mysql") {
        return;
      }
      const pilote = await openMigrationDriver(cible.target);
      try {
        const lignes = await pilote.query<{ v: string }>(
          "SELECT VERSION() AS v",
        );
        mariadb = /mariadb/i.test(lignes[0]?.v ?? "");
      } finally {
        await pilote.close();
      }
    });

    beforeEach(async () => {
      await fs.rm(app, { recursive: true, force: true });
      await fs.mkdir(entities, { recursive: true });
      await sql([
        `DROP TABLE IF EXISTS ${cible.dialect === "postgres" ? `"${TABLE}"` : `\`${TABLE}\``}`,
        cible.ddl,
        `INSERT INTO ${cible.dialect === "postgres" ? `"${TABLE}"` : `\`${TABLE}\``} VALUES ('1', '${TEMOIN}', 'code-1')`,
      ]);
    });

    afterEach(async () => {
      await fs.rm(app, { recursive: true, force: true });
      if (cible.dialect !== "sqlite") {
        await sql([
          `DROP TABLE IF EXISTS ${cible.dialect === "postgres" ? `"${TABLE}"` : `\`${TABLE}\``}`,
        ]);
      }
      // Le témoin JSON ne survit pas au cas qui l'a posé : le laisser ferait
      // buter la lecture de schéma des cas SUIVANTS, qui l'attendent réussie.
      if (cible.dialect === "mysql") {
        await sql([`DROP TABLE IF EXISTS \`${TABLE_JSON}\``]);
      }
    });

    it("écrit la référence depuis la base, sans exécuter une instruction", async () => {
      await put(path.join(entities, "Article.ts"), cible.entite(""));
      if (mariadb) {
        // La condition du refus, POSÉE et non héritée (cf `TABLE_JSON`).
        await sql([
          `DROP TABLE IF EXISTS \`${TABLE_JSON}\``,
          `CREATE TABLE \`${TABLE_JSON}\` ` +
            "(`id` VARCHAR(36) PRIMARY KEY, `data` JSON NOT NULL)",
        ]);
        await assert.rejects(
          adoptFromDatabase({
            projectRoot: app,
            outDir: out,
            dialect: cible.dialect,
            target: cible.target,
            excludedTables: ["nodefony_migrations"],
            declaredTables: [TABLE],
            name: "base_existante",
            workDir: path.join(app, "work"),
          }),
          /MariaDB[\s\S]*json_valid[\s\S]*orm:generate --custom/u,
          "une mort muette enverrait chercher du côté des identifiants : le refus doit NOMMER la cause et le repli",
        );
        return;
      }
      const adopted = await adoptFromDatabase({
        projectRoot: app,
        outDir: out,
        dialect: cible.dialect,
        target: cible.target,
        excludedTables: ["nodefony_migrations"],
        declaredTables: [TABLE],
        name: "base_existante",
        workDir: path.join(app, "work"),
      });

      assert.equal(adopted.tag, "0000_base_existante");
      assert.equal(
        adopted.runnable,
        true,
        "la référence doit rester rejouable sur une base NEUVE",
      );
      const ecrit = await fs.readFile(adopted.file, "utf8");
      assert.match(ecrit, new RegExp(`CREATE TABLE[\\s\\S]*${TABLE}`, "i"));
      assert.doesNotMatch(ecrit, /\/\*/, "un corps commenté ne crée rien");
      assert.doesNotMatch(
        ecrit,
        /slug/,
        "la référence décrit la BASE, pas le code",
      );
      // 🔴 La référence doit RECRÉER les contraintes d'unicité, y compris
      // celles portées par une COLONNE. Elles ne se voient pas sur la base
      // adoptée — elle les a déjà — mais sur la SUIVANTE, celle qu'on recrée
      // depuis ce fichier : un environnement de test, un exemplaire neuf. Une
      // contrainte perdue ne lève rien, elle laisse entrer des doublons que le
      // schéma interdisait.
      assert.match(
        ecrit,
        /\bunique\b/iu,
        "la contrainte d'unicité de la colonne « code » a disparu de la référence",
      );
      assert.deepEqual(
        await titres(),
        [TEMOIN],
        "adopter ne touche pas aux données",
      );
      assert.equal(
        await fs
          .access(path.join(out, "schema.ts"))
          .then(() => true)
          .catch(() => false),
        false,
        "les modules TypeScript déposés par l'outil décrivent un schéma que personne ne maintiendrait",
      );

      // 🔴 « Rejouable » s'EXÉCUTE, il ne se déclare pas. L'assertion
      // précédente lisait `runnable`, que le code sous test met lui-même à
      // vrai : un décommentage qui avalerait la parenthèse fermante passait
      // les deux expressions régulières, et le premier environnement neuf
      // monté depuis ces fichiers serait mort sur une erreur de syntaxe.
      // On repart donc d'une base SANS la table, et on joue la référence.
      await sql([
        `DROP TABLE ${cible.dialect === "postgres" ? `"${TABLE}"` : `\`${TABLE}\``}`,
      ]);
      const pilote = await openMigrationDriver(cible.target);
      try {
        // Bornée à NOTRE table : ce décor appelle la brique directement, sans
        // la liste d'exclusion que la commande, elle, compose — la référence
        // décrit donc aussi les tables du framework, qui existent déjà sur les
        // serveurs partagés. Ce qu'on éprouve ici est que le fragment décrivant
        // la table adoptée s'EXÉCUTE, ce qu'aucune expression régulière ne dit.
        const instructions = splitStatements(ecrit, cible.dialect).filter((i) =>
          i.includes(TABLE),
        );
        assert.ok(
          instructions.length > 0,
          "la référence ne porte aucune instruction sur la table adoptée",
        );
        for (const statement of instructions) {
          await pilote.exec(statement);
        }
        // La table existe de nouveau — constatée EN BASE, pas déduite.
        assert.deepEqual(
          await pilote.query(
            `SELECT title FROM ${cible.dialect === "postgres" ? `"${TABLE}"` : `\`${TABLE}\``}`,
          ),
          [],
          "la référence rejouée doit rendre une table VIDE, et non échouer",
        );
      } finally {
        await pilote.close();
      }
    });

    it("🔴 un index COMPOSITE de types mixtes reste rejouable", async (ctx) => {
      // La classe d'opérateur est un objet PostgreSQL : les autres moteurs
      // n'ont rien à prouver ici. `ctx.skip()`, jamais un `return` — un cas
      // qui se retourne compte PASSÉ, et le rapporteur y verrait la preuve
      // que le dialecte a été exercé.
      if (cible.dialect !== "postgres") {
        ctx.skip();
        return;
      }
      await put(path.join(entities, "Article.ts"), cible.entite(""));
      await sql([
        `DROP TABLE IF EXISTS "${TABLE_INDEX}"`,
        `CREATE TABLE "${TABLE_INDEX}" ("id" uuid PRIMARY KEY NOT NULL, ` +
          `"author" uuid, "created_at" timestamp with time zone)`,
        `CREATE INDEX "${TABLE_INDEX}_author_created_at_idx" ` +
          `ON "${TABLE_INDEX}" USING btree ("author","created_at")`,
      ]);
      try {
        const adopted = await adoptFromDatabase({
          projectRoot: app,
          outDir: out,
          dialect: cible.dialect,
          target: cible.target,
          excludedTables: ["nodefony_migrations"],
          declaredTables: [TABLE, TABLE_INDEX],
          name: "base_existante",
          workDir: path.join(app, "work"),
        });
        const ecrit = await fs.readFile(adopted.file, "utf8");

        // 🔴 Le REJEU est l'assertion, pas la forme du texte. Une expression
        // régulière sur `_ops` dirait seulement que la chaîne a changé ; seul
        // PostgreSQL sait si l'index qu'on lui donne est acceptable.
        await sql([`DROP TABLE "${TABLE_INDEX}"`]);
        const pilote = await openMigrationDriver(cible.target);
        try {
          const instructions = splitStatements(ecrit, cible.dialect).filter(
            (i) => i.includes(TABLE_INDEX),
          );
          assert.ok(
            instructions.length >= 2,
            "la référence doit porter la table ET son index",
          );
          for (const statement of instructions) {
            await pilote.exec(statement);
          }
          // L'index existe, et c'est le CATALOGUE qui le dit : un `CREATE`
          // silencieusement ignoré passerait l'exécution sans rien poser.
          assert.equal(
            (
              await pilote.query(
                `SELECT indexname FROM pg_indexes WHERE tablename = ? ` +
                  `AND indexname = ?`,
                [TABLE_INDEX, `${TABLE_INDEX}_author_created_at_idx`],
              )
            ).length,
            1,
            "l'index composite doit être recréé par la référence",
          );
        } finally {
          await pilote.close();
        }
      } finally {
        await sql([`DROP TABLE IF EXISTS "${TABLE_INDEX}"`]);
      }
    });

    it("après adoption, le champ ajouté produit un ALTER — plus un CREATE", async () => {
      if (mariadb) {
        // Sans référence lisible, il n'y a rien à enchaîner : le cas est déjà
        // jugé par le refus nommé, ci-dessus.
        return;
      }
      await put(path.join(entities, "Article.ts"), cible.entite(""));
      await adoptFromDatabase({
        projectRoot: app,
        outDir: out,
        dialect: cible.dialect,
        target: cible.target,
        excludedTables: ["nodefony_migrations"],
        declaredTables: [TABLE],
        name: "base_existante",
        workDir: path.join(app, "work"),
      });

      await put(
        path.join(entities, "Article.ts"),
        cible.entite('\n  slug: text("slug"),'),
      );
      const { tables } = await collectTables([
        path.join(entities, "Article.ts"),
      ]);
      const schemaFile = path.join(app, "work", `schema.${cible.dialect}.ts`);
      const configFile = path.join(
        app,
        "work",
        `drizzle.${cible.dialect}.config.ts`,
      );
      await writeSchemaModule(schemaFile, tables);
      await writeKitConfig({
        file: configFile,
        projectRoot: app,
        schemaFile,
        outDir: out,
        dialect: cible.dialect,
        excludedTables: ["nodefony_migrations"],
      });
      runGenerate({
        cwd: app,
        configRel: path.relative(app, configFile).split(path.sep).join("/"),
        name: "add_article_slug",
        label: `le banc d'adoption ${cible.label}`,
      });
      stampFormatMarker(out);

      const suivant = await fs.readFile(
        path.join(out, "0001_add_article_slug.sql"),
        "utf8",
      );
      assert.match(
        suivant,
        /ALTER TABLE[\s\S]*slug/i,
        "après adoption, le diff part de la BASE : le champ ajouté est un ALTER",
      );
      assert.doesNotMatch(
        suivant,
        /CREATE TABLE/i,
        "c'est le trou de #118 : sans instantané de la base, le générateur repart de rien",
      );
    });
  });
}
