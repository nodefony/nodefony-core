// Correcteur exactOptionalPropertyTypes : pour chaque diagnostic, trouve les propriétés
// OPTIONNELLES de la cible qui reçoivent une valeur pouvant valoir `undefined`, et ajoute
// `| undefined` à leur type déclaré — seulement dans le dépôt, hors node_modules/dist.
// Une cible lue dans un `.d.ts` de `dist/types` est remontée à sa déclaration SOURCE.
//
// Usage (racine du dépôt) : node .claude/skills/nodefony-framework-dev/scripts/typing/exact-optional.mjs <tsconfig>…
// Puis : prettier sur les fichiers modifiés, rebuild du paquet, REMESURE (tsgo).
// Méthode, ordre du graphe et pièges : ../../references/typage-strict.md
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const CODES = new Set([2412, 2375, 2379, 2322, 2345, 2769, 2416, 2420]);
const writable = (f) => {
  const r = path.relative(REPO, f);
  const parts = r.split(/[\\/]/);
  return (
    !r.startsWith("..") &&
    !parts.includes("node_modules") &&
    !parts.includes("dist") &&
    !f.endsWith(".d.ts")
  );
};

function service(configPath) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} },
  );
  const host = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: () => "0",
    getScriptSnapshot: (f) => {
      try {
        return ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8"));
      } catch {
        return undefined;
      }
    },
    getCurrentDirectory: () => path.dirname(configPath),
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  const ls = ts.createLanguageService(host);
  return { ls, program: ls.getProgram(), files: parsed.fileNames };
}

function findNode(sf, start, length) {
  let best;
  const visit = (n) => {
    if (n.getStart(sf) <= start && n.getEnd() >= start + length) {
      best = n;
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return best;
}

const hasUndef = (t) =>
  (t.flags & ts.TypeFlags.Undefined) !== 0 ||
  (t.isUnion() &&
    t.types.some((x) => (x.flags & ts.TypeFlags.Undefined) !== 0));

const pendingSource = new Map();
function run(configPath) {
  pendingSource.clear();
  const { program, files } = service(path.resolve(configPath));
  const checker = program.getTypeChecker();
  const targets = new Map(); // decl node -> true
  // Cible dans un `.d.ts` de `dist/types` d'un paquet du dépôt : on retrouve la
  // déclaration SOURCE (même conteneur, même propriété) et on l'élargit là.
  const containerName = (d) => {
    for (let p = d.parent; p; p = p.parent) {
      if (
        (ts.isInterfaceDeclaration(p) ||
          ts.isClassDeclaration(p) ||
          ts.isTypeAliasDeclaration(p)) &&
        p.name
      )
        return p.name.text;
    }
    return undefined;
  };
  const mapToSource = (d, file) => {
    const m = /^(.*)[\\/]dist[\\/]types[\\/](.*)\.d\.ts$/.exec(file);
    if (!m) return;
    const rel = path.relative(REPO, m[1]);
    if (rel.startsWith("..") || rel.split(/[\\/]/).includes("node_modules"))
      return;
    const cands = [
      path.join(m[1], "src", m[2] + ".ts"),
      path.join(m[1], m[2] + ".ts"),
      path.join(m[1], m[2] + ".tsx"),
      path.join(m[1], "src", m[2] + ".tsx"),
    ];
    const src = cands.find((c) => fs.existsSync(c));
    const cont = containerName(d);
    const prop = d.name && ts.isIdentifier(d.name) ? d.name.text : undefined;
    if (!src || !cont || !prop) return;
    const list = pendingSource.get(src) ?? new Set();
    list.add(cont + "\u0000" + prop);
    pendingSource.set(src, list);
  };
  let diagCount = 0;

  const addDecls = (sym) => {
    for (const d of sym.declarations ?? []) {
      if (
        (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d)) &&
        d.questionToken &&
        d.type
      ) {
        const sf = d.getSourceFile();
        if (!writable(sf.fileName)) {
          mapToSource(d, sf.fileName);
          continue;
        }
        const declared = checker.getTypeFromTypeNode(d.type);
        if (hasUndef(declared)) continue;
        targets.set(d, sf);
      }
    }
  };

  // Source object vs target type : propriétés optionnelles recevant undefined, en profondeur.
  const matchTypes = (src, tgt, depth = 0) => {
    if (depth > 4 || !src || !tgt) return;
    const tgts = tgt.isUnion() ? tgt.types : [tgt];
    const srcs = src.isUnion() ? src.types : [src];
    for (const s of srcs) {
      if (!(s.flags & ts.TypeFlags.Object) && !s.isIntersection()) continue;
      // tableaux / tuples
      const sEl =
        checker.isArrayType(s) || checker.isTupleType(s)
          ? checker.getIndexTypeOfType(s, ts.IndexKind.Number)
          : undefined;
      for (const t of tgts) {
        if (sEl) {
          const tEl = checker.getIndexTypeOfType(t, ts.IndexKind.Number);
          if (tEl) matchTypes(sEl, tEl, depth + 1);
          continue;
        }
        for (const sp of checker.getPropertiesOfType(s)) {
          const tp = checker.getPropertyOfType(t, sp.getName());
          if (!tp) continue;
          const sType = checker.getTypeOfSymbol(sp);
          if (tp.flags & ts.SymbolFlags.Optional && hasUndef(sType))
            addDecls(tp);
          const tType = checker.getTypeOfSymbol(tp);
          matchTypes(
            checker.getNonNullableType(sType),
            checker.getNonNullableType(tType),
            depth + 1,
          );
        }
      }
    }
  };

  // Classe implémentant/étendant : membre de classe `x: T | undefined` vs interface `x?: T`
  const matchClass = (cls) => {
    const classType = checker.getTypeAtLocation(cls);
    for (const clause of cls.heritageClauses ?? []) {
      for (const h of clause.types) {
        const base = checker.getTypeAtLocation(h);
        matchTypes(classType, base);
      }
    }
  };

  for (const f of files) {
    if (!writable(f)) continue;
    const sf = program.getSourceFile(f);
    if (!sf) continue;
    for (const d of program.getSemanticDiagnostics(sf)) {
      if (!CODES.has(d.code) || d.start === undefined) continue;
      const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (!text.includes("exactOptionalPropertyTypes")) continue;
      diagCount++;
      const node = findNode(sf, d.start, d.length ?? 0);
      if (!node) continue;
      // 2412 : affectation à une propriété (this.x = y / o.x = y)
      if (d.code === 2412 || d.code === 2416 || d.code === 2420) {
        let n = node;
        while (
          n &&
          !ts.isBinaryExpression(n) &&
          !ts.isClassLike(n) &&
          !ts.isPropertyAssignment(n) &&
          !ts.isShorthandPropertyAssignment(n)
        )
          n = n.parent;
        if (n && ts.isBinaryExpression(n)) {
          const sym = checker.getSymbolAtLocation(
            ts.isPropertyAccessExpression(n.left) ? n.left.name : n.left,
          );
          if (sym) addDecls(sym);
          continue;
        }
        if (n && ts.isClassLike(n)) {
          matchClass(n);
          continue;
        }
      }
      // JSX : attributs d'un élément vs props attendues du composant
      {
        let j = node;
        while (
          j &&
          !ts.isJsxOpeningElement(j) &&
          !ts.isJsxSelfClosingElement(j) &&
          !ts.isSourceFile(j)
        )
          j = j.parent;
        if (j && (ts.isJsxOpeningElement(j) || ts.isJsxSelfClosingElement(j))) {
          // Le type des attributs rend `any` : on apparie attribut par attribut.
          const ctx = checker.getContextualType(j.attributes);
          if (ctx) {
            for (const attr of j.attributes.properties) {
              if (
                !ts.isJsxAttribute(attr) ||
                !attr.initializer ||
                !ts.isJsxExpression(attr.initializer) ||
                !attr.initializer.expression
              )
                continue;
              const tp = checker.getPropertyOfType(ctx, attr.name.getText());
              if (!tp) continue;
              const sType = checker.getTypeAtLocation(
                attr.initializer.expression,
              );
              if (tp.flags & ts.SymbolFlags.Optional && hasUndef(sType))
                addDecls(tp);
              matchTypes(
                checker.getNonNullableType(sType),
                checker.getNonNullableType(checker.getTypeOfSymbol(tp)),
                1,
              );
            }
          }
        }
      }
      // Expression : type source vs type contextuel
      let expr = node;
      while (expr && !ts.isExpression(expr)) expr = expr.parent;
      for (let e = expr, i = 0; e && i < 6; e = e.parent, i++) {
        if (!ts.isExpression(e)) break;
        const src = checker.getTypeAtLocation(e);
        const ctx = checker.getContextualType(e);
        if (ctx) matchTypes(src, ctx);
        if (ts.isVariableDeclaration(e.parent) && e.parent.type)
          matchTypes(src, checker.getTypeFromTypeNode(e.parent.type));
      }
      // Déclaration de variable typée, retour de fonction
      let p = node;
      while (
        p &&
        !ts.isVariableDeclaration(p) &&
        !ts.isReturnStatement(p) &&
        !ts.isFunctionLike(p) &&
        !ts.isPropertyDeclaration(p)
      )
        p = p.parent;
      if (
        p &&
        (ts.isVariableDeclaration(p) || ts.isPropertyDeclaration(p)) &&
        p.type &&
        p.initializer
      )
        matchTypes(
          checker.getTypeAtLocation(p.initializer),
          checker.getTypeFromTypeNode(p.type),
        );
      if (p && ts.isReturnStatement(p) && p.expression) {
        let fn = p.parent;
        while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
        if (fn) {
          const sig = checker.getSignatureFromDeclaration(fn);
          if (sig) {
            let rt = checker.getReturnTypeOfSignature(sig);
            const awaited = checker.getAwaitedType(rt);
            if (awaited) rt = awaited;
            let st = checker.getTypeAtLocation(p.expression);
            const sa = checker.getAwaitedType(st);
            if (sa) st = sa;
            matchTypes(st, rt);
          }
        }
      }
    }
  }

  // Écriture
  const byFile = new Map();
  for (const [d, sf] of targets) {
    const list = byFile.get(sf.fileName) ?? [];
    list.push(d.type);
    byFile.set(sf.fileName, list);
  }
  let n = 0;
  for (const [file, types] of byFile) {
    let text = fs.readFileSync(file, "utf8");
    // Insertions PONCTUELLES triées par position décroissante : un type imbriqué
    // dans un autre (littéral d'objet) ne décale jamais une position encore à traiter.
    const uniq = [...new Map(types.map((t) => [t.pos, t])).values()];
    const ins = [];
    for (const t of uniq) {
      const needParens =
        ts.isFunctionTypeNode(t) ||
        ts.isConstructorTypeNode(t) ||
        ts.isConditionalTypeNode(t);
      // À position égale, l'insertion faite EN DERNIER finit devant : « ) » avant « | undefined ».
      ins.push([t.getEnd(), " | undefined"]);
      if (needParens) {
        ins.push([t.getEnd(), ")"]);
        ins.push([t.getStart(), "("]);
      }
      n++;
    }
    ins.sort((a, b) => b[0] - a[0]);
    for (const [pos, str] of ins)
      text = text.slice(0, pos) + str + text.slice(pos);
    fs.writeFileSync(file, text);
  }
  let ns = 0;
  for (const [file, keys] of pendingSource) {
    let text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const ins = [];
    const visit = (node, cont) => {
      if (
        (ts.isInterfaceDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)) &&
        node.name
      )
        cont = node.name.text;
      if (
        (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
        node.questionToken &&
        node.type &&
        ts.isIdentifier(node.name) &&
        cont &&
        keys.has(cont + "\u0000" + node.name.text)
      ) {
        const raw = node.type.getText(sf);
        if (!/\bundefined\b/.test(raw)) {
          const t = node.type;
          const needParens =
            ts.isFunctionTypeNode(t) ||
            ts.isConstructorTypeNode(t) ||
            ts.isConditionalTypeNode(t);
          ins.push([t.getEnd(), " | undefined"]);
          if (needParens) {
            ins.push([t.getEnd(), ")"]);
            ins.push([t.getStart(sf), "("]);
          }
          ns++;
        }
      }
      ts.forEachChild(node, (c) => visit(c, cont));
    };
    visit(sf, undefined);
    ins.sort((a, b) => b[0] - a[0]);
    for (const [pos, str] of ins)
      text = text.slice(0, pos) + str + text.slice(pos);
    if (ins.length) fs.writeFileSync(file, text);
  }
  if (ns) console.log(`  (+${ns} déclarations SOURCE élargies via dist/types)`);
  n += ns;
  console.log(
    `${configPath}: ${diagCount} diagnostics exactOptional, ${n} déclarations élargies dans ${byFile.size} fichiers`,
  );
  return n;
}

for (const cfg of process.argv.slice(2)) {
  for (let i = 0; i < 5; i++) if (run(cfg) === 0) break;
}
