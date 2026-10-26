import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { defineTable } from "../../nodefony/entity/colKit";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import {
  MAX_IDENTIFIER_LENGTH,
  boundedForeignKeyName,
  boundedUniqueName,
} from "../../nodefony/entity/colKit.shared";
import {
  FORMAT_MARKER,
  dropOverlongPrimaryKeyNames,
  sealGeneratedSql,
} from "../../nodefony/src/migrator/kit";

/**
 * Ce que cette suite protège : les noms que Drizzle DÉRIVE d'une table au nom
 * long. MySQL et MariaDB refusent un identifiant de plus de 64 caractères
 * (`ER_TOO_LONG_IDENT`) — la table entière n'est pas créée —, PostgreSQL le
 * tronque en silence à 63. Un vrai schéma de 421 tables portait une table de
 * 59 caractères : sa clé primaire `<table>_rowid` en faisait 65.
 */

// 60 caractères, comme la table du corpus erp-lite qui l'a trouvé.
const LONG_TABLE =
  "erp_conference_booth_attendee_registration_extrafields_named";

describe("dropOverlongPrimaryKeyNames — la clé primaire MySQL que drizzle-kit nomme sans borne", () => {
  const create = (pk: string): string =>
    `CREATE TABLE \`t\` (\n\t\`rowid\` int AUTO_INCREMENT NOT NULL,\n\tCONSTRAINT \`${pk}\` PRIMARY KEY(\`rowid\`)\n);`;

  it("retire le nom au-delà de 63 caractères — MySQL nomme sa clé PRIMARY", () => {
    const out = dropOverlongPrimaryKeyNames(create(`${LONG_TABLE}_rowid`));
    assert.ok(!out.includes("CONSTRAINT"), out);
    assert.ok(out.includes("\tPRIMARY KEY(`rowid`)"), out);
  });

  it("laisse INTACT un nom qui tient — une migration qui passait ne change pas d'un octet", () => {
    const name = "x".repeat(MAX_IDENTIFIER_LENGTH);
    assert.equal(dropOverlongPrimaryKeyNames(create(name)), create(name));
  });

  it("traite chaque table d'une migration, pas seulement la première", () => {
    const sql = [
      create(`${LONG_TABLE}_rowid`),
      create(`${LONG_TABLE}_identifier`),
    ].join("\n--> statement-breakpoint\n");
    assert.equal(dropOverlongPrimaryKeyNames(sql).match(/CONSTRAINT/g), null);
  });

  it("ne touche pas le SQL PostgreSQL (guillemets doubles)", () => {
    const pg = `CREATE TABLE "t" (\n\t"a" text,\n\tCONSTRAINT "${LONG_TABLE}_a_pk" PRIMARY KEY("a")\n);`;
    assert.equal(dropOverlongPrimaryKeyNames(pg), pg);
  });
});

describe("sealGeneratedSql — le passage obligé de toute migration générée", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-seal-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("scelle un fichier neuf : marqueur posé ET clé primaire trop longue rendue anonyme", () => {
    const file = path.join(dir, "0000_neuf.sql");
    fs.writeFileSync(
      file,
      `CREATE TABLE \`t\` (\r\n\tCONSTRAINT \`${LONG_TABLE}_rowid\` PRIMARY KEY(\`rowid\`)\r\n);`,
    );
    assert.equal(sealGeneratedSql(dir), 1);
    const body = fs.readFileSync(file, "utf8");
    assert.ok(body.startsWith(`${FORMAT_MARKER}\n`), body);
    assert.ok(!body.includes("CONSTRAINT"), body);
    assert.ok(!body.includes("\r\n"), body);
  });

  it("ne relit pas un fichier déjà scellé — il a peut-être été appliqué", () => {
    const file = path.join(dir, "0000_ancien.sql");
    const sealed = `${FORMAT_MARKER}\nCONSTRAINT \`${LONG_TABLE}_rowid\` PRIMARY KEY(\`rowid\`)`;
    fs.writeFileSync(file, sealed);
    assert.equal(sealGeneratedSql(dir), 0);
    assert.equal(fs.readFileSync(file, "utf8"), sealed);
  });
});

// Le kit NOMME lui-même chaque unicité et chaque clé étrangère, à toute
// longueur, du texte que drizzle-kit 0.31 aurait écrit : une migration déjà
// écrite ne bouge pas, et le nom ne dépend plus de la convention de l'outil
// (Drizzle 1 distingue un nom DONNÉ d'un nom DÉDUIT, et recalcule le second).
describe("boundedUniqueName — l'unicité d'une colonne, toujours nommée par le kit", () => {
  it("rend le nom de drizzle-kit 0.31 quand il tient : la contrainte garde son nom", () => {
    assert.equal(
      boundedUniqueName("erp_user", "login"),
      "erp_user_login_unique",
    );
  });

  it("borne à 63 un nom qui déborderait", () => {
    const name = boundedUniqueName(LONG_TABLE, "registration_ref");
    assert.ok(name.length <= MAX_IDENTIFIER_LENGTH, name);
  });

  const table = defineTable({
    name: LONG_TABLE,
    columns: {
      rowid: { kind: "serial", primaryKey: true },
      registration_ref: { kind: "string", length: 32, unique: true },
      code: { kind: "string", length: 8, unique: true },
    },
  });
  for (const dialect of ["sqlite", "postgres", "mysql"] as const) {
    it(`la table ${dialect} porte le nom borné`, () => {
      const cols: Record<string, { uniqueName?: string | undefined }> =
        getTableColumns(table.table(dialect));
      assert.equal(
        cols.registration_ref?.uniqueName,
        boundedUniqueName(LONG_TABLE, "registration_ref"),
      );
      // `<table>_code_unique` = 72 caractères : borné aussi.
      assert.ok(
        (cols.code?.uniqueName ?? "").length <= MAX_IDENTIFIER_LENGTH,
        String(cols.code?.uniqueName),
      );
    });
  }
});

describe("boundedForeignKeyName — chaque clé étrangère, toujours nommée par le kit", () => {
  const country = defineTable({
    name: "nf_bound_country",
    columns: { code: { kind: "char", length: 2, primaryKey: true } },
  });
  const spec = {
    name: "nf_bound_city",
    columns: {
      id: { kind: "serial", primaryKey: true },
      country: { kind: "ref", target: () => country, notNull: true },
      parent: { kind: "ref", target: "self", onDelete: "cascade" },
    },
  } as const;
  const city = defineTable(spec);

  it("rend le nom de drizzle-kit 0.31 quand il tient", () => {
    assert.equal(
      boundedForeignKeyName(city.spec, "country", spec.columns.country),
      "nf_bound_city_country_nf_bound_country_code_fk",
    );
    assert.equal(
      boundedForeignKeyName(city.spec, "parent", spec.columns.parent),
      "nf_bound_city_parent_nf_bound_city_id_fk",
    );
  });

  const configs = {
    sqlite: () => sqliteTableConfig(city.table("sqlite")).foreignKeys,
    postgres: () => pgTableConfig(city.table("postgres")).foreignKeys,
    mysql: () => mysqlTableConfig(city.table("mysql")).foreignKeys,
  };
  for (const [dialect, foreignKeys] of Object.entries(configs)) {
    it(`la table ${dialect} DONNE son nom à chaque clé étrangère, cible et action comprises`, () => {
      const keys = foreignKeys().map((fk) => {
        const ref = fk.reference();
        return {
          name: ref.name,
          columns: ref.columns.map((c) => c.name),
          target: ref.foreignColumns.map((c) => c.name),
          onDelete: fk.onDelete,
        };
      });
      assert.deepEqual(
        keys.sort((a, b) => String(a.name).localeCompare(String(b.name))),
        [
          {
            name: "nf_bound_city_country_nf_bound_country_code_fk",
            columns: ["country"],
            target: ["code"],
            onDelete: "no action",
          },
          {
            name: "nf_bound_city_parent_nf_bound_city_id_fk",
            columns: ["parent"],
            target: ["id"],
            onDelete: "cascade",
          },
        ],
      );
    });
  }
});
