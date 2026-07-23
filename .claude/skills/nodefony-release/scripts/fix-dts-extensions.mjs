// Post-processing des `.d.ts` générés : ajoute les extensions AUX SPECIFIERS
// RELATIFS pour rendre les types publiés conformes à la résolution Node ESM
// (`node16`/`nodenext` : extension OBLIGATOIRE, doc Node esm.md) — décision
// d'audit 0.7, cf docs/release/nodefony-10.md §6bis.
//
// Pourquoi ici et pas ailleurs (audit 2026-07-04) :
// - tsc ne réécrit JAMAIS un specifier sans extension (TS 5.7
//   `rewriteRelativeImportExtensions` ne traite que les imports portant déjà
//   `.ts`) → aucune option compilateur ne peut le faire ;
// - le style interne du repo est `moduleResolution: Bundler` (imports nus,
//   décision figée) → pas de codemod des centaines de sources ;
// - même philosophie que la bascule `exports.types` : on corrige à la
//   FRONTIÈRE de publication (pack), sources et DX internes intactes.
//
// Méthode : AST TypeScript (jamais de regex — zéro faux positif dans les
// strings), remplacement par positions (diff minimal). Pour chaque specifier
// relatif sans extension : `X.d.ts` existe → `X.js` ; `X/index.d.ts` existe →
// `X/index.js` ; introuvable → ERREUR (type fantôme, cf le bug `globals`).
// Runtime JS non concerné : Rollup émet déjà des imports extensionnés, et TS
// résout `X.js` → `X.d.ts` sans exiger le fichier JS.
// Idempotent (specifiers déjà extensionnés non touchés) → réécriture EN PLACE
// sûre, y compris pour la consommation interne (Bundler accepte `.js`).
//
// Usage : node .claude/skills/nodefony-release/scripts/fix-dts-extensions.mjs <dir> [--quiet]
//         ou import { fixDtsExtensions } from "./fix-dts-extensions.mjs"
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const KNOWN_EXT = /\.(js|mjs|cjs|json|node|css)$/;

/** Liste récursive des .d.ts d'un dossier. */
function walkDts(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDts(abs, out);
    } else if (entry.name.endsWith(".d.ts")) {
      out.push(abs);
    }
  }
  return out;
}

/** Résout le specifier relatif contre le fs des .d.ts voisins. */
function resolveRelative(fileDir, spec) {
  if (fs.existsSync(path.resolve(fileDir, `${spec}.d.ts`))) {
    return `${spec}.js`;
  }
  if (fs.existsSync(path.resolve(fileDir, spec, "index.d.ts"))) {
    return `${spec}/index.js`;
  }
  return null;
}

/**
 * Réécrit les specifiers relatifs sans extension de tous les `.d.ts` de `dir`.
 *
 * @returns `{ files, rewrites, unresolved }` — `unresolved` non-vide = types
 *   fantômes (le caller DOIT échouer : ils produiraient des `any` silencieux
 *   chez tout consommateur sans `skipLibCheck`).
 */
export function fixDtsExtensions(dir, { quiet = true } = {}) {
  let rewrites = 0;
  const unresolved = [];
  const files = walkDts(dir);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    /** @type {{ start: number, end: number, replacement: string }[]} */
    const edits = [];
    const fileDir = path.dirname(file);

    const consider = (lit) => {
      if (!lit || !ts.isStringLiteral(lit)) return;
      const spec = lit.text;
      if (!spec.startsWith("./") && !spec.startsWith("../")) return;
      if (KNOWN_EXT.test(spec)) return;
      const fixed = resolveRelative(fileDir, spec);
      if (fixed === null) {
        unresolved.push(`${path.relative(dir, file)} → "${spec}"`);
        return;
      }
      // Positions INTERNES aux quotes (getStart()+1 … getEnd()-1).
      edits.push({
        start: lit.getStart(sf) + 1,
        end: lit.getEnd() - 1,
        replacement: fixed,
      });
    };

    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      ) {
        consider(node.moduleSpecifier);
      } else if (ts.isImportTypeNode(node)) {
        // `import("./x").Y` — très fréquent dans les .d.ts générés.
        const arg = node.argument;
        if (ts.isLiteralTypeNode(arg)) consider(arg.literal);
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1
      ) {
        consider(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    if (edits.length) {
      let next = text;
      for (const e of edits.sort((a, b) => b.start - a.start)) {
        next = next.slice(0, e.start) + e.replacement + next.slice(e.end);
      }
      fs.writeFileSync(file, next);
      rewrites += edits.length;
      if (!quiet) {
        console.log(
          `  ${path.relative(dir, file)} : ${edits.length} specifier(s)`,
        );
      }
    }
  }
  return { files: files.length, rewrites, unresolved };
}

// CLI standalone.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error("Usage: node fix-dts-extensions.mjs <dossier-de-types>");
    process.exit(2);
  }
  const quiet = process.argv.includes("--quiet");
  const r = fixDtsExtensions(path.resolve(dir), { quiet });
  console.log(
    `${r.files} .d.ts scannés · ${r.rewrites} specifiers extensionnés`,
  );
  if (r.unresolved.length) {
    console.error(
      `✗ ${r.unresolved.length} specifier(s) IRRÉSOLUS (types fantômes) :\n  - ${r.unresolved.join("\n  - ")}`,
    );
    process.exit(1);
  }
}
