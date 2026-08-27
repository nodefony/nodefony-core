#!/usr/bin/env node
/**
 * Remplace, dans le corps des tickets ouverts, les anglicismes qui ont un équivalent français.
 *
 * N'agit QUE hors du code : blocs clôturés, code entre accents graves, liens et URL sont
 * découpés et laissés intacts — un identifiant traduit est un identifiant faux.
 *
 * Source unique des couples : `../references/lexique.md`, section « Anglicismes ».
 *
 *   node scripts/francise.mjs            # diff seul, n'écrit rien
 *   node scripts/francise.mjs --write    # applique via `gh issue edit`
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Les suites citées, protégées comme du code — cf « Ne jamais traduire » du lexique. */
const readFrozen = () => {
  const src = fs.readFileSync(
    path.join(HERE, "..", "references", "lexique.md"),
    "utf8",
  );
  const i = src.indexOf("## Ne jamais traduire");
  if (i < 0) return [];
  return src
    .slice(i)
    .split("\n")
    .map((l) => l.match(/^- (.+)$/)?.[1]?.trim())
    .filter(Boolean);
};

const readPairs = () => {
  const src = fs.readFileSync(
    path.join(HERE, "..", "references", "lexique.md"),
    "utf8",
  );
  const section = src.slice(
    src.indexOf("## Anglicismes"),
    src.indexOf("## Ne jamais traduire") >>> 0 || undefined,
  );
  const pairs = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^- (.+?) → (.+)$/);
    if (m) pairs.push({ en: m[1].trim(), fr: m[2].trim() });
  }
  if (!pairs.length)
    throw new Error("references/lexique.md : section « Anglicismes » vide");
  // les formes longues d'abord (« breaking change » avant « change »)
  return pairs.sort((a, b) => b.en.length - a.en.length);
};

/** Découpe en segments ; `code: true` = à ne jamais toucher. */
const segments = (text, frozen = []) => {
  const out = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const extra = frozen.length ? `|${frozen.map(esc).join("|")}` : "";
  const re = new RegExp(
    `(\`\`\`[\\s\\S]*?\`\`\`|\`[^\`\\n]*\`|https?://\\S+|\\[[^\\]]*\\]\\([^)]*\\)${extra})`,
    "g",
  );
  let last = 0,
    m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ code: false, s: text.slice(last, m.index) });
    out.push({ code: true, s: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ code: false, s: text.slice(last) });
  return out;
};

const applyCase = (source, target) =>
  source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()
    ? target[0].toUpperCase() + target.slice(1)
    : target;

const francise = (text, pairs, frozen) =>
  segments(text, frozen)
    .map(({ code, s }) => {
      if (code) return s;
      for (const { en, fr } of pairs) {
        // échapper AVANT de rendre l'espace souple : un motif peut porter des `**`
        const motif = en
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/ /g, "\\s+");
        s = s.replace(
          new RegExp(`(?<!\\p{L})${motif}(?!\\p{L})`, "giu"),
          (hit) => applyCase(hit, fr),
        );
      }
      return s;
    })
    .join("");

const pairs = readPairs();
const frozen = readFrozen();
const write = process.argv.includes("--write");
const gh = (args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 << 20 });
const issues = JSON.parse(
  gh([
    "issue",
    "list",
    "--limit",
    "200",
    "--state",
    "open",
    "--json",
    "number,body",
  ]),
);

let touched = 0;
for (const { number, body } of issues) {
  const next = francise(body, pairs, frozen);
  if (next === body) continue;
  touched++;
  const before = body.split("\n");
  next.split("\n").forEach((line, i) => {
    if (before[i] !== line)
      console.log(
        `#${number}  − ${before[i]?.trim().slice(0, 150)}\n      + ${line.trim().slice(0, 150)}`,
      );
  });
  if (write) {
    const tmp = path.join(fs.mkdtempSync("/tmp/ticket-fr-"), `${number}.md`);
    fs.writeFileSync(tmp, next);
    gh(["issue", "edit", String(number), "--body-file", tmp]);
  }
}
console.log(
  `\n${touched} ticket(s) ${write ? "réécrit(s)" : "à réécrire — relancer avec --write"}`,
);
