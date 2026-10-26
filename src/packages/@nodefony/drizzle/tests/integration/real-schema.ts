import { readFileSync } from "node:fs";
import type { IPortableTable } from "../../nodefony/entity/colKit";
import type { ITableSpec } from "../../nodefony/entity/colKit.spec";
import { materializeSpecs, type ISerializedSpec } from "./serialized-specs";

/**
 * Le corpus RÉEL du banc de schéma — un logiciel écrit par d'autres, converti
 * par `mysql-ddl-to-specs.mjs`, lu depuis le fichier que nomme
 * `NF_REAL_SCHEMA_SPECS`. Sa licence interdit de le versionner : sans la
 * variable, le corpus est vide et le banc se saute (interrupteur déclaré dans
 * `scripts/test/vitest/gates.ts#OPT_IN_SWITCHES`).
 *
 * `drizzle-kit` relit ce fichier en CommonJS : lecture SYNCHRONE, aucun
 * `await` de premier niveau, et pas d'`import.meta`.
 */

function isSpec(value: unknown): value is ISerializedSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "columns" in value &&
    typeof value.columns === "object" &&
    value.columns !== null
  );
}

function readSpecs(): readonly ISerializedSpec[] {
  const file = process.env.NF_REAL_SCHEMA_SPECS;
  if (!file) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const specs =
    typeof parsed === "object" && parsed !== null && "specs" in parsed
      ? parsed.specs
      : undefined;
  if (!Array.isArray(specs) || !specs.every(isSpec)) {
    throw new Error(
      `${file} : pas une sortie de mysql-ddl-to-specs.mjs ({ specs: [...] })`,
    );
  }
  return specs;
}

/** Les descriptions sérialisées du corpus réel (vide sans la variable). */
export const REAL_SCHEMA_SPECS: readonly ISerializedSpec[] = readSpecs();

/** Les tables portables du corpus réel, par nom. */
export const REAL_SCHEMA: ReadonlyMap<
  string,
  IPortableTable<ITableSpec>
> = materializeSpecs(REAL_SCHEMA_SPECS);
