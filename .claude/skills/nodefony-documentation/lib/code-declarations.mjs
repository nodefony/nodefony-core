/**
 * Déclarations NOMMÉES d'un fichier source, avec leur plage de lignes — la
 * seule source qui résout une ancre de doc par symbole (`<fichier>.ts#<Symbole>`,
 * `<fichier>.ts#<Classe.membre>`).
 *
 * Lue par le contrôle des ancres, par leur migration, et demain par le rendu.
 * Ce n'est PAS `.ai/symbols.json` : ce graphe ne garde que les symboles
 * exportés et ignore tests, `.tsx` et scripts, alors que la doc pointe
 * volontiers une fonction privée ou un test. Deux résolveurs divergeraient ;
 * celui-ci lit l'AST TypeScript du fichier, jamais une recherche de texte.
 *
 * Retenu : les déclarations de premier niveau (classe, interface, fonction,
 * type, énumération, espace de noms, chaque variable d'un `const`), et les
 * membres d'une classe ou d'une interface (méthode, propriété, accesseur,
 * constructeur). Une plage commence à l'EN-TÊTE — TSDoc, décorateurs et `//`
 * collés au-dessus : pointer la doc d'une méthode, c'est pointer la méthode.
 */
import fs from "node:fs";
import ts from "typescript";

/**
 * @typedef {object} ICodeDeclaration
 * @property {string} name - nom nu (`onDenied`, `#build`, `constructor`).
 * @property {string} qualified - `Classe.membre` pour un membre, le nom sinon.
 * @property {boolean} member - membre de classe ou d'interface.
 * @property {number} start - première ligne (base 1), en-tête compris.
 * @property {number} end - dernière ligne (base 1).
 * @property {boolean} overload - signature de surcharge : sans corps, ET une
 *   implémentation du même nom existe (une méthode `abstract` n'en est pas une).
 * @property {boolean} bodyless - fonction, méthode ou constructeur sans corps.
 * @property {boolean} accessor - accesseur `get`/`set`.
 */

/**
 * @typedef {object} ICodeDeclarations
 * @property {ICodeDeclaration[]} list - dans l'ordre du fichier.
 * @property {string[]} lines - le texte, ligne par ligne.
 */

const scriptKindOf = (file) =>
  file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : file.endsWith(".mjs") || file.endsWith(".js")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;

/**
 * L'AST d'un texte source et ses deux règles de lignes : `lineOf` (base 1) et
 * `startOf`, qui fait commencer un nœud à son EN-TÊTE (TSDoc, `//` collés).
 */
function sourceOf(file, text) {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const startOf = (node) => {
    let start = lineOf(node.getStart(sf, true));
    const comments =
      ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    for (let k = comments.length - 1; k >= 0; k--) {
      if (lineOf(comments[k].end) < start - 1) break;
      start = Math.min(start, lineOf(comments[k].pos));
    }
    return start;
  };
  return { sf, lineOf, startOf };
}

const nameOf = (n) =>
  n &&
  (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n))
    ? n.text
    : null;

/**
 * Analyse un texte source et rend ses déclarations nommées.
 *
 * @param file - nom du fichier : son extension choisit la grammaire (TS, TSX, JS).
 * @param text - contenu du fichier.
 * @returns {ICodeDeclarations} les déclarations et les lignes du texte.
 */
export function parseDeclarations(file, text) {
  const { sf, lineOf, startOf } = sourceOf(file, text);
  const list = [];
  const push = (node, name, parent = null) =>
    list.push({
      name,
      qualified: parent ? [parent, name].join(".") : name,
      member: Boolean(parent),
      start: startOf(node),
      end: lineOf(node.getEnd()),
      overload: false,
      bodyless:
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isConstructorDeclaration(node)) &&
        !node.body,
      accessor:
        ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node),
    });
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      const decls = st.declarationList.declarations;
      for (const d of decls) {
        const n = nameOf(d.name);
        if (n) push(decls.length === 1 ? st : d, n);
      }
      continue;
    }
    const n = nameOf(st.name);
    if (!n) continue;
    push(st, n);
    if (ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st)) {
      for (const m of st.members) {
        const mn = ts.isConstructorDeclaration(m)
          ? "constructor"
          : nameOf(m.name);
        if (mn) push(m, mn, n);
      }
    }
  }
  for (const d of list)
    d.overload =
      d.bodyless &&
      list.some((o) => o.qualified === d.qualified && !o.bodyless);
  return { list, lines: text.split("\n") };
}

/** Appels qui ouvrent un bloc de test (`describe.each(…)(…)`, `it.skip` compris). */
const TEST_CALLS = new Set([
  "describe",
  "suite",
  "it",
  "test",
  "bench",
  "beforeAll",
  "beforeEach",
  "afterAll",
  "afterEach",
]);

/** L'identifiant racine d'un appelé : `describe` pour `describe.each([…])`. */
function calleeRoot(expr) {
  let e = expr;
  while (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e))
    e = e.expression;
  return ts.isIdentifier(e) ? e.text : null;
}

/**
 * @typedef {object} ICodeBlock
 * @property {string} label - `[imports]`, `[exports]`, `describe "titre"`, `[if]`…
 * @property {number} depth - profondeur d'imbrication des blocs de test (0 au premier niveau).
 * @property {number} start - première ligne (base 1), en-tête compris.
 * @property {number} end - dernière ligne (base 1).
 * @property {boolean} grouped - une instruction d'un groupe d'imports ou de
 *   ré-exports : absente du plan (le groupe y figure), visée par une ligne.
 */

/**
 * Les blocs SANS NOM d'un fichier — ceux que {@link parseDeclarations} ne voit
 * pas et qu'on finissait par lire en tranche devinée : imports et ré-exports
 * (regroupés quand ils se suivent), blocs `describe`/`it`/`test` imbriqués,
 * instructions de premier niveau d'un script (`if`, `for`, `main()`…).
 *
 * @param file - nom du fichier : son extension choisit la grammaire.
 * @param text - contenu du fichier.
 * @returns {ICodeBlock[]} dans l'ordre du fichier.
 */
export function parseBlocks(file, text) {
  const { sf, lineOf, startOf } = sourceOf(file, text);
  const blocks = [];
  const add = (label, node, depth = 0, grouped = false) =>
    blocks.push({
      label,
      depth,
      start: startOf(node),
      end: lineOf(node.getEnd()),
      grouped,
    });
  const testBlocks = (node, depth) => {
    if (!ts.isExpressionStatement(node)) return false;
    const call = node.expression;
    if (!ts.isCallExpression(call)) return false;
    const root = calleeRoot(call.expression);
    if (!root || !TEST_CALLS.has(root)) return false;
    const title = call.arguments[0];
    const named =
      title &&
      (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title));
    add(
      named ? `${root} ${JSON.stringify(title.text)}` : `[${root}]`,
      node,
      depth,
    );
    for (const arg of call.arguments)
      if (
        (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) &&
        arg.body &&
        ts.isBlock(arg.body)
      )
        for (const st of arg.body.statements) testBlocks(st, depth + 1);
    return true;
  };
  let group = null;
  for (const st of sf.statements) {
    const kind = ts.isImportDeclaration(st)
      ? "[imports]"
      : ts.isExportDeclaration(st)
        ? "[exports]"
        : null;
    if (kind && group?.label === kind) {
      group.end = lineOf(st.getEnd());
      add(kind, st, 0, true);
      continue;
    }
    group = null;
    if (kind) {
      add(kind, st);
      group = blocks[blocks.length - 1];
      add(kind, st, 0, true);
      continue;
    }
    if (testBlocks(st, 0)) continue;
    if (ts.isExportAssignment(st)) {
      add("[export default]", st);
      continue;
    }
    // Les déclarations nommées appartiennent à parseDeclarations.
    if (ts.isVariableStatement(st) || nameOf(st.name)) continue;
    if (lineOf(st.getEnd()) - lineOf(st.getStart(sf)) < 1) continue;
    const word = ts.SyntaxKind[st.kind]
      .replace(/Statement$/, "")
      .replace(/^\w/, (c) => c.toLowerCase());
    add(`[${word}]`, st);
  }
  return blocks;
}

const cache = new Map();

/**
 * {@link parseDeclarations} d'un fichier sur disque, mis en cache par chemin.
 *
 * @param absPath - chemin du fichier.
 * @returns {ICodeDeclarations}
 */
export function loadDeclarations(absPath) {
  let found = cache.get(absPath);
  if (!found) {
    found = parseDeclarations(absPath, fs.readFileSync(absPath, "utf8"));
    cache.set(absPath, found);
  }
  return found;
}

const isHeaderLine = (l) => l === "" || /^(\/\*\*?|\*|\/\/|@)/.test(l);

/**
 * La déclaration la plus INTÉRIEURE qui contient toute la plage `[start, end]`.
 *
 * Une plage posée entre deux membres — sur la ligne vide ou le commentaire qui
 * précède un TSDoc — vise la déclaration qui SUIT, pas la classe qui les
 * contient : c'est la règle d'en-tête du contrôle des ancres.
 *
 * @param {ICodeDeclarations} decls
 * @param start - première ligne visée (base 1).
 * @param end - dernière ligne visée.
 * @returns {ICodeDeclaration | null} `null` hors de toute déclaration.
 */
export function enclosingDeclaration(decls, start, end = start) {
  const span = (d) => d.end - d.start;
  let best = null;
  for (const d of decls.list) {
    if (d.start <= start && d.end >= end && (!best || span(d) < span(best)))
      best = d;
  }
  const next = decls.list
    .filter(
      (d) =>
        d.start > start &&
        d.end >= end &&
        (!best || (d.start <= best.end && span(d) < span(best))) &&
        decls.lines
          .slice(start - 1, d.start - 1)
          .every((l) => isHeaderLine(l.trim())),
    )
    .sort((x, y) => x.start - y.start || span(y) - span(x))[0];
  return next ?? best;
}

/**
 * Les déclarations qu'un symbole d'ancre désigne : `Classe.membre` par son nom
 * qualifié, un nom nu par son nom de premier niveau. Une surcharge sans corps
 * n'en est pas une de plus.
 *
 * @param {ICodeDeclarations} decls
 * @param symbol - ce qui suit le `#` de l'ancre.
 * @returns {ICodeDeclaration[]} vide si le symbole n'existe pas dans le fichier.
 */
export function findDeclarations(decls, symbol) {
  return decls.list.filter((d) => d.qualified === symbol && !d.overload);
}

/**
 * Le nom désigne-t-il PLUSIEURS déclarations distinctes (classe + interface
 * fusionnées) ? Une paire `get`/`set` reste un seul symbole.
 *
 * @param {ICodeDeclarations} decls
 * @param symbol - nom qualifié.
 */
export function isAmbiguous(decls, symbol) {
  const same = findDeclarations(decls, symbol);
  return same.length > 1 && !same.every((d) => d.accessor);
}
