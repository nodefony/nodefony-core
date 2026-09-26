/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_FILTERS } from "../../nodefony/src/audit/auditFilters";

/**
 * Les émetteurs d'audit situés HORS de `@nodefony/security` (`user`,
 * `framework`, `http`…) ne peuvent pas importer `AuditCategory` — ils ne
 * dépendent pas de ce paquet — et passent la catégorie en `string`. Le
 * compilateur ne voit donc pas une catégorie hors contrat : `authn` et `log`
 * ont été émises ainsi, invisibles pour qui filtre sur les catégories
 * déclarées. Ce test relit les sources de tous les paquets et refuse tout
 * littéral `category: "…"` d'un fichier émetteur qui n'appartient pas à
 * `AUDIT_FILTERS.category` (liste vérifiée égale au type à la compilation).
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..", "..");
const roots = [
  join(repoRoot, "src", "packages", "@nodefony"),
  join(repoRoot, "src", "nodefony", "src"),
];
const skipped = new Set(["node_modules", "dist", "tests", "frontend"]);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (skipped.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
}

function emittedCategories(): { file: string; category: string }[] {
  const files: string[] = [];
  for (const root of roots) walk(root, files);
  const found: { file: string; category: string }[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!/auditService/i.test(source)) continue;
    for (const match of source.matchAll(/category:\s*"([a-z]+)"/g)) {
      found.push({
        file: relative(repoRoot, file).split("\\").join("/"),
        category: match[1],
      });
    }
  }
  return found;
}

describe("Audit — catégories émises par tous les paquets", () => {
  const emitted = emittedCategories();

  it("le scan trouve des émetteurs dans plusieurs paquets (sinon il ne prouve rien)", () => {
    const packages = new Set(emitted.map((e) => e.file.split("/")[3]));
    expect(packages.size).toBeGreaterThanOrEqual(3);
  });

  it("chaque catégorie émise appartient au contrat AuditCategory", () => {
    const allowed = new Set<string>(AUDIT_FILTERS.category);
    const outside = emitted.filter((e) => !allowed.has(e.category));
    expect(outside).toEqual([]);
  });
});
