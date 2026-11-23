// A/B ENTRELACÉ du banc du terminal (#896) : un run par dist, à tour de rôle,
// pour qu'une dérive de la machine pèse sur tous les camps à parts égales.
// Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-supervisor-terminal-interleaved.mjs <tours> <scénarios> label=dist [label=dist…]
//   scénarios : liste "frame,bar,scroll,ingest" (voir supervisor-terminal-ab.mjs)
import { execFileSync } from "node:child_process";
import path from "node:path";
const [rounds, only, ...camps] = process.argv.slice(2);
const parsed = camps.map((c) => {
  const [label, dist] = c.split("=");
  return { label, dist };
});
const all = Object.fromEntries(parsed.map((c) => [c.label, {}]));
for (let r = 0; r < Number(rounds); r++) {
  for (const c of r % 2 ? [...parsed].reverse() : parsed) {
    const out = execFileSync(
      process.execPath,
      [
        "--expose-gc",
        path.join(import.meta.dirname, "micro-supervisor-terminal-ab.mjs"),
        c.label,
        c.dist,
        "1",
        only,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    for (const [k, v] of Object.entries(JSON.parse(out)))
      if (typeof v === "number" && k !== "runs")
        (all[c.label][k] ??= []).push(v);
  }
  process.stderr.write(`tour ${r + 1}/${rounds}\n`);
}
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2
    ? s[s.length >> 1]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const ref = parsed[0].label;
const keys = Object.keys(all[ref]).filter((k) => !/bytes|writes/.test(k));
console.log(
  "métrique".padEnd(30) +
    parsed.map((c) => c.label.padStart(12)).join("") +
    "   écart/" +
    ref,
);
for (const k of keys) {
  const m = parsed.map((c) => med(all[c.label][k]));
  console.log(
    k.padEnd(30) +
      m
        .map((v) =>
          (v < 100 ? v.toFixed(2) : String(Math.round(v))).padStart(12),
        )
        .join("") +
      "   " +
      m
        .slice(1)
        .map((v) => (((v - m[0]) / m[0]) * 100).toFixed(1) + "%")
        .join("  "),
  );
}
