// Recale les ancres `fichier.ts:N` d'une page de doc par le GIT DIFF, pas par
// symbole : une ancre juste à la révision `--base` est décalée d'exactement le
// nombre de lignes que le code a gagné ou perdu AVANT elle. Déterministe — là
// où `anchor-fix.mjs` doit deviner une ligne à partir des mots qui l'entourent
// (un en-tête `Retry-After`, un `try`, un littéral ne se retrouvent pas).
//
// Entrée : la sortie d'anchor-check.mjs --all (stdin) — c'est lui qui RÉSOUT
// chaque ancre vers son fichier, seule règle de résolution. Lignes lues :
// SUSPECT, LINE_OUT et ANCHOR (`--all` : les ancres jugées justes, qui peuvent
// avoir glissé sur une ligne plausible). Seules celles qui visent un fichier
// modifié depuis la base bougent. Sortie : édite en place avec `--apply`.
//
// Règle : une ancre tombée DANS un bloc modifié n'est jamais devinée — la ligne
// qu'elle visait a pu changer de sens ; elle est signalée, à relire.
//
// Usage :
//   node anchor-check.mjs --all <pages…> | node anchor-remap.mjs <repo> --base <rév> [--apply]
//   <rév> : la révision où les ancres étaient JUSTES (le dernier vert de CI,
//   souvent `origin/dev` ou le commit d'avant la série qui a bougé le code).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(process.argv[2] ?? process.cwd());
const APPLY = process.argv.includes("--apply");
const baseAt = process.argv.indexOf("--base");
const BASE = baseAt !== -1 ? process.argv[baseAt + 1] : undefined;
if (!BASE) {
  console.error(
    "anchor-remap : --base <rév> requis — la révision où les ancres étaient justes (ex. origin/dev).",
  );
  process.exit(2);
}

const report = fs.readFileSync(0, "utf8").split("\n");
const RE =
  /^\s+\[(SUSPECT|LINE_OUT|ANCHOR)\] l\.(\d+) ([^ ]+):(\d+)(?:-(\d+))? → ([^ ]+)/;
let currentMd = null;
const jobs = [];
// Une page passée deux fois à anchor-check rend deux fois ses ancres : une
// seule tâche par ancre, sinon la seconde ne retrouve plus le texte remplacé.
const seen = new Set();
for (const line of report) {
  const md = line.match(/^(?:❌|✅) (.+\.md)$/);
  if (md) {
    currentMd = md[1];
    continue;
  }
  const m = line.match(RE);
  const key = m && `${currentMd}:${m[2]}:${m[3]}:${m[4]}`;
  if (m && currentMd && !seen.has(key)) {
    seen.add(key);
    jobs.push({
      md: currentMd,
      mdLine: Number(m[2]),
      ref: m[3],
      start: Number(m[4]),
      end: m[5] === undefined ? null : Number(m[5]),
      target: m[6],
    });
  }
}

/** Blocs `@@ -a,b +c,d @@` du diff `BASE` → arbre de travail, par fichier. */
const hunksCache = new Map();
function hunksOf(target) {
  if (hunksCache.has(target)) return hunksCache.get(target);
  let out = "";
  try {
    out = execFileSync("git", ["diff", "-U0", BASE, "--", target], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    console.error(
      `anchor-remap : git diff ${BASE} -- ${target} — ${e.message}`,
    );
    process.exit(2);
  }
  const hunks = [];
  for (const m of out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm))
    hunks.push({
      a: Number(m[1]),
      b: m[2] === undefined ? 1 : Number(m[2]),
      d: m[4] === undefined ? 1 : Number(m[4]),
    });
  hunksCache.set(target, hunks);
  return hunks;
}

/**
 * Ligne `n` de la base → ligne de l'arbre de travail, ou `null` si elle tombe
 * dans un bloc modifié ou supprimé (à relire, jamais devinée).
 */
function remap(target, n) {
  let offset = 0;
  for (const { a, b, d } of hunksOf(target)) {
    if (b === 0) {
      // insertion APRÈS la ligne `a` de la base
      if (n > a) offset += d;
      continue;
    }
    if (n < a) break;
    if (n <= a + b - 1) return null;
    offset += d - b;
  }
  return n + offset;
}

const edits = new Map(); // md → [{ mdLine, from, to }]
const unresolved = [];
let unchanged = 0;
for (const job of jobs) {
  const start = remap(job.target, job.start);
  const end = job.end === null ? null : remap(job.target, job.end);
  if (start === null || (job.end !== null && end === null)) {
    unresolved.push(job);
    continue;
  }
  const from = `${job.ref}:${job.start}${job.end === null ? "" : `-${job.end}`}`;
  const to = `${job.ref}:${start}${end === null ? "" : `-${end}`}`;
  if (from === to) {
    unchanged++;
    continue;
  }
  if (!edits.has(job.md)) edits.set(job.md, []);
  edits.get(job.md).push({ mdLine: job.mdLine, from, to });
}

/**
 * Une page déjà modifiée depuis le dernier commit a pu être remappée : ses
 * ancres ne sont plus à la numérotation de la base, et un second passage les
 * décalerait DEUX fois. On ne remappe qu'une page propre (`git diff` vide).
 */
function isPristine(md) {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", md], { cwd: REPO });
    return true;
  } catch {
    return false;
  }
}

let applied = 0;
const dirty = [];
for (const [md, list] of edits) {
  if (!isPristine(md)) {
    dirty.push(md);
    continue;
  }
  const file = path.join(REPO, md);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (const { mdLine, from, to } of list) {
    const i = mdLine - 1;
    // Remplacement EXACT d'une ancre entière : `http-kernel.ts:12` ne doit pas
    // mordre sur `http-kernel.ts:120`.
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${esc}(?![\\d-])`);
    if (!re.test(lines[i] ?? "")) {
      unresolved.push({
        md,
        mdLine,
        ref: from,
        note: "ancre introuvable sur la ligne",
      });
      continue;
    }
    console.log(`  ${md}:${mdLine}  ${from} → ${to}`);
    lines[i] = lines[i].replace(re, to);
    applied++;
  }
  if (APPLY) fs.writeFileSync(file, lines.join("\n"));
}

console.log(
  `\n${applied} ancre(s) ${APPLY ? "recalée(s)" : "à recaler (relancer avec --apply)"} · ` +
    `${unchanged} déjà juste(s) pour le diff · ${unresolved.length} à relire`,
);
for (const md of dirty)
  console.log(
    `  refusé : ${md} — page déjà modifiée depuis le dernier commit ; ses ancres ne` +
      ` sont peut-être plus à la numérotation de la base (double décalage). Repartir` +
      ` d'une page propre, ou recaler à la main.`,
  );
for (const u of unresolved)
  console.log(
    `  à relire : ${u.md}:${u.mdLine}  ${u.ref}${u.start ? `:${u.start}` : ""}` +
      ` — ${u.note ?? "la ligne visée est DANS un bloc modifié depuis la base"}`,
  );
process.exit(unresolved.length > 0 || dirty.length > 0 ? 1 : 0);
