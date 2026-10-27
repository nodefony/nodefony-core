import { readFileSync } from "node:fs";
import { readSpecsFile } from "./real-schema";
import {
  runSchemaEvolution,
  type ISchemaEvolution,
  type ISchemaEvolutionRunOptions,
} from "./schema-evolution-contract";

/**
 * Banc d'évolution rejoué sur un corpus RÉEL, d'une version à la suivante —
 * opt-in : `NF_REAL_SCHEMA_EVOLUTION` nomme le fichier que
 * `bench-real-schema.mjs --evolve <A>..<B>` (skill `nodefony-devkit-bench`)
 * écrit : les deux specs.json convertis, les renommages lus dans le script de
 * passage de l'auteur du schéma, et les suppressions qu'il a voulues. Le banc
 * recrée les bases et choisit le moteur par `-t "(<dialecte>)"`.
 */

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function readEvolution(): ISchemaEvolution | null {
  const file = process.env.NF_REAL_SCHEMA_EVOLUTION;
  if (!file) return null;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("from" in parsed) ||
    typeof parsed.from !== "string" ||
    !("to" in parsed) ||
    typeof parsed.to !== "string" ||
    !("renames" in parsed) ||
    !isStringList(parsed.renames) ||
    !("drops" in parsed) ||
    !isStringList(parsed.drops) ||
    !("between" in parsed) ||
    typeof parsed.between !== "string"
  ) {
    throw new Error(
      `${file} : attendu { from, between, to, renames: string[], drops: string[] }`,
    );
  }
  return {
    name: "real-schema",
    from: readSpecsFile(parsed.from),
    to: readSpecsFile(parsed.to),
    renames: parsed.renames,
    drops: parsed.drops,
    between: readSpecsFile(parsed.between),
    // Des centaines de tables : génération et témoins dépassent le délai commun.
    timeout: 900_000,
  };
}

const EVOLUTION = readEvolution();

const ENGINES: readonly [
  string,
  ISchemaEvolutionRunOptions["dialect"],
  string | undefined,
][] = [
  ["sqlite", "sqlite", "fichier"],
  ["postgres", "postgres", process.env.NF_PG_URL],
  ["mysql", "mysql", process.env.NF_MYSQL_URL],
];

for (const [label, dialect, target] of ENGINES) {
  describe.skipIf(EVOLUTION === null || !target)(
    `évolution d'un corpus réel (${label})`,
    () => {
      if (EVOLUTION === null) return;
      runSchemaEvolution(
        {
          dialect,
          connector: `real_evo_${label}`,
          url: dialect === "sqlite" ? undefined : target,
        },
        EVOLUTION,
      );
    },
  );
}
