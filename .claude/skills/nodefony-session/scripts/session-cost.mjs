// Agrège la consommation réelle des transcripts Claude Code du projet.
// Dédup par messageId (les JSONL répètent la même réponse à plusieurs lignes).
//
// `@usage` node .claude/skills/nodefony-session/scripts/session-cost.mjs
//            → tout le projet, par mois et par modèle
// `@usage` node .claude/skills/nodefony-session/scripts/session-cost.mjs --session <id|préfixe|latest>
//            → UNE session : le principal et chacun de ses sous-agents (modèle, réponses,
//              contexte relu, pic de contexte, coût) — de quoi voir un agent qui dérive
// `--root <dossier>` remplace `~/.claude/projects` (auto-contrôle).
import {
  readdirSync,
  statSync,
  existsSync,
  readFileSync,
  createReadStream,
} from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

/**
 * Tarif `[input, output]` en $ par million de tokens, par le plus long préfixe connu
 * (`claude-fable-5-1` → `claude-fable-5`), puis par famille ; `null` si inconnu.
 */
export const priceOf = (m) => {
  if (!m) return null;
  const base = m.replace(/\[1m\]$/, "").replace(/-\d{8}$/, "");
  const key = Object.keys(PRICES)
    .filter((k) => base === k || base.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (key) return PRICES[key];
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

const blank = () => ({
  in: 0,
  out: 0,
  w5: 0,
  w1h: 0,
  read: 0,
  cost: 0,
  msgs: 0,
  sidechain: 0,
  peak: 0,
  // coût réparti au tarif RÉEL de chaque réponse (pas au tarif d'un seul modèle)
  costRead: 0,
  costWrite: 0,
  costOut: 0,
  costIn: 0,
  models: new Set(),
});

/**
 * Ajoute les réponses d'un transcript aux agrégats que `targets` désigne, en sautant
 * celles déjà vues dans `seen`.
 *
 * @param file - transcript `.jsonl`
 * @param targets - `({ timestamp, model }) => agrégats` qui reçoivent CETTE réponse
 * @param seen - identifiants de réponse déjà comptés (partagé entre fichiers)
 * @returns `{ lines, counted, dupes, unknownModels }` de ce fichier
 */
export async function accumulate(file, targets, seen) {
  const stats = { lines: 0, counted: 0, dupes: 0, unknownModels: new Set() };
  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    stats.lines++;
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
        stats.dupes++;
        continue;
      }
      seen.add(key);
    }
    const model = o.message?.model ?? "?";
    const price = priceOf(model);
    if (!price) stats.unknownModels.add(model);
    const [pin, pout] = price ?? [5, 25];

    const cc = u.cache_creation ?? {};
    const w1h = cc.ephemeral_1h_input_tokens ?? 0;
    const w5 =
      cc.ephemeral_5m_input_tokens ??
      Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
    const read = u.cache_read_input_tokens ?? 0;
    const inp = u.input_tokens ?? 0;
    const out = u.output_tokens ?? 0;

    const costRead = (read * pin * 0.1) / 1e6;
    const costWrite = (w5 * pin * 1.25 + w1h * pin * 2) / 1e6;
    const costOut = (out * pout) / 1e6;
    const costIn = (inp * pin) / 1e6;

    for (const a of targets({ timestamp: o.timestamp ?? "", model })) {
      a.in += inp;
      a.out += out;
      a.w5 += w5;
      a.w1h += w1h;
      a.read += read;
      a.costRead += costRead;
      a.costWrite += costWrite;
      a.costOut += costOut;
      a.costIn += costIn;
      a.cost += costRead + costWrite + costOut + costIn;
      a.msgs++;
      // contexte que le modèle a lu pour CETTE réponse : sa croissance trahit la dérive
      a.peak = Math.max(a.peak, inp + read + w5 + w1h);
      a.models.add(model);
      if (o.isSidechain) a.sidechain++;
    }
    stats.counted++;
  }
  return stats;
}

const projectDirs = (root) =>
  readdirSync(root).filter((d) => d.includes("nodefony"));

/**
 * Trouve le transcript d'une session et ceux de ses sous-agents.
 *
 * @param root - dossier des projets (`~/.claude/projects`)
 * @param id - identifiant complet, préfixe non ambigu, ou `latest` (le plus récent modifié)
 * @returns `{ id, main, subagents: [{ file, label }] }`
 * @throws Quand aucune session ne correspond, ou qu'un préfixe en désigne plusieurs
 */
export function findSession(root, id) {
  const candidates = [];
  for (const d of projectDirs(root)) {
    for (const e of readdirSync(path.join(root, d))) {
      if (e.endsWith(".jsonl")) candidates.push(path.join(root, d, e));
    }
  }
  let matches;
  if (id === "latest") {
    matches = candidates
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      .slice(0, 1);
  } else {
    matches = candidates.filter((f) =>
      path.basename(f, ".jsonl").startsWith(id),
    );
  }
  if (matches.length === 0)
    throw new Error(`aucune session ne correspond à « ${id} »`);
  if (matches.length > 1) {
    throw new Error(
      `« ${id} » désigne ${matches.length} sessions : ${matches.map((f) => path.basename(f, ".jsonl")).join(", ")}`,
    );
  }
  const main = matches[0];
  const sid = path.basename(main, ".jsonl");
  const subDir = path.join(path.dirname(main), sid, "subagents");
  const subagents = [];
  if (existsSync(subDir)) {
    for (const e of readdirSync(subDir).sort()) {
      if (!e.endsWith(".jsonl")) continue;
      const file = path.join(subDir, e);
      const metaFile = file.replace(/\.jsonl$/, ".meta.json");
      let label = path.basename(e, ".jsonl");
      if (existsSync(metaFile)) {
        try {
          const meta = JSON.parse(readFileSync(metaFile, "utf8"));
          const desc =
            typeof meta.description === "string" ? meta.description : label;
          label =
            typeof meta.agentType === "string"
              ? `${desc} (${meta.agentType})`
              : desc;
        } catch {
          // méta illisible : le nom du fichier suffit à identifier l'agent
        }
      }
      subagents.push({ file, label });
    }
  }
  return { id: sid, main, subagents };
}

/**
 * Coût d'UNE session : une ligne pour le principal, une par sous-agent, et le total.
 *
 * @returns `{ id, rows: [{ label, ...agrégat }], total, unknownModels }`
 */
export async function summarizeSession(root, id) {
  const s = findSession(root, id);
  const seen = new Set();
  const total = blank();
  const unknownModels = new Set();
  const rows = [];
  for (const { file, label } of [
    { file: s.main, label: "principal" },
    ...s.subagents,
  ]) {
    const a = blank();
    const st = await accumulate(file, () => [a, total], seen);
    for (const m of st.unknownModels) unknownModels.add(m);
    rows.push({ label, ...a });
  }
  return { id: s.id, rows, total, unknownModels };
}

const M = (n) => (n / 1e6).toFixed(2);
const K = (n) => `${Math.round(n / 1000)}k`;
const short = (models) =>
  [...models].map((m) => m.replace(/^claude-/, "")).join("+") || "—";

async function printSession(root, id) {
  const {
    id: sid,
    rows,
    total,
    unknownModels,
  } = await summarizeSession(root, id);
  console.log(`session ${sid} — principal + ${rows.length - 1} sous-agent(s)`);
  if (unknownModels.size)
    console.log(`⚠ modèles au tarif deviné : ${[...unknownModels].join(", ")}`);
  console.log(
    `${"transcript".padEnd(48)} | ${"modèle".padEnd(12)} | rép. |  output |  cache W |  cache R | pic ctx |  coût $`,
  );
  for (const r of [...rows, { label: "TOTAL", ...total }]) {
    console.log(
      `${r.label.slice(0, 48).padEnd(48)} | ${short(r.models).slice(0, 12).padEnd(12)} | ${String(r.msgs).padStart(4)} | ${M(r.out).padStart(6)}M | ${M(r.w5 + r.w1h).padStart(7)}M | ${M(r.read).padStart(7)}M | ${K(r.peak).padStart(7)} | ${r.cost.toFixed(2).padStart(7)}`,
    );
  }
}

async function printProject(root) {
  const dirs = projectDirs(root);
  const seen = new Set();
  const byMonth = new Map();
  const byModel = new Map();
  const unknownModels = new Set();
  const T = blank();
  const slot = (map, k) => {
    if (!map.has(k)) map.set(k, blank());
    return map.get(k);
  };
  const targets = ({ timestamp, model }) => [
    T,
    slot(byMonth, timestamp.slice(0, 7) || "?"),
    slot(byModel, model),
  ];
  let lines = 0,
    counted = 0,
    dupes = 0,
    bytes = 0;
  for (const d of dirs) {
    for (const f of jsonlFiles(path.join(root, d))) {
      bytes += statSync(f).size;
      const st = await accumulate(f, targets, seen);
      lines += st.lines;
      counted += st.counted;
      dupes += st.dupes;
      for (const m of st.unknownModels) unknownModels.add(m);
    }
  }

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
  for (const k of [...byMonth.keys()].sort()) {
    const a = byMonth.get(k);
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
    "relecture de contexte (cache read)": T.costRead,
    "écriture de cache": T.costWrite,
    "production (output)": T.costOut,
    "input non caché": T.costIn,
  };
  const sum = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
  for (const [k, v] of Object.entries(parts))
    console.log(
      `${k.padEnd(36)} ${((v / sum) * 100).toFixed(1).padStart(5)} %`,
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = opt("--root") ?? path.join(os.homedir(), ".claude", "projects");
  const session = opt("--session");
  try {
    if (argv.includes("--session"))
      await printSession(root, session ?? "latest");
    else await printProject(root);
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
