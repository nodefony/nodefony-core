/*
 *   Champs d'entité : `title:string` → colonne Drizzle du dialecte visé.
 *
 *   C'est la pièce où une erreur ne se voit pas à la relecture (un `notNull()` oublié,
 *   un type qui ne survit pas au changement de moteur) et se paye en production. D'où
 *   des tests sur les TROIS dialectes, pas seulement sur celui du développement.
 */

import assert from "node:assert";
import {
  parseEntityFields,
  buildEntityCodegen,
  EntityFieldError,
} from "../cli/scaffold/entityFields";

describe("scaffold — analyse des champs", () => {
  it("nom seul → string par défaut, NON NULL", () => {
    const [f] = parseEntityFields("title");
    assert.deepStrictEqual(f, {
      name: "title",
      type: "string",
      nullable: false,
      unique: false,
      indexed: false,
    });
  });

  it("lit type, nullable (?), unique (!) et index", () => {
    const fields = parseEntityFields("slug:string! bio:text? views:int:index");
    assert.strictEqual(fields[0].unique, true);
    assert.strictEqual(fields[0].nullable, false);
    assert.strictEqual(fields[1].nullable, true);
    assert.strictEqual(fields[2].indexed, true);
    assert.strictEqual(fields[2].type, "int");
  });

  it("accepte les modificateurs dans les deux ordres (?! et !?)", () => {
    const a = parseEntityFields("email:string?!")[0];
    const b = parseEntityFields("email:string!?")[0];
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.nullable, true);
    assert.strictEqual(a.unique, true);
  });

  it("relation : author:ref:User", () => {
    const [f] = parseEntityFields("author:ref:User");
    assert.strictEqual(f.type, "ref");
    assert.strictEqual(f.target, "User");
  });

  it("refuse ce qui produirait du code faux (le mot « invalide » → EX_USAGE)", () => {
    const rejected = [
      "title:unknownType", // type inconnu
      "Title:string", // pas camelCase
      "author:ref:user", // cible pas en PascalCase
      "author:ref", // cible manquante
      "id:string", // l'id est posé par --id
      "a:string a:int", // doublon
      "a:string:extra", // segments en trop
    ];
    for (const spec of rejected) {
      assert.throws(
        () => parseEntityFields(spec),
        (e: Error) =>
          e instanceof EntityFieldError && /invalide/u.test(e.message),
        `« ${spec} » aurait dû être refusé`,
      );
    }
  });

  it("chaîne vide → aucun champ (l'entité n'a que sa clé et ses horodatages)", () => {
    assert.deepStrictEqual(parseEntityFields("   "), []);
  });
});

describe("scaffold — code des colonnes", () => {
  const fields = parseEntityFields(
    "title:string! body:text? views:int meta:json published:bool at:date author:ref:User",
  );

  it("sqlite : types natifs du moteur, booléen et json en mode", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: true,
      softDelete: false,
    });
    assert.match(c.drizzleImport, /from "drizzle-orm\/sqlite-core"/u);
    assert.strictEqual(c.tableFn, "sqliteTable");
    assert.match(c.columns, /title: text\("title"\)\.notNull\(\)\.unique\(\)/u);
    assert.match(
      c.columns,
      /published: integer\("published", \{ mode: "boolean" \}\)/u,
    );
    assert.match(c.columns, /meta: text\("meta", \{ mode: "json" \}\)/u);
    // Nullable → PAS de notNull (et l'inverse doit rester vrai).
    assert.match(c.columns, /body: text\("body"\),/u);
  });

  it("postgres : jsonb (pas json) et timestamptz", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "postgres",
      id: "uuid7",
      timestamps: true,
      softDelete: false,
    });
    assert.strictEqual(c.tableFn, "pgTable");
    assert.match(c.columns, /meta: jsonb\("meta"\)/u);
    assert.match(
      c.columns,
      /at: timestamp\("at", \{ withTimezone: true, precision: 3 \}\)/u,
    );
  });

  it("mysql : l'uuid est un varchar — InnoDB ne sait pas indexer un TEXT", () => {
    const c = buildEntityCodegen([], {
      dialect: "mysql",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
    });
    assert.strictEqual(c.tableFn, "mysqlTable");
    assert.match(
      c.columns,
      /id: varchar\("id", \{ length: 36 \}\)\.primaryKey\(\)/u,
    );
  });

  it("clé primaire uuid7 : valeur produite côté JS (le DDL dev n'émet pas les DEFAULT SQL)", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
    });
    assert.match(
      c.columns,
      /\$defaultFn\(\(\) => Nodefony\.generateSortableId\(\)\)/u,
    );
    assert.strictEqual(c.needsNodefony, true);
    assert.strictEqual(c.idType, "string");
  });

  it("clé primaire uuid4 : générateur imprévisible", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid4",
      timestamps: false,
      softDelete: false,
    });
    assert.match(c.columns, /\$defaultFn\(\(\) => Nodefony\.generateId\(\)\)/u);
  });

  it("clé primaire serial : entier auto-incrémenté, aucun générateur JS", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "serial",
      timestamps: false,
      softDelete: false,
    });
    assert.match(
      c.columns,
      /id: integer\("id"\)\.primaryKey\(\{ autoIncrement: true \}\)/u,
    );
    assert.strictEqual(c.needsNodefony, false);
    assert.strictEqual(c.idType, "number");
  });

  it("horodatages posés côté JS, updatedAt rafraîchi à chaque écriture", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: true,
      softDelete: false,
    });
    assert.match(
      c.columns,
      /createdAt: .*\$defaultFn\(\(\) => new Date\(\)\)/u,
    );
    assert.match(
      c.columns,
      /updatedAt: .*\$onUpdateFn\(\(\) => new Date\(\)\)/u,
    );
    assert.match(c.rowProps, /createdAt: Date;/u);
  });

  it("sans horodatages : les colonnes disparaissent vraiment", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
    });
    assert.doesNotMatch(c.columns, /createdAt/u);
  });

  it("suppression douce : colonne deletedAt nullable", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: true,
    });
    assert.match(
      c.columns,
      /deletedAt: integer\("deleted_at", \{ mode: "timestamp_ms" \}\),/u,
    );
    assert.match(c.rowProps, /deletedAt: Date \| null;/u);
  });

  it("l'interface de ligne suit la nullabilité", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
    });
    assert.match(c.rowProps, /title: string;/u);
    assert.match(c.rowProps, /body: string \| null;/u);
    assert.match(c.rowProps, /views: number;/u);
  });

  it("le schéma Zod suit la nullabilité", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
    });
    assert.match(c.zodProps, /title: z\.string\(\)\.min\(1\)\.max\(255\),/u);
    assert.match(
      c.zodProps,
      /body: z\.string\(\)\.nullable\(\)\.optional\(\),/u,
    );
    // Ni id ni horodatages dans le contrat d'entrée : ils sont posés par le serveur.
    assert.doesNotMatch(c.zodProps, /\bid\b/u);
    assert.doesNotMatch(c.zodProps, /createdAt/u);
  });

  it("une relation est annotée — la contrainte FK n'est PAS promise", () => {
    const c = buildEntityCodegen(parseEntityFields("author:ref:User"), {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
    });
    assert.match(
      c.columns,
      /author: text\("author"\)\.notNull\(\), \/\/ → User\.id/u,
    );
  });
});
