// Agrège la consommation réelle de tous les transcripts Claude Code du projet.
// Dédup par messageId (les JSONL répètent la même réponse à plusieurs lignes).
import { readdirSync, statSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

const ROOT = "/Users/cci/.claude/projects";
const PRICES = {
  // [input, output] $ / M tokens
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-opus-4-5": [5, 25],
  "claude-opus-4-1": [15, 75],
  "claude-opus-4-0": [15, 75],
  "claude-fable-5": [10, 50],
  "claude-mythos-5": [10, 50],
  "claude-sonnet-5": [3, 15],
  "claude-sonnet-4-6": [3, 15],
  "claude-sonnet-4-5": [3, 15],
  "claude-haiku-4-5": [1, 5],
};
const priceOf = (m) => {
  if (!m) return null;
  const base = m.replace(/\[1m\]$/, "").replace(/-\d{8}$/, "");
  if (PRICES[base]) return PRICES[base];
  if (base.includes("opus")) return [5, 25];
  if (base.includes("sonnet")) return [3, 15];
  if (base.includes("haiku")) return [1, 5];
  return null;
};

function* jsonlFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

const dirs = readdirSync(ROOT).filter((d) => d.includes("nodefony"));
const seen = new Set();
const byMonth = new Map();
const byModel = new Map();
const unknownModels = new Set();
let lines = 0,
  counted = 0,
  dupes = 0,
  bytes = 0;

const blank = () => ({
  in: 0,
  out: 0,
  w5: 0,
  w1h: 0,
  read: 0,
  cost: 0,
  msgs: 0,
  sidechain: 0,
});

for (const d of dirs) {
  for (const f of jsonlFiles(path.join(ROOT, d))) {
    bytes += statSync(f).size;
    const rl = createInterface({
      input: createReadStream(f),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      lines++;
      if (!line.includes('"usage"')) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const u = o?.message?.usage;
      if (!u || typeof u.output_tokens !== "number") continue;
      const key = o.message?.id ?? o.messageId ?? o.requestId ?? o.uuid;
      if (key) {
        if (seen.has(key)) {
          dupes++;
          continue;
        }
        seen.add(key);
      }
      const model = o.message?.model ?? "?";
      const price = priceOf(model);
      if (!price) unknownModels.add(model);
      const [pin, pout] = price ?? [5, 25];

      const cc = u.cache_creation ?? {};
      const w1h = cc.ephemeral_1h_input_tokens ?? 0;
      const w5 =
        cc.ephemeral_5m_input_tokens ??
        Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
      const read = u.cache_read_input_tokens ?? 0;
      const inp = u.input_tokens ?? 0;
      const out = u.output_tokens ?? 0;

      const cost =
        (inp * pin +
          out * pout +
          w5 * pin * 1.25 +
          w1h * pin * 2 +
          read * pin * 0.1) /
        1e6;

      const month = (o.timestamp ?? "").slice(0, 7) || "?";
      for (const [map, k] of [
        [byMonth, month],
        [byModel, model],
      ]) {
        if (!map.has(k)) map.set(k, blank());
        const a = map.get(k);
        a.in += inp;
        a.out += out;
        a.w5 += w5;
        a.w1h += w1h;
        a.read += read;
        a.cost += cost;
        a.msgs++;
        if (o.isSidechain) a.sidechain++;
      }
      counted++;
    }
  }
}

const M = (n) => (n / 1e6).toFixed(2);
const money = (n) => n.toFixed(0);

console.log(
  `périmètre : ${dirs.length} dossiers projet, ${(bytes / 2 ** 30).toFixed(2)} Gio, ${lines.toLocaleString("fr-FR")} lignes`,
);
console.log(
  `réponses comptées : ${counted.toLocaleString("fr-FR")} — doublons écartés : ${dupes.toLocaleString("fr-FR")}`,
);
if (unknownModels.size)
  console.log(`⚠ modèles au tarif deviné : ${[...unknownModels].join(", ")}`);

console.log("\n=== PAR MOIS ===");
console.log(
  "mois      | réponses |   output |  cache W |   cache R |    coût $ | dont sous-agents",
);
let T = blank();
for (const k of [...byMonth.keys()].sort()) {
  const a = byMonth.get(k);
  for (const f of [
    "in",
    "out",
    "w5",
    "w1h",
    "read",
    "cost",
    "msgs",
    "sidechain",
  ])
    T[f] += a[f];
  console.log(
    `${k.padEnd(9)} | ${String(a.msgs).padStart(8)} | ${M(a.out).padStart(8)}M | ${M(a.w5 + a.w1h).padStart(8)}M | ${M(a.read).padStart(9)}M | ${money(a.cost).padStart(9)} | ${a.sidechain}`,
  );
}
console.log(
  `${"TOTAL".padEnd(9)} | ${String(T.msgs).padStart(8)} | ${M(T.out).padStart(8)}M | ${M(T.w5 + T.w1h).padStart(8)}M | ${M(T.read).padStart(9)}M | ${money(T.cost).padStart(9)} | ${T.sidechain}`,
);

console.log("\n=== PAR MODÈLE ===");
for (const [k, a] of [...byModel.entries()].sort(
  (x, y) => y[1].cost - x[1].cost,
))
  console.log(
    `${k.padEnd(34)} ${String(a.msgs).padStart(7)} rép.  ${money(a.cost).padStart(8)} $`,
  );

console.log("\n=== RÉPARTITION DU COÛT TOTAL ===");
const parts = {
  "relecture de contexte (cache read)": T.read * 5 * 0.1,
  "écriture de cache": T.w5 * 5 * 1.25 + T.w1h * 5 * 2,
  "production (output)": T.out * 25,
  "input non caché": T.in * 5,
};
const sum = Object.values(parts).reduce((a, b) => a + b, 0);
for (const [k, v] of Object.entries(parts))
  console.log(`${k.padEnd(36)} ${((v / sum) * 100).toFixed(1).padStart(5)} %`);
