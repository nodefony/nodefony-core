/**
 * Carte de couverture du temps réel — quel étage de test EXERCE quel fichier source.
 *
 * Le critère n'est pas « le nom apparaît quelque part » (une chaîne dans un
 * commentaire compte alors comme une preuve) mais « un fichier de test IMPORTE
 * ce module ». C'est mécanique, reproductible, et sans angle mort de formulation.
 *
 * Ce que ce script NE dit PAS, et qu'aucun automate ne dira : si le test exerce
 * vraiment le mécanisme ou seulement l'importe pour un décor. Il rend la carte ;
 * le jugement reste à l'humain qui la lit.
 *
 * 🔴 Sa SECONDE limite était de ne voir que l'import DIRECT — un module atteint
 * à travers un autre sortait « éprouvé par personne » alors qu'un banc l'exerce.
 * Elle a fabriqué DEUX faux verdicts, donc deux tickets : `BrowserWsTransport`
 * (que `RealtimeClient` construit lui-même) et `publishQueue` (que
 * `RedisBackplane` porte, et qu'un banc nommé `backplanePublishQueue.test.ts`
 * exerçait déjà — le relevé l'avait sous les yeux). Ce script mesure donc
 * désormais l'atteinte INDIRECTE : un module importé par un module source
 * lui-même testé est rangé à part, ni trou ni preuve.
 *
 * Ce qui RESTE vrai et qu'aucun automate ne dira : atteint ≠ exercé, et importé
 * ≠ exercé. La carte se lit, elle ne conclut pas.
 *
 * Usage : node scripts/realtime-coverage-map.mjs [--json]
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const SOURCES = [
  "src/packages/@nodefony/realtime/nodefony/src",
  "src/nodefony/src/realtime",
  "src/nodefony/src/client/realtime",
];

/**
 * Les étages, dans l'ordre où ils prouvent de plus en plus de choses.
 *
 * 🔴 Le balayage porte sur TOUT le dépôt, pas sur les seuls tests du module
 * realtime : la première version s'y limitait et déclarait `BrowserWsTransport`
 * « éprouvé par personne » alors qu'un banc de `@nodefony/http`
 * (`client-isomorphe-e2e.test.ts`) l'exerce de bout en bout. Un périmètre trop
 * étroit ne rend pas un verdict incomplet, il rend un verdict FAUX — et celui-ci
 * accusait le code au lieu de l'instrument.
 */
const STAGES = [
  { key: "unit", label: "unitaire" },
  { key: "e2e", label: "intégration/e2e" },
  { key: "load", label: "charge" },
];

/** L'étage d'un fichier de test se lit sur son CHEMIN, seule donnée fiable. */
const stageOf = (f) =>
  f.endsWith(".mjs")
    ? "load"
    : f.includes("/tests/integration/") ||
        f.includes(".e2e.") ||
        f.includes("/tests/websockets/")
      ? "e2e"
      : "unit";

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

const listFiles = (dir, pattern) => {
  try {
    return sh("find", [
      dir,
      "-name",
      pattern,
      "-not",
      "-path",
      "*/node_modules/*",
      "-not",
      "-path",
      "*/dist/*",
      "-not",
      "-path",
      "*/.coverage/*",
    ])
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

// Les modules source à couvrir.
const modules = SOURCES.flatMap((d) => listFiles(d, "*.ts"))
  .filter((f) => !f.endsWith(".d.ts"))
  .map((f) => ({ file: f, stem: path.basename(f, ".ts") }));

// Les fichiers de test du dépôt ENTIER, rangés par étage.
const tests = { unit: [], e2e: [], load: [] };
for (const f of [
  ...listFiles("src", "*.test.ts"),
  ...listFiles(".claude/skills/nodefony-load-test/scripts", "*.mjs"),
]) {
  tests[stageOf(f)].push(f);
}

const contents = new Map();
const read = (f) => {
  if (!contents.has(f)) {
    try {
      contents.set(f, readFileSync(f, "utf8"));
    } catch {
      contents.set(f, "");
    }
  }
  return contents.get(f);
};

const rows = [];
for (const m of modules) {
  const row = { module: m.stem, file: m.file };
  for (const st of STAGES) {
    // « importe ce module » : un chemin d'import qui se termine par le nom du
    // fichier. Les scripts de charge, eux, n'importent pas la source — ils
    // parlent au serveur : on y accepte la mention du nom.
    const re =
      st.key === "load"
        ? new RegExp(`\\b${m.stem}\\b`, "u")
        : new RegExp(`from\\s+["'][^"']*/${m.stem}(\\.js|\\.ts)?["']`, "u");
    row[st.key] = tests[st.key]
      .filter((t) => re.test(read(t)))
      .map((t) => path.basename(t));
  }
  rows.push(row);
}

rows.sort((a, b) => a.module.localeCompare(b.module));

// Atteinte INDIRECTE : qui, parmi les modules SOURCE, importe ce module ? Si l'un
// d'eux est lui-même testé, le module est atteint — c'est ce que l'import direct
// ne voyait pas, et c'est ce qui accusait le code au lieu de l'instrument.
const testedDirectly = new Set(
  rows
    .filter((r) => r.unit.length + r.e2e.length + r.load.length > 0)
    .map((r) => r.module),
);
const sourceImporters = new Map(modules.map((m) => [m.stem, []]));
for (const m of modules) {
  const src = read(m.file);
  for (const other of modules) {
    if (other.stem === m.stem) continue;
    const re = new RegExp(
      `from\\s+["'][^"']*/${other.stem}(\\.js|\\.ts)?["']`,
      "u",
    );
    if (re.test(src)) sourceImporters.get(other.stem).push(m.stem);
  }
}
for (const r of rows) {
  r.indirect = testedDirectly.has(r.module)
    ? []
    : sourceImporters.get(r.module).filter((p) => testedDirectly.has(p));
}

const trous = rows.filter(
  (r) => !testedDirectly.has(r.module) && r.indirect.length === 0,
);
const indirects = rows.filter((r) => r.indirect.length > 0);
const sansE2e = rows.filter(
  (r) => r.e2e.length === 0 && (r.unit.length > 0 || r.load.length > 0),
);

if (process.argv.includes("--json")) {
  process.stdout.write(
    JSON.stringify({ rows, trous, indirects, sansE2e }, null, 2),
  );
} else {
  console.log(`${rows.length} modules source du temps réel`);
  console.log(
    `  éprouvés par au moins un étage : ${rows.length - trous.length}`,
  );
  console.log(`  atteints seulement INDIRECTEMENT : ${indirects.length}`);
  console.log(`  AUCUN test ne les atteint      : ${trous.length}`);
  console.log(`  sans étage intégration/e2e     : ${sansE2e.length}`);
  console.log("\n── Aucun test ne les atteint, même indirectement ──");
  for (const r of trous) console.log(`  ${r.module}  (${r.file})`);
  console.log(
    "\n── Atteints À TRAVERS un module testé (atteint ≠ exercé : à lire) ──",
  );
  for (const r of indirects)
    console.log(`  ${r.module}  ← via ${r.indirect.join(", ")}`);
  console.log("\n── Éprouvés en unitaire, JAMAIS dans la jonction ──");
  for (const r of sansE2e)
    console.log(`  ${r.module}  ← ${r.unit.join(", ") || r.load.join(", ")}`);
}
