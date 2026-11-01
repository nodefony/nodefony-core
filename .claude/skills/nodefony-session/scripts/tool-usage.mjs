#!/usr/bin/env node
/**
 * tool-usage.mjs — ce que les sorties d'outils coûtent, et comment on lit le code.
 *
 * Le poste de dépense d'une session n'est pas ce que l'agent écrit : c'est ce
 * qu'il RELIT. Chaque sortie d'outil reste dans le contexte et se repaie à
 * chaque tour suivant. Ce module la mesure dans les transcripts du projet :
 * taille × nombre de tours qui la relisent, par famille d'outil.
 *
 * Il rend aussi la LECTURE DE CODE d'une session : appels `show-symbol`, tranches
 * refusées par la garde, et surtout les tranches PASSÉES. La garde (`code-slice.mjs`,
 * lue ici telle quelle) refuse toute tranche de code : il n'y a donc plus de réflexe à
 * surveiller, seulement un trou de garde à signaler — une tranche passée, c'est une
 * forme que la règle ne reconnaît pas encore, à lui apprendre.
 *
 * @usage node tool-usage.mjs            # lecture de code de la session COURANTE
 * @usage node tool-usage.mjs --all      # coût par famille d'outil, toutes sessions
 */
import fs from "node:fs";
import {
  bashSliceRefusal,
  readSliceRefusal,
} from "../../../hooks/code-slice.mjs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Dossier des transcripts Claude Code du dépôt (même règle de nom que la mémoire). */
export function transcriptsDir(root) {
  return path.join(
    os.homedir(),
    ".claude",
    "projects",
    root.replace(/[^a-zA-Z0-9]/gu, "-"),
  );
}

/** Famille d'un appel d'outil : l'outil, ou pour Bash le programme réellement lancé. */
export function familyOf(name, input) {
  if (name !== "Bash") return name;
  const c = String(input?.command ?? "")
    .replace(/^\s*(cd [^&;]+(&&|;)\s*)+/g, "")
    .replace(/^\s*([A-Z_]+=\S+\s+)+/, "")
    .trim();
  const [a = "?", b, x] = c.split(/\s+/);
  const base = (s) => path.basename(String(s ?? "")).replace(/["']/g, "");
  if (a === "node") return `node ${base(b)}`;
  if (a === "npm" && b === "run") return `npm run ${x}`;
  if (a === "npx" || a === "git" || a === "gh") return `${a} ${b}`;
  return a.includes("/") ? base(a) : a;
}

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("")
      : "";

/**
 * Analyse un transcript : chaque sortie d'outil avec sa famille, sa taille et
 * le nombre de tours qui la relisent, plus la lecture de code de la session.
 *
 * @param file - chemin d'un `.jsonl` de session.
 */
export function analyseTranscript(file) {
  const calls = new Map();
  const results = [];
  const seen = new Set();
  const reading = { showSymbol: 0, refused: 0, passed: [] };
  /** Appels qui lisent du code par tranche, en attente de leur résultat. */
  const slices = new Map();
  let turns = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    if (o.type === "assistant") {
      if (o.message.id && !seen.has(o.message.id)) {
        seen.add(o.message.id);
        turns++;
      }
      for (const p of content) {
        if (p.type !== "tool_use") continue;
        calls.set(p.id, familyOf(p.name, p.input));
        const input = p.input ?? {};
        if (p.name === "Read") {
          const file = String(input.file_path ?? "");
          if (
            readSliceRefusal(
              file,
              String(input.offset ?? ""),
              String(input.limit ?? ""),
            )
          )
            slices.set(p.id, `Read ${file}`);
        }
        if (p.name !== "Bash") continue;
        const cmd = String(input.command ?? "");
        if (cmd.includes("show-symbol.mjs")) reading.showSymbol++;
        if (bashSliceRefusal(cmd)) slices.set(p.id, cmd);
      }
    } else if (o.type === "user") {
      for (const p of content) {
        if (p.type !== "tool_result") continue;
        const t = textOf(p.content);
        const slice = slices.get(p.tool_use_id);
        if (slice !== undefined) {
          if (t.includes("REFUS —")) reading.refused++;
          else reading.passed.push(slice.slice(0, 120));
        }
        results.push({
          family: calls.get(p.tool_use_id) ?? "?",
          tokens: Math.ceil(t.length / 4),
          at: turns,
          error: Boolean(p.is_error),
        });
      }
    }
  }
  for (const r of results) r.reread = r.tokens * Math.max(0, turns - r.at);
  return { turns, results, reading };
}

/** La ligne de lecture de code, telle que `session:end` l'imprime. */
export function readingLine({ reading: r }) {
  const line = `Lecture de code : ${r.showSymbol} show-symbol · ${r.refused} tranche(s) refusée(s) par la garde`;
  if (!r.passed.length) return line;
  return (
    `${line}\n🚨 ${r.passed.length} tranche(s) de code PASSÉE(S) — trou de la garde, à apprendre à .claude/hooks/code-slice.mjs :\n` +
    r.passed.map((c) => `   ${c}`).join("\n")
  );
}

/** Le transcript le plus récemment écrit : celui de la session en cours. */
export function currentTranscript(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));
  return (
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ??
    null
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const dir = transcriptsDir(root);
  if (!process.argv.includes("--all")) {
    const f = currentTranscript(dir);
    console.log(f ? readingLine(analyseTranscript(f)) : "aucun transcript");
  } else {
    const fam = new Map();
    const total = {
      showSymbol: 0,
      slices: 0,
      sliceLines: 0,
      bigSlices: 0,
      rawCats: 0,
      unboundedReads: 0,
      refused: 0,
    };
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    for (const f of files) {
      const a = analyseTranscript(path.join(dir, f));
      for (const k of Object.keys(total)) total[k] += a.reading[k];
      for (const r of a.results) {
        const s = fam.get(r.family) ?? {
          calls: 0,
          tokens: 0,
          reread: 0,
          errors: 0,
        };
        s.calls++;
        s.tokens += r.tokens;
        s.reread += r.reread;
        s.errors += r.error ? 1 : 0;
        fam.set(r.family, s);
      }
    }
    const rows = [...fam.entries()].sort((a, b) => b[1].reread - a[1].reread);
    const sum = rows.reduce((s, [, v]) => s + v.reread, 0);
    const M = (n) => `${(n / 1e6).toFixed(1)}M`;
    console.log(
      `${files.length} sessions · relecture des sorties d'outils ≈ ${M(sum)} tokens (sans compactage ni cache : la PART compte, pas le total)`,
    );
    console.log(
      `${"famille".padEnd(30)}appels  sortie   relue   part  erreurs`,
    );
    for (const [k, v] of rows.slice(0, 30))
      console.log(
        `${k.slice(0, 29).padEnd(30)}${String(v.calls).padStart(6)}${M(v.tokens).padStart(8)}${M(v.reread).padStart(8)}${((100 * v.reread) / sum).toFixed(1).padStart(6)}%${String(v.errors).padStart(8)}`,
      );
    console.log(`\n${readingLine({ reading: total })}`);
  }
}
