#!/usr/bin/env node
/**
 * Vérifie qu'un renommage n'a touché AUCUNE chaîne de caractères.
 *
 * La règle du dépôt veut que les identifiants passent à l'anglais et que la
 * prose affichée reste en français. Un renommage par correspondance de texte
 * atteint les messages sans le dire ; ce contrôle compare, fichier par fichier,
 * les littéraux de chaîne d'avant et d'après. Il lit les fichiers MODIFIÉS que
 * git rapporte, jamais une liste tenue à la main.
 *
 * Usage : node .claude/skills/nodefony-identifiers/scripts/check-literals-unchanged.mjs [--base HEAD]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import ts from "typescript";

const argv = process.argv.slice(2);
const i = argv.indexOf("--base");
const base = i === -1 ? "HEAD" : argv[i + 1];
/**
 * Fichiers dont une chaîne change SCIEMMENT.
 *
 * Le seul cas légitime : une chaîne qui contient du CODE — un worker passé à
 * `node -e`, par exemple. Ses identifiants suivent la même règle de langue que
 * le reste, mais aucun outil ne les voit. L'exception doit être NOMMÉE à
 * l'appel, jamais déduite : c'est ce qui la rend visible en revue.
 */
const exceptions = new Set(
  argv.reduce(
    (acc, a, k) => (a === "--except" ? [...acc, argv[k + 1]] : acc),
    [],
  ),
);

const changed = execFileSync("git", ["diff", "--name-only", base], {
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts|cts)$/.test(f));

/** Toutes les chaînes du source, dans l'ordre — templates compris. */
const literals = (text, fileName) => {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      out.push(node.text);
    else if (
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

let drift = 0;
for (const file of changed) {
  if (!fs.existsSync(file)) continue;
  if (exceptions.has(file)) {
    console.log(`⚠️ ${file} — chaînes NON contrôlées (exception demandée)`);
    continue;
  }
  let before;
  try {
    before = execFileSync("git", ["show", `${base}:${file}`], {
      encoding: "utf8",
    });
  } catch {
    continue; // fichier neuf : rien à comparer
  }
  const a = literals(before, file);
  const b = literals(fs.readFileSync(file, "utf8"), file);
  if (a.length !== b.length) {
    console.log(`✗ ${file} — ${a.length} chaîne(s) avant, ${b.length} après`);
    drift += 1;
    continue;
  }
  for (let k = 0; k < a.length; k += 1) {
    if (a[k] !== b[k]) {
      console.log(`✗ ${file} — chaîne modifiée : « ${a[k]} » → « ${b[k]} »`);
      drift += 1;
    }
  }
}
console.log(
  drift === 0
    ? `✅ ${changed.length} fichier(s) : aucune chaîne modifiée`
    : `✗ ${drift} chaîne(s) modifiée(s)`,
);
process.exit(drift === 0 ? 0 : 1);
