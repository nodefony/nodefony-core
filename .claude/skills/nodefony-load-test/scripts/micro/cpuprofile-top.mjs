// Lecture d'un .cpuprofile : temps propre par fonction, et temps inclusif par fonction.
// Usage : node .claude/skills/nodefony-load-test/scripts/micro/cpuprofile-top.mjs <fichier.cpuprofile> [n]
import fs from "node:fs";
const prof = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const N = Number(process.argv[3] ?? 25);
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes)
  for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
for (const s of prof.samples) self.set(s, (self.get(s) ?? 0) + 1);
const total = prof.samples.length;
const key = (n) =>
  `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber + 1}`;
const selfBy = new Map(),
  inclBy = new Map();
for (const [id, cnt] of self) {
  const n = byId.get(id);
  selfBy.set(key(n), (selfBy.get(key(n)) ?? 0) + cnt);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const k = key(byId.get(cur));
    if (seen.has(k)) continue;
    seen.add(k);
    inclBy.set(k, (inclBy.get(k) ?? 0) + cnt);
  }
}
const pct = (c) => ((100 * c) / total).toFixed(1).padStart(5) + " %";
const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, N);
console.log(`échantillons : ${total}\n── propre`);
for (const [k, c] of top(selfBy)) console.log(pct(c), k);
console.log("── inclusif");
for (const [k, c] of top(inclBy)) console.log(pct(c), k);
