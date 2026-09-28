// Relit un profil `--cpu-prof` pris par `profile-cpu.sh` : temps PROPRE agrégé
// par fonction et par origine (paquet, module node:, natif), FENÊTRÉ sur les
// 20 dernières secondes actives — le profil couvre aussi le démarrage — et
// rapporté en µs par requête servie.
//
// Usage : node profile-analyze.mjs <dossier> [requêtes] [top=40]
//   requêtes : défaut = `rps` écrit par profile-cpu.sh × 20 s de charge.
// Importable : `analyzeProfile(dossier)` sert à `profile-compare.mjs`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Durée de la charge mesurée par profile-cpu.sh, en secondes. */
export const LOAD_SECONDS = 20;

/**
 * Rattache une trame à son origine : paquet npm, module `node:`, paquet
 * `@nodefony/*`, cœur, ou natif (sans URL).
 */
export function classify(cf) {
  const u = cf.url || "";
  if (!u) return cf.functionName.startsWith("(") ? cf.functionName : "(native)";
  if (u.startsWith("node:")) return "node:" + u.slice(5).split("/")[0];
  const m = u.match(/node_modules\/((@[^/]+\/)?[^/]+)/g);
  if (m) return m[m.length - 1].replace("node_modules/", "");
  const s = u.match(/src\/packages\/(@nodefony\/[^/]+)/);
  if (s) return s[1];
  if (u.includes("src/nodefony/")) return "nodefony(core)";
  return u.split("/").slice(-2).join("/");
}

/** Origine appartenant au code d'un FRAMEWORK (pas à Node ni au moteur). */
export function isFrameworkOrigin(origin) {
  return !(origin.startsWith("node:") || origin.startsWith("("));
}

/**
 * Agrège le profil d'un dossier.
 *
 * @returns `{ req, total, idle, self: Map<clé, µs cumulées>, origin: Map,
 *   keyOrigin: Map<clé, origine> }`,
 *   temps en microsecondes CUMULÉES sur la fenêtre (diviser par `req`).
 */
export function analyzeProfile(dir, reqOverride) {
  const file = fs.readdirSync(dir).find((x) => x.endsWith(".cpuprofile"));
  if (!file) throw new Error(`aucun .cpuprofile dans ${dir}`);
  const p = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  let req = Number(reqOverride);
  if (!req) {
    const rps = Number(fs.readFileSync(path.join(dir, "rps"), "utf8"));
    req = Math.round(rps * LOAD_SECONDS);
  }
  if (!req) throw new Error(`nombre de requêtes inconnu pour ${dir}`);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const ts = [];
  let t = p.startTime;
  for (const d of p.timeDeltas) {
    t += d;
    ts.push(t);
  }
  let lastBusy = 0;
  for (let i = 0; i < ts.length; i++) {
    if (byId.get(p.samples[i]).callFrame.functionName !== "(idle)") {
      lastBusy = ts[i];
    }
  }
  const from = lastBusy - LOAD_SECONDS * 1e6;
  const self = new Map();
  const origin = new Map();
  const keyOrigin = new Map();
  let total = 0;
  let idle = 0;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] < from) continue;
    const dt = p.timeDeltas[i + 1] ?? 0;
    const cf = byId.get(p.samples[i]).callFrame;
    if (cf.functionName === "(idle)") {
      idle += dt;
      continue;
    }
    total += dt;
    const key = `${cf.functionName || "(anon)"} ${(cf.url || "").replace(/.*\/(src|node_modules)\//, "$1/")}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
    const o = classify(cf);
    keyOrigin.set(key, o);
    origin.set(o, (origin.get(o) ?? 0) + dt);
  }
  return { req, total, idle, self, origin, keyOrigin };
}

function main() {
  const [dir, reqStr, top = "40"] = process.argv.slice(2);
  if (!dir) {
    console.error("usage : profile-analyze.mjs <dossier> [requêtes] [top]");
    process.exit(2);
  }
  const { req, total, idle, self, origin } = analyzeProfile(dir, reqStr);
  const fmt = (v) =>
    `${(v / req).toFixed(2).padStart(7)} µs/req ${((100 * v) / total).toFixed(1).padStart(5)} %`;
  console.log(
    `CPU actif ${(total / 1e6).toFixed(1)} s, idle ${(idle / 1e6).toFixed(1)} s, ${req} req → ${(total / req).toFixed(1)} µs CPU/req`,
  );
  console.log("\n== par origine ==");
  for (const [k, v] of [...origin].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(fmt(v), k);
  }
  console.log("\n== top temps propre ==");
  for (const [k, v] of [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(top))) {
    console.log(fmt(v), k);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
