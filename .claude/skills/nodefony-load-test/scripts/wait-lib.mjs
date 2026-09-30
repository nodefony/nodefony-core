// ─────────────────────────────────────────────────────────────────────────────
// Lecture des fenêtres de `wait-probe.mjs` — partagée par `wait-analyze.mjs`
// (deux camps) et `cut-analyze.mjs` (étages d'une bissection) : un seul calcul
// « par requête », deux lecteurs.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Une fenêtre → grandeurs ramenées à la requête (µs, ou compte). */
export function perRequest(w, rps) {
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

export function loadRuns(base, camp) {
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

const CTX_KEY = "chgts contexte invol. / 1000 req";

/**
 * Runs PRÉEMPTÉS : plus de 2× les changements de contexte involontaires du run
 * le plus calme de leur camp (et au moins +5 pour 1000 requêtes). Un autre
 * processus a pris le CPU pendant la fenêtre — le travail coûte alors plus
 * cher, noyau compris, sans que le code y soit pour rien. La garde « machine
 * calme » (thermal, indexeur) ne voit pas cette charge ; vécu sur #508 :
 * 22,7 contre 10,8 pour 1000 req, +11 % de CPU/req, run pris pour un étage.
 *
 * Référence = le MINIMUM du camp, pas la médiane : sur 2 ou 3 runs, un seul
 * run pollué déplace la médiane.
 *
 * @param runs - les runs d'UN camp (`loadRuns`).
 * @returns les runs à refuser, chacun avec sa valeur et la référence.
 */
export function preemptedRuns(runs) {
  const calm = Math.min(...runs.map((r) => r[CTX_KEY]));
  return runs
    .filter((r) => r[CTX_KEY] > 2 * calm && r[CTX_KEY] - calm >= 5)
    .map((r) => ({ run: r.run, value: r[CTX_KEY], calm }));
}
