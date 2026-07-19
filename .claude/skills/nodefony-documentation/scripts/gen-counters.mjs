#!/usr/bin/env node
/**
 * gen-counters.mjs — génère les compteurs `coverage/tests.<topic>.json` en COMPTANT
 * les cas réels (`it(`/`test(`) dans les fichiers de `test-map.json`.
 *
 * v2 (2026-07-19) : plus AUCUNE valeur figée — l'ancienne version portait des
 * « photos » cloud hardcodées, périmées à la première session. Ici tout est
 * recompté à chaque exécution ; test-map.json est la seule entrée (chemins
 * vérifiés, régénérables via l'inventaire des tests du repo).
 *
 * Usage : node gen-counters.mjs [topic...]   (sans args : tous les topics)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

import { execSync } from "node:child_process";
const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const REPO = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();
const OUT = path.join(REPO, "tmp/doc-work/coverage");
mkdirSync(OUT, { recursive: true });

const MAP = JSON.parse(readFileSync(path.join(TOOLS, "test-map.json"), "utf8"));
const only = process.argv.slice(2);

const TYPE_LABEL = {
  unit: "Unit",
  integration: "Intégration",
  attack: "Tests d'attaque",
  load: "Charge / mémoire",
  e2e: "E2E (base réelle)",
  contract: "Bancs de contrat",
};

const countCases = (absFile) => {
  const src = readFileSync(absFile, "utf8");
  return (
    src.match(
      /^\s*(?:it|test)(?:\.(?:each|skipIf|runIf|concurrent|todo|fails))*\s*\(/gm,
    ) ?? []
  ).length;
};

let missing = 0;
for (const [topic, spec] of Object.entries(MAP)) {
  if (only.length && !only.includes(topic)) continue;

  // Résolution : listes typées et/ou globs (hubs). Dédup par chemin.
  const byType = new Map(); // type → [{file, cases}]
  const seen = new Set();
  const addFile = (type, rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const abs = path.join(REPO, rel);
    if (!existsSync(abs)) {
      console.error(`⚠️ ${topic}: fichier absent ${rel}`);
      missing++;
      return;
    }
    const cases = type === "contract" ? 0 : countCases(abs);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push({ file: rel, cases });
  };

  for (const [type, files] of Object.entries(spec)) {
    if (type === "globs") {
      for (const g of files) {
        for (const rel of globSync(g, { cwd: REPO })) {
          if (rel.includes("/dist/") || rel.includes("node_modules")) continue;
          const t = rel.includes(".attack.")
            ? "attack"
            : rel.includes(".e2e.")
              ? "e2e"
              : rel.includes("/load/") || rel.endsWith("memory.test.ts")
                ? "load"
                : rel.includes("/integration/")
                  ? "integration"
                  : "unit";
          addFile(t, rel);
        }
      }
    } else {
      for (const rel of files) addFile(type, rel);
    }
  }

  const all = [...byType.values()].flat();
  const totalCases = all.reduce((s, f) => s + f.cases, 0);
  const counts = [
    { label: "Cas de test (comptés)", value: totalCases },
    { label: "Fichiers de test", value: all.length },
  ];
  for (const [type, files] of byType) {
    if (type === "unit" || files.length === 0) continue;
    const v =
      type === "contract"
        ? files.length
        : files.reduce((s, f) => s + f.cases, 0);
    counts.push({ label: TYPE_LABEL[type], value: v });
  }
  const groups = [...byType.entries()].map(([type, files]) => ({
    type: TYPE_LABEL[type],
    files: files.map((f) => (f.cases ? `${f.file} (${f.cases})` : f.file)),
  }));

  writeFileSync(
    path.join(OUT, `tests.${topic}.json`),
    JSON.stringify(
      { generated: new Date().toISOString().slice(0, 10), counts, groups },
      null,
      2,
    ),
  );
  console.log(
    `✅ tests.${topic}.json — ${totalCases} cas / ${all.length} fichiers`,
  );
}
if (missing) {
  console.error(
    `\n${missing} chemin(s) de test-map.json absents — corriger la carte.`,
  );
  process.exit(1);
}
