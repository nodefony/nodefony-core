import assert from "node:assert/strict";
import {
  applyRenames,
  describeRenames,
  missingRenameTargets,
  parseRenames,
  prependStatements,
  type IRenamePlan,
} from "../../nodefony/src/migrator/renames";
import { columnsByTable } from "../../nodefony/src/migrator/snapshotColumns";

/**
 * `--rename` : la réponse « renamed » donnée d'avance, sans terminal.
 *
 * Ce banc garde la partie PURE — lecture des déclarations, réécriture de
 * l'instantané, forme des instructions. La chaîne complète (l'outil lit
 * l'instantané réécrit, la base garde ses lignes) est prouvée sur les trois
 * moteurs par `erp-lite-evolution-*.test.ts`.
 */

function plan(...specs: string[]): IRenamePlan {
  const parsed = parseRenames(specs);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.plan;
}

/** Un instantané minimal, à la forme qu'écrit l'outil pour chaque moteur. */
function snapshot(dialect: "sqlite" | "postgres" | "mysql") {
  const key = (t: string) => (dialect === "postgres" ? `public.${t}` : t);
  const schema = dialect === "postgres" ? { schema: "" } : {};
  const indexColumn = (c: string) =>
    dialect === "postgres"
      ? { expression: c, isExpression: false, asc: true, nulls: "last" }
      : c;
  return {
    id: "prev-id",
    prevId: "00000000-0000-0000-0000-000000000000",
    tables: {
      [key("article")]: {
        name: "article",
        ...schema,
        columns: {
          id: { name: "id", type: "integer", primaryKey: true },
          titre: { name: "titre", type: "text" },
          auteur_id: { name: "auteur_id", type: "integer" },
          corps: { name: "corps", type: "text" },
        },
        indexes: {
          article_titre_idx: {
            name: "article_titre_idx",
            columns: [indexColumn("titre")],
          },
        },
        foreignKeys: {
          article_auteur_fk: {
            name: "article_auteur_fk",
            tableFrom: "article",
            tableTo: "auteur",
            columnsFrom: ["auteur_id"],
            columnsTo: ["ident"],
          },
        },
        compositePrimaryKeys: {},
        uniqueConstraints: {
          article_titre_unique: {
            name: "article_titre_unique",
            columns: ["titre"],
          },
        },
      },
      [key("auteur")]: {
        name: "auteur",
        ...schema,
        columns: {
          ident: { name: "ident", type: "integer", primaryKey: true },
        },
        indexes: {},
        foreignKeys: {},
        compositePrimaryKeys: {},
        uniqueConstraints: {},
      },
    },
    _meta: { schemas: {}, tables: {}, columns: {} },
  };
}

describe("--rename : lecture des déclarations", () => {
  it("distingue la table (« a=b ») de la colonne (« t.a=b »)", () => {
    assert.deepEqual(plan("brouillon=draft", "article.titre=title"), {
      tables: [{ from: "brouillon", to: "draft" }],
      columns: [{ table: "article", from: "titre", to: "title" }],
    });
  });

  it.each([
    ["titre", "pas de « = »"],
    ["=title", "ancien nom vide"],
    ["article.titre=", "nouveau nom vide"],
    ["a.b.c=d", "trois segments"],
    ["article.titre=other.title", "table à droite"],
    ["article.titre=ti tle", "espace"],
    ["article.titre=titre", "identique"],
  ])("refuse « %s » (%s)", (spec) => {
    const parsed = parseRenames([spec]);
    assert.equal(parsed.ok, false);
  });

  it("refuse une colonne renommée deux fois, et une chaîne de tables", () => {
    assert.equal(parseRenames(["t.a=b", "t.a=c"]).ok, false);
    assert.equal(parseRenames(["t.a=c", "t.b=c"]).ok, false);
    const chain = parseRenames(["a=b", "b=c"]);
    assert.equal(chain.ok, false);
    assert.match(chain.ok ? "" : chain.reason, /deux migrations/u);
  });

  it("cite les renommages dans l'ordre où ils sont joués", () => {
    assert.deepEqual(
      describeRenames(plan("article.titre=title", "brouillon=draft")),
      ["brouillon → draft", "article.titre → title"],
    );
  });
});

describe.each(["sqlite", "postgres", "mysql"] as const)(
  "--rename : instantané réécrit (%s)",
  (dialect) => {
    it("renomme la colonne PARTOUT où l'instantané la cite, sans toucher aux noms de contraintes", () => {
      const source = snapshot(dialect);
      const before = JSON.stringify(source);
      const out = applyRenames(source, plan("article.titre=title"), dialect);
      assert.deepEqual(out.problems, []);
      assert.equal(JSON.stringify(source), before, "l'original est intact");
      const article = Object.values(
        out.doc.tables as Record<string, Record<string, unknown>>,
      ).find((t) => t.name === "article");
      assert.ok(article);
      const columns = article.columns as Record<string, { name: string }>;
      // L'ordre est celui de la table : c'est celui d'une recopie SQLite.
      assert.deepEqual(Object.keys(columns), [
        "id",
        "title",
        "auteur_id",
        "corps",
      ]);
      assert.equal(columns.title?.name, "title");
      const idx = (article.indexes as Record<string, { columns: unknown[] }>)
        .article_titre_idx;
      const first = idx?.columns[0];
      assert.equal(
        typeof first === "string"
          ? first
          : (first as { expression: string }).expression,
        "title",
      );
      const uq = (
        article.uniqueConstraints as Record<string, { columns: string[] }>
      ).article_titre_unique;
      assert.deepEqual(uq?.columns, ["title"]);
      assert.ok(
        Object.hasOwn(
          article.uniqueConstraints as object,
          "article_titre_unique",
        ),
        "le NOM de la contrainte est celui de la base, il ne change pas",
      );
    });

    it("renomme une table et suit les références qui la visent", () => {
      const out = applyRenames(
        snapshot(dialect),
        plan("auteur=author", "author.ident=id_author"),
        dialect,
      );
      assert.deepEqual(out.problems, []);
      const tables = out.doc.tables as Record<string, Record<string, unknown>>;
      const key = dialect === "postgres" ? "public.author" : "author";
      assert.equal(tables[key]?.name, "author");
      assert.equal(
        Object.values(tables).some((t) => t.name === "auteur"),
        false,
      );
      const fk = Object.values(
        tables[dialect === "postgres" ? "public.article" : "article"]
          ?.foreignKeys as Record<
          string,
          { tableTo: string; columnsTo: string[] }
        >,
      )[0];
      assert.equal(fk?.tableTo, "author");
      assert.deepEqual(fk?.columnsTo, ["id_author"]);
    });

    it("rend les instructions dans la forme de l'outil, tables d'abord", () => {
      const out = applyRenames(
        snapshot(dialect),
        plan("article.titre=title", "auteur=author"),
        dialect,
      );
      const expected = {
        postgres: [
          'ALTER TABLE "auteur" RENAME TO "author";',
          'ALTER TABLE "article" RENAME COLUMN "titre" TO "title";',
        ],
        mysql: [
          "RENAME TABLE `auteur` TO `author`;",
          "ALTER TABLE `article` RENAME COLUMN `titre` TO `title`;",
        ],
        sqlite: [
          "ALTER TABLE `auteur` RENAME TO `author`;",
          'ALTER TABLE `article` RENAME COLUMN "titre" TO "title";',
        ],
      }[dialect];
      assert.deepEqual(out.statements, expected);
      assert.deepEqual(out.meta, {
        tables: { '"auteur"': '"author"' },
        columns: { '"article"."titre"': '"article"."title"' },
      });
    });

    it("NOMME ce que l'instantané ne permet pas, au lieu de deviner", () => {
      const out = applyRenames(
        snapshot(dialect),
        plan(
          "inconnue=x",
          "article=auteur",
          "article.absente=y",
          "article.titre=corps",
          "fantome.a=b",
        ),
        dialect,
      );
      assert.equal(out.problems.length, 5, out.problems.join("\n"));
      assert.deepEqual(out.statements, []);
    });
  },
);

describe("--rename : clé primaire MySQL au nom dérivé", () => {
  // L'outil nomme la clé `<table>_<colonnes>` ; garder l'ancien nom après un
  // renommage lui ferait écrire `DROP PRIMARY KEY` — refusé par MySQL sur une
  // colonne auto-incrémentée.
  function withKey() {
    const doc = snapshot("mysql");
    const article = doc.tables.article as Record<string, unknown>;
    article.compositePrimaryKeys = {
      article_id: { name: "article_id", columns: ["id"] },
      choisie: { name: "choisie", columns: ["id"] },
    };
    return doc;
  }

  it("suit le renommage de la table ET de la colonne, et garde un nom choisi", () => {
    const out = applyRenames(
      withKey(),
      plan("article=post", "post.id=post_id"),
      "mysql",
    );
    const post = (out.doc.tables as Record<string, Record<string, unknown>>)
      .post;
    assert.deepEqual(Object.keys(post?.compositePrimaryKeys as object), [
      "choisie",
      "post_post_id",
    ]);
  });

  it("ne touche pas aux autres moteurs, qui ne nomment pas la clé ainsi", () => {
    const out = applyRenames(withKey(), plan("article=post"), "sqlite");
    const post = (out.doc.tables as Record<string, Record<string, unknown>>)
      .post;
    assert.ok(
      Object.hasOwn(post?.compositePrimaryKeys as object, "article_id"),
    );
  });
});

describe("--rename : contrôles d'après génération", () => {
  it("une cible que les entités ne déclarent pas est nommée", () => {
    const written = applyRenames(
      snapshot("sqlite"),
      plan("article.titre=title"),
      "sqlite",
    ).doc;
    assert.deepEqual(
      missingRenameTargets(written, plan("article.titre=title")),
      [],
    );
    assert.deepEqual(
      missingRenameTargets(snapshot("sqlite"), plan("article.titre=title")),
      ["colonne « article.title » : aucune entité ne la déclare"],
    );
    assert.deepEqual(
      missingRenameTargets(snapshot("sqlite"), plan("auteur=author")),
      ["table « author » : aucune entité ne la déclare"],
    );
  });

  it("place les renommages en TÊTE, avec la coupure de l'outil", () => {
    assert.equal(
      prependStatements("CREATE TABLE x;", ["R1;", "R2;"]),
      "R1;\n--> statement-breakpoint\nR2;\n--> statement-breakpoint\nCREATE TABLE x;",
    );
    assert.equal(prependStatements("", ["R1;"]), "R1;\n");
  });

  it("lit les colonnes par nom de table, schéma PostgreSQL compris", () => {
    const read = columnsByTable(snapshot("postgres"));
    assert.deepEqual(read("auteur"), ["ident"]);
    assert.equal(read("absente"), null);
    assert.equal(columnsByTable(null)("auteur"), null);
  });
});
