#!/usr/bin/env node
/**
 * anchor-check.mjs — vérifie l'EXACTITUDE des ancres `fichier:ligne` du corpus doc.
 *
 * doc-lint ne contrôle que la PRÉSENCE d'ancres ; ce check résout chacune contre le
 * code réel (la devise : « la confiance n'exclut pas le contrôle ») :
 *   - FILE_NOT_FOUND  : aucun fichier du repo ne correspond
 *   - LINE_OUT        : la ligne pointée dépasse la fin du fichier
 *   - SUSPECT         : fichier+ligne OK mais AUCUN des symboles cités autour de
 *                       l'ancre n'apparaît dans la fenêtre [début-10 .. fin+15]
 *   - OK              : fichier + ligne + au moins un symbole du contexte retrouvés
 *
 * Usage : node anchor-check.mjs <page.md> [...]   (exit 1 si FILE_NOT_FOUND/LINE_OUT)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const REPO = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();
const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node anchor-check.mjs <page.md> [...]");
  process.exit(2);
}

// Index de tous les .ts/.mjs/.tsx du repo (hors dist/node_modules) pour la
// résolution par suffixe/basename.
const allFiles = execSync(
  `find src docs bin . -maxdepth 1 -type f \\( -name '*.ts' -o -name '*.mjs' -o -name '*.tsx' \\) 2>/dev/null ; ` +
    `find src docs bin -type f \\( -name '*.ts' -o -name '*.mjs' -o -name '*.tsx' \\) ` +
    `-not -path '*/dist/*' -not -path '*/node_modules/*' 2>/dev/null`,
  { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .trim()
  .split("\n")
  .filter(Boolean);

const byBasename = new Map();
for (const f of allFiles) {
  const b = path.basename(f);
  if (!byBasename.has(b)) byBasename.set(b, []);
  byBasename.get(b).push(f);
}

/** La page vit dans <module>/docs/ → prioriser les fichiers du module. */
function moduleRootOf(mdPath) {
  const m = mdPath.match(/(src\/(?:packages\/@nodefony\/[^/]+|nodefony))\//);
  return m ? m[1] : null;
}

function resolveCandidates(ref, moduleRoot) {
  // Chemin avec des dossiers → essai direct puis par suffixe.
  if (ref.includes("/")) {
    for (const base of [
      REPO,
      moduleRoot ? path.join(REPO, moduleRoot) : null,
    ]) {
      if (base && fs.existsSync(path.join(base, ref))) {
        return [path.relative(REPO, path.join(base, ref))];
      }
    }
    const suffix = allFiles.filter(
      (f) => f.endsWith(ref) || f.endsWith("/" + ref),
    );
    if (suffix.length) return suffix;
    // dernier recours : basename du chemin
    ref = path.basename(ref);
  }
  const cands = byBasename.get(ref) ?? [];
  if (cands.length > 1 && moduleRoot) {
    const inModule = cands.filter((f) => f.startsWith(moduleRoot));
    if (inModule.length) return inModule;
  }
  return cands;
}

/** Symboles cités en `backticks` sur la ligne MD autour de l'ancre. */
function contextTokens(mdLine, anchorRaw) {
  const tokens = [...mdLine.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1])
    .filter((t) => t !== anchorRaw && !/\.(ts|mjs|tsx):\d/.test(t))
    .flatMap((t) => t.match(/[A-Za-z_$#][A-Za-z0-9_$]{2,}/g) ?? [])
    .filter(
      (t) =>
        ![
          "ts",
          "mjs",
          "tsx",
          "true",
          "false",
          "null",
          "undefined",
          "string",
          "number",
          "boolean",
          "const",
          "await",
          "async",
          "return",
          "export",
          "import",
          "this",
          "new",
        ].includes(t),
    );
  return [...new Set(tokens)];
}

const ANCHOR_RE =
  /`?([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*\.(?:ts|mjs|tsx)):(\d+)(?:-(\d+))?`?/g;

let total = 0;
const problems = { FILE_NOT_FOUND: [], LINE_OUT: [], SUSPECT: [] };
const fileCache = new Map();
function linesOf(rel) {
  if (!fileCache.has(rel)) {
    fileCache.set(
      rel,
      fs.readFileSync(path.join(REPO, rel), "utf8").split("\n"),
    );
  }
  return fileCache.get(rel);
}

for (const md of args) {
  const moduleRoot = moduleRootOf(md.replace(/^tmp\/doc-corpus\//, ""));
  const mdLines = fs.readFileSync(md, "utf8").split("\n");
  const pageProblems = [];

  mdLines.forEach((line, i) => {
    // Contexte = la ligne + la précédente : prettier wrappe les phrases, l'ancre
    // peut être séparée du symbole qu'elle prouve par un retour à la ligne.
    // SAUF dans un tableau : chaque rangée est autonome — hériter de la rangée
    // du dessus fabriquerait de faux symboles de contexte.
    const isTableRow = line.trimStart().startsWith("|");
    const mdLine = !isTableRow && i > 0 ? mdLines[i - 1] + " " + line : line;
    for (const m of line.matchAll(ANCHOR_RE)) {
      const [raw, ref, startS, endS] = m;
      total++;
      const start = Number(startS);
      const end = endS ? Number(endS) : start;
      const cands = resolveCandidates(ref, moduleRoot);
      if (!cands.length) {
        pageProblems.push({
          kind: "FILE_NOT_FOUND",
          ref: raw.replaceAll("`", ""),
          line: i + 1,
        });
        continue;
      }
      const tokens = contextTokens(mdLine, raw.replaceAll("`", ""));
      let best = null; // "LINE_OUT" < "SUSPECT" < "OK"
      for (const cand of cands) {
        const code = linesOf(cand);
        if (start > code.length) {
          best ??= { kind: "LINE_OUT", cand, max: code.length };
          continue;
        }
        if (!tokens.length) {
          best = { kind: "OK", cand };
          break;
        }
        // Match insensible à la casse : `setFrameAuthorizer` doit satisfaire le
        // token `frameAuthorizer` (conventions camelCase vs nom de propriété).
        const win = code
          .slice(Math.max(0, start - 11), Math.min(code.length, end + 15))
          .join("\n")
          .toLowerCase();
        if (tokens.some((t) => win.includes(t.toLowerCase()))) {
          best = { kind: "OK", cand };
          break;
        }
        if (!best || best.kind === "LINE_OUT")
          best = { kind: "SUSPECT", cand, tokens };
      }
      if (best.kind !== "OK") {
        pageProblems.push({
          kind: best.kind,
          ref: raw.replaceAll("`", ""),
          line: i + 1,
          detail:
            best.kind === "LINE_OUT"
              ? `${best.cand} ne fait que ${best.max} lignes`
              : `${best.cand} — symboles introuvables autour: ${best.tokens.slice(0, 4).join(", ")}`,
        });
      }
    }
  });

  if (pageProblems.length) {
    console.log(`\n❌ ${md}`);
    for (const p of pageProblems) {
      problems[p.kind].push(`${md}: ${p.ref}`);
      console.log(
        `   [${p.kind}] l.${p.line} ${p.ref}${p.detail ? " → " + p.detail : ""}`,
      );
    }
  } else {
    console.log(`✅ ${md}`);
  }
}

const nf = problems.FILE_NOT_FOUND.length;
const lo = problems.LINE_OUT.length;
const su = problems.SUSPECT.length;
console.log(
  `\n${total} ancres — ${total - nf - lo - su} OK · ${su} SUSPECT · ${lo} LINE_OUT · ${nf} FILE_NOT_FOUND`,
);
process.exit(nf + lo ? 1 : 0);
