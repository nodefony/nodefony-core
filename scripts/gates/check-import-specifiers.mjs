#!/usr/bin/env node
/**
 * check-import-specifiers — un `import()` ne reçoit jamais un chemin NATIF.
 *
 * Sous Windows, le chargeur ESM lit `C:\app\x.mjs` comme une URL de protocole
 * `c:` et lève. Sur macOS et Linux, le même chemin passe : le défaut est
 * invisible partout où l'on développe, et ne se montre que dans le job Windows
 * de la forge — ou chez l'utilisateur. Vécu : `loadClusterConfig` importait un
 * chemin natif dans un `try`/`catch` qui rendait `null` ; sous Windows, la
 * configuration de grappe d'une application était ignorée EN SILENCE.
 *
 * Le remède est UNIQUE : `toImportSpecifier` (`src/nodefony/src/kernel/
 * resolveModuleEntry.ts`), ou `pathToFileURL(…).href` là où le cœur n'est pas
 * importable. Ce gate refuse un `import()` dont l'argument PROVIENT d'un
 * fabricant de chemin natif — `path.join`/`resolve`/…, `fileURLToPath`,
 * `process.cwd()`, `__dirname`, `import.meta.dirname`, `os.tmpdir()`,
 * `mkdtemp` — directement ou par une variable de la même portée, sans passer
 * par la conversion.
 *
 * Lecture par l'AST de TypeScript, pas par une expression régulière : un
 * `import(` dans un commentaire ou une chaîne n'est pas un appel, et l'origine
 * d'une variable se suit jusqu'à sa déclaration.
 *
 * @usage    node scripts/gates/check-import-specifiers.mjs          # fichiers SUIVIS de src/, scripts/, .claude/skills/
 * @usage    node scripts/gates/check-import-specifiers.mjs <fichier…>
 * @output   chaque `import()` fautif, `fichier:ligne:colonne`, avec l'origine du chemin ; sortie 1 si un seul l'est
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Racines balayées (relatives au dépôt, toujours écrites en `/`). */
const ROOTS = ["src/", "scripts/", ".claude/skills/"];

/** Extensions lues : tout ce que Node ou un bundler exécute. */
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;

/** Fonctions de `node:path` qui rendent un chemin NATIF. */
const PATH_FUNCTIONS = new Set([
  "join",
  "resolve",
  "normalize",
  "relative",
  "dirname",
  "basename",
  "format",
]);

/** Fonctions qui rendent un chemin natif, quel que soit le module d'origine. */
const NATIVE_PATH_CALLS = new Set([
  "fileURLToPath",
  "tmpdir",
  "mkdtemp",
  "mkdtempSync",
  "realpathSync",
  "cwd",
]);

/** Conversions vers une URL : ce qui passe par elles est sûr. */
const CONVERSIONS = new Set(["toImportSpecifier", "pathToFileURL"]);

/**
 * Noms locaux sous lesquels le fichier importe `node:path` (défaut, espace de
 * noms) et ses fonctions nommées.
 *
 * @param {ts.SourceFile} sf
 * @returns {{ modules: Set<string>, functions: Set<string> }}
 */
function pathBindings(sf) {
  const modules = new Set();
  const functions = new Set();
  for (const statement of sf.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const from = statement.moduleSpecifier.text;
    if (from !== "node:path" && from !== "path") continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) modules.add(clause.name.text);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) modules.add(named.name.text);
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (PATH_FUNCTIONS.has(imported)) functions.add(el.name.text);
      }
    }
  }
  return { modules, functions };
}

/** Nom appelé par une expression d'appel (`a.b.c(…)` → `c`), ou `null`. */
function calleeName(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/**
 * Les déclarations et affectations de `name` visibles depuis `from` : la
 * portée la plus proche qui le déclare, et tout ce qui lui est affecté dedans.
 *
 * @returns {ts.Expression[]} les expressions qui ont pu lui donner sa valeur.
 */
function valuesOf(name, from) {
  for (let scope = from.parent; scope; scope = scope.parent) {
    // Un paramètre homonyme masque tout : sa valeur vient de l'appelant.
    if (
      ts.isFunctionLike(scope) &&
      scope.parameters?.some(
        (p) => ts.isIdentifier(p.name) && p.name.text === name,
      )
    ) {
      return [];
    }
    const statements =
      ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)
        ? scope.statements
        : null;
    if (statements === null) continue;
    const values = [];
    let declared = false;
    for (const statement of statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          declared = true;
          if (decl.initializer) values.push(decl.initializer);
        }
      }
    }
    if (!declared) continue;
    // Les affectations ultérieures, où qu'elles soient dans la portée
    // (`let x; try { x = path.join(…) } …`).
    const visit = (node) => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        node.left.text === name
      ) {
        values.push(node.right);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(scope, visit);
    return values;
  }
  return [];
}

/**
 * L'expression qui fabrique un chemin natif dans `expr`, ou `null` si rien ne
 * le prouve. Une origine inconnue (paramètre, appel quelconque) n'est PAS
 * accusée : le gate ne refuse que ce qu'il peut montrer.
 *
 * @returns {ts.Node | null}
 */
function nativeOrigin(expr, bindings, seen) {
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isTypeAssertionExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isAwaitExpression(expr)
  ) {
    return nativeOrigin(expr.expression, bindings, seen);
  }
  if (ts.isConditionalExpression(expr)) {
    return (
      nativeOrigin(expr.whenTrue, bindings, seen) ??
      nativeOrigin(expr.whenFalse, bindings, seen)
    );
  }
  if (ts.isBinaryExpression(expr)) {
    return (
      nativeOrigin(expr.left, bindings, seen) ??
      nativeOrigin(expr.right, bindings, seen)
    );
  }
  if (ts.isTemplateExpression(expr)) {
    for (const span of expr.templateSpans) {
      const found = nativeOrigin(span.expression, bindings, seen);
      if (found) return found;
    }
    return null;
  }
  if (ts.isCallExpression(expr)) {
    const name = calleeName(expr);
    if (name === null || CONVERSIONS.has(name)) return null;
    const callee = expr.expression;
    // `path.join(…)`, `path.win32.join(…)` : le receveur remonte à `node:path`.
    if (ts.isPropertyAccessExpression(callee) && PATH_FUNCTIONS.has(name)) {
      let receiver = callee.expression;
      while (ts.isPropertyAccessExpression(receiver)) {
        receiver = receiver.expression;
      }
      if (ts.isIdentifier(receiver) && bindings.modules.has(receiver.text)) {
        return expr;
      }
    }
    if (ts.isIdentifier(callee) && bindings.functions.has(name)) return expr;
    if (NATIVE_PATH_CALLS.has(name)) return expr;
    return null;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    // `import.meta.dirname` / `import.meta.filename` (Node ≥ 20.11).
    if (
      ts.isMetaProperty(expr.expression) &&
      (expr.name.text === "dirname" || expr.name.text === "filename")
    ) {
      return expr;
    }
    return null;
  }
  if (ts.isIdentifier(expr)) {
    if (expr.text === "__dirname" || expr.text === "__filename") return expr;
    if (seen.has(expr.text)) return null;
    seen.add(expr.text);
    for (const value of valuesOf(expr.text, expr)) {
      const found = nativeOrigin(value, bindings, seen);
      if (found) return found;
    }
    return null;
  }
  return null;
}

/**
 * Les `import()` d'un fichier dont l'argument est un chemin natif.
 *
 * @param {string} text - source du fichier.
 * @param {string} fileName - nom (pour le choix du dialecte : `.tsx`, `.mjs`…).
 * @returns {Array<{ line: number, column: number, argument: string, origin: string }>}
 */
export function findNativeImports(text, fileName) {
  // Pré-filtre : la grande majorité des fichiers n'a aucun import dynamique.
  if (!text.includes("import(")) return [];
  const kind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : /\.[cm]?js$/.test(fileName)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const bindings = pathBindings(sf);
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      const origin = nativeOrigin(arg, bindings, new Set());
      if (origin) {
        const { line, character } = sf.getLineAndCharacterOfPosition(
          node.getStart(sf),
        );
        found.push({
          line: line + 1,
          column: character + 1,
          argument: arg.getText(sf),
          origin: origin.getText(sf).replace(/\s+/g, " "),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Les fichiers SUIVIS du périmètre, en chemins relatifs écrits en `/`. */
function trackedFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z", "--", ...ROOTS], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter(
      (f) =>
        f !== "" &&
        SOURCE.test(f) &&
        !/(?:^|\/)(?:dist|node_modules)\//.test(f),
    );
}

function main() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const args = process.argv.slice(2);
  const files =
    args.length > 0
      ? args.map((f) =>
          path.relative(root, path.resolve(f)).split(path.sep).join("/"),
        )
      : trackedFiles(root);
  let faults = 0;
  for (const file of files) {
    const text = readFileSync(path.join(root, file), "utf8");
    for (const f of findNativeImports(text, file)) {
      faults++;
      process.stderr.write(
        `${file}:${f.line}:${f.column} — import(${f.argument}) reçoit un chemin NATIF ` +
          `(né de « ${f.origin} »)\n`,
      );
    }
  }
  if (faults > 0) {
    process.stderr.write(
      `\n❌ ${faults} import() de chemin natif — ils lèvent sous Windows ` +
        `(« C:\\… » est lu comme le protocole « c: »).\n` +
        `   Faire : import(toImportSpecifier(chemin)) — src/nodefony/src/kernel/resolveModuleEntry.ts —\n` +
        `   ou import(pathToFileURL(chemin).href) là où le cœur n'est pas importable.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `✓ import() : aucun chemin natif (${files.length} fichiers lus)\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
