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

/** Le fichier existe-t-il à la révision `BASE` ? */
function existsAtBase(target) {
  try {
    execFileSync("git", ["cat-file", "-e", `${BASE}:${target}`], {
      cwd: REPO,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Chemins déplacés depuis la base : nouveau chemin → ancien, selon la
 * détection de renommage de git (`-M`, sur le contenu).
 */
let renames = null;
function renamedFrom(target) {
  if (renames === null) {
    renames = new Map();
    const out = execFileSync(
      "git",
      ["diff", "-M", "--name-status", "--no-ext-diff", BASE],
      { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    for (const line of out.split("\n")) {
      const [status, from, to] = line.split("\t");
      if (status?.startsWith("R") && from && to) renames.set(to, from);
    }
  }
  return renames.get(target) ?? null;
}

/**
 * Blocs `@@ -a,b +c,d @@` du diff `BASE` → arbre de travail, par fichier, ou
 * `null` quand il n'y a RIEN à recaler : le fichier est né après la base.
 *
 * 🔴 Un fichier DÉPLACÉ (`git mv`) n'existe pas à la base sous son nouveau
 * chemin : `git diff BASE -- <nouveau>` le rend comme un fichier NEUF
 * (`@@ -0,0 +1,N @@`), et chaque ancre glissait de N — la longueur du fichier.
 * Vécu : les ancres justes de `mcp.md` décalées de 130 à 570 lignes au
 * déménagement du moteur MCP. Le diff se prend donc depuis l'ANCIEN chemin.
 */
const hunksCache = new Map();
function hunksOf(target) {
  if (hunksCache.has(target)) return hunksCache.get(target);
  let paths = [target];
  if (!existsAtBase(target)) {
    const from = renamedFrom(target);
    if (from === null) {
      // Né après la base : aucune ancre n'y était juste « à la base », il n'y a
      // pas de décalage à appliquer — on n'invente pas un diff.
      hunksCache.set(target, null);
      return null;
    }
    paths = [from, target];
  }
  let out = "";
  try {
    out = execFileSync(
      "git",
      ["diff", "-U0", "-M", "--no-ext-diff", BASE, "--", ...paths],
      { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    console.error(
      `anchor-remap : git diff ${BASE} -- ${paths.join(" ")} — ${e.message}`,
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
  const hunks = hunksOf(target);
  if (hunks === null) return n;
  let offset = 0;
  for (const { a, b, d } of hunks) {
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

/** La page telle qu'elle était à la base, ou `null` si elle n'existait pas. */
const basePages = new Map();
function pageAtBase(md) {
  if (basePages.has(md)) return basePages.get(md);
  let text = null;
  try {
    text = execFileSync("git", ["show", `${BASE}:${md}`], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    text = null;
  }
  basePages.set(md, text);
  return text;
}

/**
 * L'ancre figurait-elle DÉJÀ dans la page à la base ? Comparée par nom de
 * fichier et ligne (`progress.ts:75`), parce qu'un déménagement réécrit le
 * chemin qui la précède sans changer ce qu'elle désigne.
 *
 * 🔴 Sinon elle a été ÉCRITE ou RECALÉE depuis la base — donc déjà à la
 * numérotation de l'arbre — et la décaler encore la ferait glisser deux fois.
 * Vécu : `servers.md`, recalé et commité, aurait glissé de 1876 à 1907 au
 * passage suivant ; la garde « page non commitée » ne voit pas un commit.
 */
function presentAtBase(job) {
  const page = pageAtBase(job.md);
  if (page === null) return false;
  const token = `${path.basename(job.ref)}:${job.start}`;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w.-])${esc}(?![\\d])`, "m").test(page);
}

const edits = new Map(); // md → [{ mdLine, from, to }]
const unresolved = [];
let unchanged = 0;
let writtenAfterBase = 0;
for (const job of jobs) {
  if (!presentAtBase(job)) {
    writtenAfterBase++;
    continue;
  }
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
    `${unchanged} déjà juste(s) pour le diff · ${writtenAfterBase} écrite(s) après la base (laissées) · ` +
    `${unresolved.length} à relire`,
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
