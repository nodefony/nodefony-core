// Relit un profil `--cpu-prof` pris par `profile-cpu.sh` : temps PROPRE agrégé
// par fonction et par origine (paquet, module node:, natif), FENÊTRÉ sur les
// 20 dernières secondes actives — le profil couvre aussi le démarrage.
// Usage : node profile-analyze.mjs <dossier> <requêtes servies> [top=40]
//   requêtes = RPS × 20 (lu dans la sortie de profile-cpu.sh) → µs par requête.

import fs from "node:fs";
const [dir, reqStr, top = "40"] = process.argv.slice(2);
const f = fs.readdirSync(dir).find((x) => x.endsWith(".cpuprofile"));
const p = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
// timestamps
const ts = [];
let t = p.startTime;
for (const d of p.timeDeltas) {
  t += d;
  ts.push(t);
}
// fenêtre : les 20 dernières secondes actives
let lastBusy = 0;
for (let i = 0; i < ts.length; i++)
  if (byId.get(p.samples[i]).callFrame.functionName !== "(idle)")
    lastBusy = ts[i];
const from = lastBusy - 20e6;
const self = new Map();
let total = 0,
  idle = 0;
const cat = new Map();
const classify = (cf) => {
  const u = cf.url || "";
  if (!u) return cf.functionName.startsWith("(") ? cf.functionName : "(native)";
  if (u.startsWith("node:")) return "node:" + u.slice(5).split("/")[0];
  const m = u.match(/node_modules\/((@[^/]+\/)?[^/]+)/g);
  if (m) return m[m.length - 1].replace("node_modules/", "");
  const s = u.match(/src\/packages\/(@nodefony\/[^/]+)/);
  if (s) return s[1];
  if (u.includes("src/nodefony/")) return "nodefony(core)";
  return u.split("/").slice(-2).join("/");
};
for (let i = 0; i < ts.length; i++) {
  if (ts[i] < from) continue;
  const dt = p.timeDeltas[i + 1] ?? 0;
  const n = byId.get(p.samples[i]);
  const cf = n.callFrame;
  if (cf.functionName === "(idle)") {
    idle += dt;
    continue;
  }
  total += dt;
  const key = `${cf.functionName || "(anon)"} ${(cf.url || "").replace(/.*\/(src|node_modules)\//, "$1/")}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + dt);
  const c = classify(cf);
  cat.set(c, (cat.get(c) ?? 0) + dt);
}
const req = Number(reqStr);
const fmt = (v) =>
  `${(v / req).toFixed(2).padStart(7)} µs/req ${((100 * v) / total).toFixed(1).padStart(5)} %`;
console.log(
  `CPU actif ${(total / 1e6).toFixed(1)} s, idle ${(idle / 1e6).toFixed(1)} s, ${req} req → ${(total / req).toFixed(1)} µs CPU/req`,
);
console.log("\n== par origine ==");
for (const [k, v] of [...cat].sort((a, b) => b[1] - a[1]).slice(0, 25))
  console.log(fmt(v), k);
console.log("\n== top self ==");
for (const [k, v] of [...self]
  .sort((a, b) => b[1] - a[1])
  .slice(0, Number(top)))
  console.log(fmt(v), k);
