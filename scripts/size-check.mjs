/**
 * Gate de budget bundle des subpaths client (ADR-0007 D10).
 *
 * Ce que ce script mesure, et pourquoi ainsi :
 *
 * - **L'artefact PUBLIÉ, pas les sources.** Il part de `dist/client/**`, ce que
 *   le consommateur reçoit vraiment par npm. Mesurer les sources reviendrait à
 *   certifier un fichier que personne n'installe.
 * - **Bundlé en UN fichier, minifié, gzippé.** Le `dist` est émis en
 *   `preserveModules` : la taille du seul `index.js` ne veut rien dire, il ne
 *   fait que réexporter. Ce qui compte est ce que le bundler d'une application
 *   tire derrière l'entry — donc on le tire, avec le bundler DU DÉPÔT (rolldown),
 *   et on gzippe par `node:zlib`. Aucun outil tiers ne re-bundle avec un autre
 *   moteur : la mesure porte sur la chaîne réelle.
 * - **Les peerDeps de vue restent externes** (react, vue, angular, svelte) :
 *   elles sont fournies par l'application ; les compter gonflerait un budget de
 *   code qu'on ne livre pas.
 *
 * Sortie : un tableau, et un code de sortie non nul au premier dépassement.
 *
 * @example
 * ```bash
 * npm run size:check
 * npm run size:check -- --json
 * ```
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGETS = path.join(ROOT, ".size-budgets.json");

/** Les runtimes de vue sont fournis par l'application — jamais dans notre budget. */
const isPeer = (id) =>
  ["react", "react-dom", "vue", "svelte"].includes(id) ||
  id.startsWith("react/") ||
  id.startsWith("react-dom/") ||
  id.startsWith("vue/") ||
  id.startsWith("@angular/") ||
  id.startsWith("svelte/");

/** Taille gzip, en kilo-octets, de l'entry une fois tirée et minifiée. */
async function measure(file, gzipLevel) {
  const bundle = await rolldown({
    input: file,
    platform: "browser",
    external: isPeer,
    // Le journal de rolldown n'a rien à dire ici : un avertissement de
    // résolution rendrait la sortie illisible sans changer la mesure.
    onLog: () => {},
  });
  const { output } = await bundle.generate({
    format: "esm",
    minify: true,
    codeSplitting: false,
    sourcemap: false,
  });
  await bundle.close();
  const code = output.map((chunk) => chunk.code ?? "").join("");
  return (
    gzipSync(Buffer.from(code, "utf8"), { level: gzipLevel }).length / 1024
  );
}

const asJson = process.argv.includes("--json");
const config = JSON.parse(readFileSync(BUDGETS, "utf8"));
const rows = [];
let failed = 0;

for (const entry of config.entries) {
  // Un chemin qui VOYAGE (le fichier de budgets) s'écrit en `/` ; un chemin
  // qu'on OUVRE se recompose natif.
  const file = path.join(ROOT, ...entry.file.split("/"));
  if (!existsSync(file)) {
    console.error(
      `✖ ${entry.subpath} — artefact absent : ${entry.file}\n` +
        `  Le budget porte sur ce que npm publie. Lancer \`npm run build\` d'abord.`,
    );
    process.exit(2);
  }
  const kb = await measure(file, config.gzipLevel ?? 9);
  const over = kb > entry.budgetKB;
  if (over) failed += 1;
  rows.push({
    subpath: entry.subpath,
    kb: Number(kb.toFixed(2)),
    budgetKB: entry.budgetKB,
    referenceKB: entry.referenceKB,
    deltaKB: Number((kb - entry.referenceKB).toFixed(2)),
    over,
    builtAt: statSync(file).mtime.toISOString(),
  });
}

if (asJson) {
  console.log(JSON.stringify({ failed, rows }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log("\n  Budgets bundle client (gzip, ADR-0007 D10)\n");
  for (const r of rows) {
    const sign = r.deltaKB >= 0 ? "+" : "";
    console.log(
      `  ${pad(r.subpath, 20)} ${pad(r.kb.toFixed(1) + " KB", 10)}` +
        `/ ${pad(r.budgetKB + " KB", 8)} ${r.over ? "✖ DÉPASSÉ" : "✅"}` +
        `   (référence ${r.referenceKB} KB, ${sign}${r.deltaKB})`,
    );
  }
  console.log("");
}

if (failed > 0) {
  console.error(
    `✖ ${failed} budget(s) dépassé(s) — blocker de release (ADR-0007 D10).\n` +
      `  Un budget ne se relève pas pour faire passer un merge : il se relève par un ADR.`,
  );
  process.exit(1);
}
