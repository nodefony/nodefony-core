// ─────────────────────────────────────────────────────────────────────────────
// Relit les fenêtres de `wait-probe.mjs` (via `wait-compare.sh`) et rend, par
// camp, la MÉDIANE des runs ramenée à la requête — puis l'écart.
//
// Usage : node wait-analyze.mjs <dossier> <campA> <campB> [--json <fichier>]
// Dossiers attendus : <dossier>/<camp>-<n>/<pid>.json
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";

const [base, campA, campB] = process.argv.slice(2);
const jsonIdx = process.argv.indexOf("--json");
const jsonOut = jsonIdx > 0 ? process.argv[jsonIdx + 1] : null;
if (!base || !campA || !campB) {
  console.error(
    "usage : wait-analyze.mjs <dossier> <campA> <campB> [--json <fichier>]",
  );
  process.exit(2);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Une fenêtre → grandeurs ramenées à la requête (µs, ou compte). */
function perRequest(w, rps) {
  const n = w.requests;
  const gcMs = Object.values(w.gc).reduce((a, g) => a + g.ms, 0);
  const gcCount = Object.values(w.gc).reduce((a, g) => a + g.count, 0);
  const writes = w.writes.write + w.writes.writev;
  return {
    "débit (wrk, req/s)": rps,
    "débit (sonde, req/s)": (n / w.wallMs) * 1000,
    "occupation boucle (ELU %)": w.elu.utilization * 100,
    "boucle active µs/req": (w.elu.activeMs * 1000) / n,
    "boucle inactive µs/req": (w.elu.idleMs * 1000) / n,
    "CPU fil principal µs/req": (w.cpuMs.thread * 1000) / n,
    "  dont user": (w.cpuMs.threadUser * 1000) / n,
    "  dont système (noyau)": (w.cpuMs.threadSystem * 1000) / n,
    "CPU process µs/req": (w.cpuMs.process * 1000) / n,
    "CPU autres fils µs/req": ((w.cpuMs.process - w.cpuMs.thread) * 1000) / n,
    "actif hors CPU fil µs/req": ((w.elu.activeMs - w.cpuMs.thread) * 1000) / n,
    "GC µs/req": (gcMs * 1000) / n,
    "GC / 1000 req": (gcCount * 1000) / n,
    "tours de boucle / req": w.uv.loopCount / n,
    "évènements libuv / req": w.uv.events / n,
    "écritures socket / req": writes / n,
    "  dont writev / req": w.writes.writev / n,
    "octets écrits / req": w.writes.bytes / n,
    "chgts contexte vol. / 1000 req": (w.ctxSwitches.voluntary * 1000) / n,
    "chgts contexte invol. / 1000 req": (w.ctxSwitches.involuntary * 1000) / n,
  };
}

function load(camp) {
  const runs = fs
    .readdirSync(base)
    .filter(
      (d) => d.startsWith(`${camp}-`) && /^\d+$/.test(d.slice(camp.length + 1)),
    )
    .map((d) => {
      const dir = path.join(base, d);
      const file = fs.readdirSync(dir).find((f) => /^\d+\.json$/.test(f));
      if (!file) return null;
      const w = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      const wrk = fs.readFileSync(path.join(dir, "wrk.txt"), "utf8");
      const rps = Number(/Requests\/sec:\s+([\d.]+)/.exec(wrk)?.[1] ?? NaN);
      return Object.assign(perRequest(w, rps), { run: d, gc: w.gc });
    })
    .filter(Boolean);
  if (runs.length === 0) {
    console.error(`❌ aucun run pour « ${camp} » sous ${base}`);
    process.exit(1);
  }
  return runs;
}

const A = load(campA);
const B = load(campB);
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
