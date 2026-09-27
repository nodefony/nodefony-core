// Automate de TESTS du cliquet noUncheckedIndexedAccess (#498) — pose `!` sur le
// nœud EXACT de chaque diagnostic, jamais sur un littéral ni un nom de déclaration.
// Usage : node .claude/skills/nodefony-framework-dev/scripts/typing/non-null-index.mjs <tsconfig> [--write] [--only=<regex chemin>]
// Itère jusqu'au point fixe (corriger `a[0]` peut révéler `a[0].b`).
import path from "node:path";
import fs from "node:fs";
import ts from "typescript";

const [cfgArg, ...rest] = process.argv.slice(2);
const write = rest.includes("--write");
const onlyArg = rest.find((a) => a.startsWith("--only="));
const only = new RegExp(
  onlyArg ? onlyArg.slice(7) : "(^|/)tests?/|\\.test\\.ts$",
);
const CODES = new Set([2532, 18048, 2345, 2322, 2488, 2538, 2464, 18047, 2533]);

const cfgPath = path.resolve(cfgArg);
const cfgFile = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(
  cfgFile.config,
  ts.sys,
  path.dirname(cfgPath),
);
const options = {
  ...parsed.options,
  noUncheckedIndexedAccess: true,
  noEmit: true,
};

function findExact(sf, start, end) {
  let found;
  const visit = (n) => {
    if (n.getStart(sf) <= start && n.end >= end) {
      if (n.getStart(sf) === start && n.end === end) found = n; // garde le plus INTERNE…
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  // …puis remonte au plus EXTERNE de même étendue (ex. ExpressionStatement exclu).
  while (
    found?.parent &&
    found.parent.getStart(sf) === start &&
    found.parent.end === end &&
    ts.isExpression(found.parent)
  )
    found = found.parent;
  return found;
}

const skipped = [];
let total = 0;
for (let pass = 1; pass <= 6; pass++) {
  const program = ts.createProgram(parsed.fileNames, options);
  const edits = new Map(); // fichier → Map<pos, texte>
  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (!d.file || d.start === undefined || !CODES.has(d.code)) continue;
    const rel = path
      .relative(process.cwd(), d.file.fileName)
      .split(path.sep)
      .join("/");
    if (!only.test(rel) || rel.startsWith("..")) continue;
    const sf = d.file;
    let node = findExact(sf, d.start, d.start + d.length);
    // TS2488 `const [a, b] = x[0]` : le diagnostic porte sur le MOTIF, le `!` va sur l'initialiseur.
    if (
      node &&
      ts.isArrayBindingPattern(node) &&
      ts.isVariableDeclaration(node.parent) &&
      node.parent.initializer
    )
      node = node.parent.initializer;
    // TS2322 sur `return x[i]` : le diagnostic porte sur le mot-clé `return`.
    if (!node) {
      const ret = ts.getTokenAtPosition(sf, d.start).parent;
      if (ret && ts.isReturnStatement(ret) && ret.expression)
        node = ret.expression;
    }
    const where = `${rel}:${sf.getLineAndCharacterOfPosition(d.start).line + 1}`;
    if (
      !node ||
      !ts.isExpression(node) ||
      ts.isLiteralExpression(node) ||
      (node.parent &&
        ts.isVariableDeclaration(node.parent) &&
        node.parent.name === node) ||
      (node.parent && ts.isNonNullExpression(node.parent))
    ) {
      skipped.push(
        `${where} TS${d.code} (${node ? ts.SyntaxKind[node.kind] : "aucun nœud"})`,
      );
      continue;
    }
    const lhs =
      ts.isLeftHandSideExpression(node) && !ts.isAwaitExpression(node);
    const m = edits.get(sf.fileName) ?? new Map();
    edits.set(sf.fileName, m);
    if (lhs) m.set(`${node.end}`, [node.end, "!"]);
    else {
      m.set(`${node.getStart(sf)}(`, [node.getStart(sf), "("]);
      m.set(`${node.end})`, [node.end, ")!"]);
    }
  }
  if (edits.size === 0) break;
  let n = 0;
  for (const [file, m] of edits) {
    let text = fs.readFileSync(file, "utf8");
    for (const [pos, ins] of [...m.values()].sort((a, b) => b[0] - a[0])) {
      text = text.slice(0, pos) + ins + text.slice(pos);
      if (ins !== "(") n++;
    }
    if (write) fs.writeFileSync(file, text);
    console.log(
      `passe ${pass} · ${path.relative(process.cwd(), file)} · ${m.size} insertion(s)`,
    );
  }
  total += n;
  if (!write) break;
}
console.log(`total ${total} site(s)${write ? "" : " (simulation)"}`);
if (skipped.length)
  console.log(
    `LAISSÉS À LA MAIN (${skipped.length}) :\n  ${[...new Set(skipped)].join("\n  ")}`,
  );
