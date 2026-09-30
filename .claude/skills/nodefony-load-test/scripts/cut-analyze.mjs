// ─────────────────────────────────────────────────────────────────────────────
// Relit une bissection par court-circuit (`NF_WAIT_CUTS` de `wait-compare.sh`)
// et rend le COÛT DE CHAQUE ÉTAGE en µs de CPU du fil principal par requête.
//
// Le coût d'un étage = coupe(k) − coupe(k−1), calculé DANS chaque manche puis
// médian : les runs d'une manche se suivent à quelques minutes, la dérive de
// la machine entre manches ne pèse donc pas sur la différence.
//
// Refus : une coupe dont les manches dispersent au-delà de 3 % rend le tableau
// indicatif (code 3) — un étage de 1 à 2 µs sur ~50 ne se lit pas sous ce bruit.
//
// Usage : node cut-analyze.mjs <dossier> <témoin> <coupe…> [--partial]
//   (coupes dans l'ordre du pipeline). `--partial` : campagne EN COURS — les
//   étages sans run sont sautés, et le tableau se dit provisoire.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { loadRuns, median, preemptedRuns } from "./wait-lib.mjs";

const partial = process.argv.includes("--partial");
const [base, witness, ...cuts] = process.argv
  .slice(2)
  .filter((a) => a !== "--partial");
if (!base || !witness || cuts.length === 0) {
  console.error("usage : cut-analyze.mjs <dossier> <témoin> <coupe…>");
  process.exit(2);
}
const MAX_SPREAD = 0.03;
const KEY = "CPU fil principal µs/req";

/** Manche d'un run : le suffixe numérique du dossier (`cut-route-2` → 2). */
const round = (r) => Number(/-(\d+)$/.exec(r.run)[1]);
/** En-têtes de réponse relevés au contrôle de la cible (ligne de statut exclue). */
const headerCount = (dir) => {
  try {
    return fs
      .readFileSync(path.join(base, dir, "headers.txt"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes(":")).length;
  } catch {
    return NaN;
  }
};

/** Un camp a-t-il au moins un run terminé (sonde écrite) ? */
const hasRun = (camp) =>
  fs
    .readdirSync(base)
    .some(
      (d) =>
        new RegExp(`^${camp}-\\d+$`).test(d) &&
        fs.readdirSync(path.join(base, d)).some((f) => /^\d+\.json$/.test(f)),
    );
const allStages = [
  ...cuts.map((c) => ({ name: c, camp: `cut-${c}` })),
  { name: "complet", camp: "nodefony" },
];
allStages.forEach((s, i) => (s.index = i));
const stages = allStages.filter((s) => !partial || hasRun(s.camp));
for (const s of stages) {
  s.runs = new Map(loadRuns(base, s.camp).map((r) => [round(r), r]));
  const v = [...s.runs.values()].map((r) => r[KEY]);
  s.med = median(v);
  s.spread = (Math.max(...v) - Math.min(...v)) / s.med;
  s.rps = median([...s.runs.values()].map((r) => r["débit (wrk, req/s)"]));
  s.headers = headerCount(`${s.camp}-${[...s.runs.keys()][0]}`);
}
const W = partial && !hasRun(witness) ? [] : loadRuns(base, witness);
const wMed = W.length > 0 ? median(W.map((r) => r[KEY])) : NaN;
// Runs préemptés par un autre processus : ils se DISENT, et refusent le tableau.
const preempted = [
  ...stages.flatMap((s) => preemptedRuns([...s.runs.values()])),
  ...(W.length > 0 ? preemptedRuns(W) : []),
];

const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");
const rounds = Math.max(...stages.map((s) => s.runs.size));
if (partial)
  console.log(`\n⏳ PROVISOIRE — ${rounds} manche(s), campagne en cours`);
console.log(
  `\nBissection — ${KEY}, médiane des manches (témoin ${witness} : ${fmt(wMed)})\n`,
);
console.log(
  `${"étage".padEnd(9)} ${"cumul".padStart(7)} ${"disp.".padStart(6)} ${"req/s".padStart(7)} ${"en-t.".padStart(5)}  ${"coût étage".padStart(10)} ${"[min ; max]".padStart(17)}  signe`,
);
let refused = false;
let prev = null;
for (const s of stages) {
  let step = "";
  if (prev) {
    const deltas = [...s.runs.keys()]
      .filter((i) => prev.runs.has(i))
      .map((i) => s.runs.get(i)[KEY] - prev.runs.get(i)[KEY]);
    const lo = Math.min(...deltas);
    const hi = Math.max(...deltas);
    // « tenu » : toutes les manches donnent le même signe — sinon l'étage est
    // dans le bruit, quelle que soit sa médiane.
    const held = lo > 0 || hi < 0;
    step = `${fmt(median(deltas)).padStart(10)} ${`[${fmt(lo)} ; ${fmt(hi)}]`.padStart(17)}  ${deltas.length < 2 ? "1 manche" : held ? "tenu" : "BRUIT"}${
      // Étages intermédiaires pas encore mesurés : la différence les englobe.
      s.index - prev.index > 1 ? `  (depuis ${prev.name})` : ""
    }`;
  }
  const bad = s.spread > MAX_SPREAD;
  refused ||= bad;
  console.log(
    `${s.name.padEnd(9)} ${fmt(s.med).padStart(7)} ${`${(s.spread * 100).toFixed(1)}%`.padStart(6)}${bad ? "!" : " "}${String(Math.round(s.rps)).padStart(7)} ${String(s.headers).padStart(5)}  ${step}`,
  );
  prev = s;
}
const full = stages.find((s) => s.camp === "nodefony")?.med ?? NaN;
console.log(
  `\nÉcart complet − témoin : ${fmt(full - wMed)} µs/req (ratio ${(full / wMed).toFixed(3)})`,
);
for (const p of preempted)
  console.log(
    `❌ ${p.run} PRÉEMPTÉ — ${p.value.toFixed(1)} chgts de contexte invol./1000 req contre ${p.calm.toFixed(1)} au plus calme de son camp : rejouer`,
  );
refused ||= preempted.length > 0;
if (refused && !partial) {
  console.log(
    `❌ au moins une coupe disperse au-delà de ${MAX_SPREAD * 100} % — tableau INDICATIF, ne pas conclure`,
  );
  process.exit(3);
}
