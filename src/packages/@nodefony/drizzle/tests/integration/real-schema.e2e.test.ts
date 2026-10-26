import path from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_SCHEMA, REAL_SCHEMA_SPECS } from "./real-schema";
import { runSchemaContract, type ISchemaRunOptions } from "./schema-contract";

/**
 * Le contrat de schéma rejoué sur un corpus RÉEL (des centaines de tables) —
 * opt-in : `NF_REAL_SCHEMA_SPECS` nomme le specs.json converti, et
 * `bench-real-schema.mjs` (skill `nodefony-devkit-bench`) le pose, recrée les
 * bases et choisit le moteur par `-t "(<dialecte>)"`.
 */

const CORPUS = {
  name: "realschema",
  specs: REAL_SCHEMA_SPECS,
  tables: REAL_SCHEMA,
  fixtureFile: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "real-schema.ts",
  ),
  tablesExport: "REAL_SCHEMA",
};

/** Des centaines de tables : création et témoins dépassent le délai commun. */
const TIMEOUT = 600_000;

const ENGINES: readonly [
  string,
  ISchemaRunOptions["dialect"],
  string | undefined,
][] = [
  ["sqlite", "sqlite", ":memory:"],
  ["postgres", "postgres", process.env.NF_PG_URL],
  ["mysql", "mysql", process.env.NF_MYSQL_URL],
];

for (const [label, dialect, target] of ENGINES) {
  describe.skipIf(REAL_SCHEMA_SPECS.length === 0 || !target)(
    `corpus réel (${label})`,
    { timeout: TIMEOUT },
    () => {
      for (const schema of ["derived", "migration"] as const) {
        runSchemaContract(
          {
            dialect,
            connector: `real_${label}_${schema}`,
            connection:
              dialect === "sqlite" ? { filename: ":memory:" } : { url: target },
            schema,
            timeout: TIMEOUT,
          },
          CORPUS,
        );
      }
    },
  );
}
