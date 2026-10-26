import assert from "node:assert/strict";
import { getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core";
import { getTableConfig as pgConfig } from "drizzle-orm/pg-core";
import { getTableConfig as mysqlConfig } from "drizzle-orm/mysql-core";
import { defineTable } from "../../nodefony/entity/colKit";
import { ENUM_MAX_LENGTH } from "../../nodefony/entity/colKit.spec";
// Le générateur vit dans le cœur, qui ne peut pas dépendre de ce module : la
// borne et la table des types SQL y sont RECOPIÉES. Ce test est ce qui empêche
// les deux copies de diverger.
import {
  buildPortableEntityCodegen,
  parseEntityFields,
  PORTABLE_COLUMN_SQL,
  PORTABLE_ENUM_MAX_LENGTH,
} from "../../../../../nodefony/src/cli/scaffold/entityFields";

describe("colKit ↔ générateur — une borne recopiée, confrontée", () => {
  it("la plus longue valeur d'énumération est la même des deux côtés", () => {
    assert.equal(PORTABLE_ENUM_MAX_LENGTH, ENUM_MAX_LENGTH);
  });
});

describe("colKit ↔ générateur — les types SQL que le catalogue annonce", () => {
  /**
   * La colonne d'exemple de chaque type, telle qu'on la TAPE — tailles
   * comprises, celles que `PORTABLE_COLUMN_SQL` annonce.
   */
  const TYPED = {
    string: "string",
    text: "text",
    int: "int",
    float: "float",
    bool: "bool",
    json: "json",
    date: "date",
    uuid: "uuid",
    enum: "enum(a,b)",
    char: "char(2)",
    decimal: "decimal(12,2)",
  } as const;
  type Typed = keyof typeof TYPED;
  const isTyped = (name: string): name is Typed => Object.hasOwn(TYPED, name);

  /** La même colonne, écrite dans la grammaire du kit : c'est elle qu'on migre. */
  const PROBE_COLUMNS = {
    string: { kind: "string" },
    text: { kind: "text" },
    int: { kind: "int" },
    float: { kind: "float" },
    bool: { kind: "bool" },
    json: { kind: "json" },
    date: { kind: "datetime" },
    uuid: { kind: "uuid" },
    enum: { kind: "enum", values: ["a", "b"] },
    char: { kind: "char", length: 2 },
    decimal: { kind: "decimal", precision: 12, scale: 2 },
  } as const;
  const PROBE = defineTable({
    name: "probe",
    columns: { id: { kind: "uuid", primaryKey: true }, ...PROBE_COLUMNS },
  });

  it("la sonde décrit les colonnes que le générateur écrit vraiment", () => {
    const { columns } = buildPortableEntityCodegen(
      parseEntityFields(
        Object.entries(TYPED)
          .map(([type, typed]) => `x${type}:${typed}?`)
          .join(" "),
      ),
      {
        dialect: "sqlite",
        id: "uuid7",
        timestamps: false,
        softDelete: false,
        table: "probe",
        entity: "Probe",
      },
    );
    const lines = columns.split("\n").map((line) => line.trim());
    const drift: string[] = [];
    for (const [type, column] of Object.entries(PROBE_COLUMNS)) {
      const line = lines.find((l) => l.startsWith(`x${type}:`)) ?? "";
      // Le genre, puis la taille telle que la sonde l'écrit : `length: 2`,
      // `precision: 12, scale: 2`, `values: ["a", "b"]`.
      const expected = [
        `kind: "${column.kind}"`,
        ...("length" in column ? [`length: ${column.length}`] : []),
        ...("precision" in column
          ? [`precision: ${column.precision}`, `scale: ${column.scale}`]
          : []),
        ...("values" in column
          ? [
              `values: [${column.values.map((v) => JSON.stringify(v)).join(", ")}]`,
            ]
          : []),
      ].join(", ");
      if (!line.startsWith(`x${type}: { ${expected} `)) {
        drift.push(`${type} : générateur « ${line} », sonde « ${expected} »`);
      }
    }
    assert.deepEqual(drift, []);
  });

  it("chaque cellule SQL est le type et la contrainte que le kit pose", () => {
    const configs = [
      ["sqlite", sqliteConfig(PROBE.table("sqlite"))],
      ["postgres", pgConfig(PROBE.table("postgres"))],
      ["mysql", mysqlConfig(PROBE.table("mysql"))],
    ] as const;
    const drift: string[] = [];
    for (const [dialect, config] of configs) {
      const checks = new Set(config.checks.map((ck) => ck.name));
      for (const column of config.columns) {
        if (!isTyped(column.name)) continue; // la clé primaire n'est pas un exemple
        const check = checks.has(`probe_${column.name}_len`)
          ? " + CHECK longueur"
          : checks.has(`probe_${column.name}_check`)
            ? " + CHECK valeurs"
            : "";
        const actual = `${column.getSQLType()}${check}`;
        const announced = PORTABLE_COLUMN_SQL[column.name][dialect];
        if (actual !== announced) {
          drift.push(
            `${column.name} × ${dialect} : catalogue « ${announced} », kit « ${actual} »`,
          );
        }
      }
      // Aucune contrainte que le catalogue ne sache nommer.
      for (const name of checks) {
        if (!/^probe_\w+_(len|check)$/u.test(name))
          drift.push(`${dialect} : CHECK inconnu ${name}`);
      }
    }
    assert.deepEqual(drift, []);
  });
});
