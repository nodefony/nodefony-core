// ─────────────────────────────────────────────────────────────────────────────
// Relit les fenêtres de `span-probe.mjs` (via `span-run.sh`) et rend, par
// méthode, la MÉDIANE des runs en ns/requête — brute, puis corrigée du coût de
// l'enveloppe (étalonné par la sonde, multiplié par les appels imbriqués).
//
// Usage : node span-analyze.mjs <dossier>
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { median } from "./wait-lib.mjs";

const base = process.argv[2];
if (!base) {
  console.error("usage : span-analyze.mjs <dossier>");
  process.exit(2);
}
const runs = fs
  .readdirSync(base)
  .filter((d) => /^run-\d+$/.test(d))
  .map((d) => {
    const f = fs
      .readdirSync(path.join(base, d))
      .find((x) => x.endsWith(".spans.json"));
    return f
      ? JSON.parse(fs.readFileSync(path.join(base, d, f), "utf8"))
      : null;
  })
  .filter(Boolean);
if (runs.length === 0) {
  console.error(`❌ aucune fenêtre sous ${base}`);
  process.exit(1);
}
const wrapperNs = median(runs.map((r) => r.wrapperNs));
const labels = Object.keys(runs[0].spans);
console.log(
  `\n${runs.length} run(s) · ${Math.round(median(runs.map((r) => r.requests)))} req/fenêtre · enveloppe étalonnée ${wrapperNs.toFixed(0)} ns (borne BASSE : boucle monomorphe)\n`,
);
const w = Math.max(...labels.map((l) => l.length));
console.log(
  `${"méthode".padEnd(w)}  appels/req  ns/req brut  [min ; max]     ns/req − enveloppe`,
);
for (const l of labels) {
  const v = runs.map((r) => r.spans[l].nsPerReq);
  const calls = median(runs.map((r) => r.spans[l].callsPerReq));
  const med = median(v);
  console.log(
    `${l.padEnd(w)}  ${calls.toFixed(2).padStart(10)}  ${med.toFixed(0).padStart(11)}  [${Math.min(...v).toFixed(0)} ; ${Math.max(...v).toFixed(0)}]`.padEnd(
      w + 52,
    ) + (med - calls * wrapperNs).toFixed(0).padStart(8),
  );
}
console.log(
  "\nTemps INCLUSIFS : un parent contient ses enfants ET leurs enveloppes.",
);
