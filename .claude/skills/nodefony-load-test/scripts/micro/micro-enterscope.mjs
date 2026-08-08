/**
 * S1 — micro-bench isolé enterScope/leaveScope (baseline lot S, chantier D4).
 *
 * Importe le Container du dist COURANT (dist/node/Container.js — module direct,
 * pas le barrel : zéro dépendance CLI). Trois variantes, du nu au réaliste :
 *   A. enter + leave                    (le squelette du scope)
 *   B. enter + set("context") + leave   (ce que fait CHAQUE requête HTTP)
 *   C. enter + set + get("kernel") ×3 + leave  (mimique lookups ctor Context)
 *
 * Protocole : warmup 2e5, puis 5 séries de 1e6 ops — médiane par variante.
 * Comparer AVANT/APRÈS S2+S3 dans la MÊME fenêtre (rejouer les deux via flip
 * git show + rebuild — un chiffre d'un autre soir ne se compare pas).
 * Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-enterscope.mjs
 */
import { pathToFileURL } from "node:url";

const distUrl = pathToFileURL(
  new URL("../../../../../src/nodefony/dist/node/Container.js", import.meta.url)
    .pathname,
).href;
const mod = await import(distUrl);
const Container = mod.default;

const c = new Container();
// Peupler le container parent comme au boot réel (~40 services posés) : les
// lookups proto-chain et la shape du protoService en dépendent.
for (let i = 0; i < 40; i++) c.set(`svc${i}`, { name: `svc${i}` });
c.set("kernel", { name: "kernel" });
c.set("syslog", { name: "syslog" });
c.addScope("request");

function bench(fn, n) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / n;
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const variants = {
  "A enter+leave": () => {
    const s = c.enterScope("request");
    c.leaveScope(s);
  },
  "B +set(context)": () => {
    const s = c.enterScope("request");
    s.set("context", c);
    c.leaveScope(s);
  },
  "C +3 lookups": () => {
    const s = c.enterScope("request");
    s.set("context", c);
    s.get("kernel");
    s.get("syslog");
    s.get("svc7");
    c.leaveScope(s);
  },
};

// Warmup global (JIT chaud sur tous les chemins)
for (const fn of Object.values(variants)) for (let i = 0; i < 2e5; i++) fn();

const N = 1e6;
const results = {};
for (const [label, fn] of Object.entries(variants)) {
  const runs = [];
  for (let r = 0; r < 5; r++) runs.push(bench(fn, N));
  results[label] = {
    median_ns: +median(runs).toFixed(1),
    runs_ns: runs.map((v) => +v.toFixed(1)),
  };
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
