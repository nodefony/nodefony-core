// ─────────────────────────────────────────────────────────────────────────────
// Relit les fenêtres de `wait-probe.mjs` (via `wait-compare.sh`) et rend, par
// camp, la MÉDIANE des runs ramenée à la requête — puis l'écart.
//
// Usage : node wait-analyze.mjs <dossier> <campA> <campB> [--json <fichier>]
// Dossiers attendus : <dossier>/<camp>-<n>/<pid>.json
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { loadRuns, median, preemptedRuns } from "./wait-lib.mjs";

const [base, campA, campB] = process.argv.slice(2);
const jsonIdx = process.argv.indexOf("--json");
const jsonOut = jsonIdx > 0 ? process.argv[jsonIdx + 1] : null;
if (!base || !campA || !campB) {
  console.error(
    "usage : wait-analyze.mjs <dossier> <campA> <campB> [--json <fichier>]",
  );
  process.exit(2);
}

const A = loadRuns(base, campA);
const B = loadRuns(base, campB);
const keys = Object.keys(A[0]).filter((k) => k !== "run" && k !== "gc");
const rows = keys.map((k) => {
  const a = median(A.map((r) => r[k]));
  const b = median(B.map((r) => r[k]));
  const aMin = Math.min(...A.map((r) => r[k]));
  const aMax = Math.max(...A.map((r) => r[k]));
  const bMin = Math.min(...B.map((r) => r[k]));
  const bMax = Math.max(...B.map((r) => r[k]));
  const separated = aMin > bMax || bMin > aMax;
  return {
    metric: k,
    [campA]: a,
    [campB]: b,
    delta: a - b,
    ratio: b ? a / b : NaN,
    separated,
  };
});

const fmt = (x) =>
  Math.abs(x) >= 100
    ? x.toFixed(0)
    : Math.abs(x) >= 10
      ? x.toFixed(1)
      : x.toFixed(2);
const w0 = Math.max(...keys.map((k) => k.length));
console.log(
  `\n${campA} (${A.length} runs) contre ${campB} (${B.length} runs) — médianes\n`,
);
console.log(
  `${"".padEnd(w0)}  ${campA.padStart(10)}  ${campB.padStart(10)}  ${"écart".padStart(9)}  ratio  séparé`,
);
for (const r of rows) {
  console.log(
    `${r.metric.padEnd(w0)}  ${fmt(r[campA]).padStart(10)}  ${fmt(r[campB]).padStart(10)}  ${fmt(r.delta).padStart(9)}  ${(Number.isFinite(r.ratio) ? r.ratio.toFixed(2) : "—").padStart(5)}  ${r.separated ? "oui" : "non"}`,
  );
}
const gcKinds = (runs) => {
  const acc = Object.create(null);
  for (const r of runs)
    for (const [k, g] of Object.entries(r.gc)) (acc[k] ??= []).push(g);
  return Object.fromEntries(
    Object.entries(acc).map(([k, gs]) => [
      k,
      `${median(gs.map((g) => g.count))} × (${fmt(median(gs.map((g) => g.ms)))} ms)`,
    ]),
  );
};
console.log(
  `\nGC par genre (médiane sur la fenêtre) :\n  ${campA} : ${JSON.stringify(gcKinds(A))}\n  ${campB} : ${JSON.stringify(gcKinds(B))}`,
);
if (jsonOut)
  fs.writeFileSync(
    jsonOut,
    JSON.stringify({ campA, campB, A, B, rows }, null, 2),
  );
const preempted = [...preemptedRuns(A), ...preemptedRuns(B)];
if (preempted.length > 0) {
  for (const p of preempted)
    console.log(
      `❌ ${p.run} PRÉEMPTÉ — ${p.value.toFixed(1)} chgts de contexte invol./1000 req contre ${p.calm.toFixed(1)} au plus calme de son camp : rejouer`,
    );
  process.exit(3);
}
