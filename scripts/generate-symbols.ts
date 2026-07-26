/**
 * generate-symbols.ts — Symbol graph extractor for AI agents.
 *
 * Parses TS files matching the config globs, emits two JSON outputs:
 *  - .ai/symbols.json   (stable, committed)   → lightweight, agent-friendly
 *  - dist/symbols.json  (verbose, gitignored) → full detail
 *
 * Usage: npm run generate-symbols
 */

import {
  Project,
  Node,
  SyntaxKind,
  ClassDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  EnumDeclaration,
  FunctionDeclaration,
  VariableStatement,
} from "ts-morph";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import picomatch from "picomatch";
import config from "./generate-symbols.config.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ─── Types ──────────────────────────────────────────────────────────────────

type SymbolKind =
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "function"
  | "const"
  | "decorator-fn";

interface SymbolBase {
  name: string;
  kind: SymbolKind;
  file: string; // relative to repo root
  exported: boolean;
  module: string; // workspace name e.g. "@nodefony/http"
}

interface SymbolDetail extends SymbolBase {
  extends?: string | null;
  implements?: string[];
  decorators?: string[];
  description?: string; // first sentence of the TSDoc, trimmed to ~200 chars
  // Verbose-only
  methods?: {
    name: string;
    static: boolean;
    visibility: "public" | "protected" | "private";
    decorators?: string[];
    description?: string;
  }[];
  properties?: {
    name: string;
    static: boolean;
    visibility: "public" | "protected" | "private";
  }[];
  members?: string[]; // for enums / interfaces
  signature?: string; // for functions / decorator-fn
}

interface FileImports {
  file: string;
  imports: { module: string; names: string[]; isTypeOnly: boolean }[];
}

interface Relations {
  // class A extends X → relations.extendedBy.X = ["A", ...]
  extendedBy: Record<string, string[]>;
  // class A implements X → relations.implementedBy.X = ["A", ...]
  implementedBy: Record<string, string[]>;
  // @injectable class A → relations.decoratedBy.injectable = ["A", ...]
  decoratedBy: Record<string, string[]>;
  // file imports symbol X → relations.usedBy.X = ["src/foo.ts", ...]
  usedBy: Record<string, string[]>;
}

interface SymbolsOutput {
  generated: string;
  version: string;
  repoRoot: string;
  stats: {
    files: number;
    symbols: number;
    classes: number;
    interfaces: number;
    types: number;
    enums: number;
    functions: number;
    constants: number;
  };
  // v2.0 — symbols as a name-indexed map (O(1) lookup).
  // Homonyms across modules are keyed as "Module:Name".
  symbols: Record<string, SymbolDetail>;
  relations: Relations;
  imports?: FileImports[]; // verbose only
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function relPath(p: string): string {
  return path.relative(repoRoot, p).split(path.sep).join("/");
}

/**
 * Resolve which workspace a file belongs to.
 * Heuristic based on path prefix.
 */
function moduleOf(relativeFile: string): string {
  // src/packages/@nodefony/<name>/...
  const pkgMatch = relativeFile.match(/^src\/packages\/(@nodefony\/[^/]+)/);
  if (pkgMatch) return pkgMatch[1];
  // src/modules/<name>/...
  const modMatch = relativeFile.match(/^src\/modules\/([^/]+)/);
  if (modMatch) return `modules/${modMatch[1]}`;
  // src/nodefony/...
  if (relativeFile.startsWith("src/nodefony/")) return "@nodefony/core";
  return "unknown";
}

function visibilityOf(node: Node): "public" | "protected" | "private" {
  const text = node.getText();
  if (/^\s*private\s/.test(text)) return "private";
  if (/^\s*protected\s/.test(text)) return "protected";
  return "public";
}

// Extract the leading description from a JSDoc/TSDoc block. Strips @tags and
// collapses whitespace; truncates to ~200 chars so the stable index stays
// lightweight. Returns undefined when no usable description exists.
function tsDocOf(node: {
  getJsDocs?: () => { getDescription: () => string }[];
}): string | undefined {
  if (typeof node.getJsDocs !== "function") return undefined;
  const docs = node.getJsDocs();
  if (!docs.length) return undefined;
  const raw = docs[0].getDescription().trim();
  if (!raw) return undefined;
  // Collapse internal whitespace and strip residual leading "* " runs.
  const collapsed = raw.replace(/\s+/g, " ").replace(/^\* /, "").trim();
  if (!collapsed) return undefined;
  return collapsed.length > 200 ? collapsed.slice(0, 197) + "…" : collapsed;
}

// ─── Extractors ─────────────────────────────────────────────────────────────

function extractClass(
  cls: ClassDeclaration,
  file: string,
  module: string,
  verbose: boolean,
): SymbolDetail | null {
  const name = cls.getName();
  if (!name) return null;
  const description = tsDocOf(cls);
  const sym: SymbolDetail = {
    name,
    kind: "class",
    file,
    exported: cls.isExported() || cls.isDefaultExport(),
    module,
    extends: cls.getExtends()?.getExpression().getText() ?? null,
    implements: cls.getImplements().map((i) => i.getExpression().getText()),
    decorators: cls.getDecorators().map((d) => d.getName()),
  };
  if (description) sym.description = description;
  if (verbose) {
    sym.methods = cls
      .getInstanceMethods()
      .concat(cls.getStaticMethods())
      .map((m) => {
        const methodDoc = tsDocOf(m);
        const entry: {
          name: string;
          static: boolean;
          visibility: "public" | "protected" | "private";
          decorators?: string[];
          description?: string;
        } = {
          name: m.getName(),
          static: m.isStatic(),
          visibility: m.hasModifier(SyntaxKind.PrivateKeyword)
            ? "private"
            : m.hasModifier(SyntaxKind.ProtectedKeyword)
              ? "protected"
              : "public",
          decorators: m.getDecorators().map((d) => d.getName()),
        };
        if (methodDoc) entry.description = methodDoc;
        return entry;
      });
    sym.properties = cls
      .getInstanceProperties()
      .concat(cls.getStaticProperties())
      .map((p) => ({
        name: p.getName(),
        static:
          "isStatic" in p && typeof p.isStatic === "function"
            ? p.isStatic()
            : false,
        visibility: p.hasModifier?.(SyntaxKind.PrivateKeyword)
          ? "private"
          : p.hasModifier?.(SyntaxKind.ProtectedKeyword)
            ? "protected"
            : "public",
      }));
  }
  return sym;
}

function extractInterface(
  iface: InterfaceDeclaration,
  file: string,
  module: string,
  verbose: boolean,
): SymbolDetail {
  const description = tsDocOf(iface);
  const sym: SymbolDetail = {
    name: iface.getName(),
    kind: "interface",
    file,
    exported: iface.isExported(),
    module,
    extends:
      iface
        .getExtends()
        .map((e) => e.getExpression().getText())
        .join(", ") || null,
  };
  if (description) sym.description = description;
  if (verbose) {
    sym.members = iface
      .getProperties()
      .map((p) => p.getName())
      .concat(iface.getMethods().map((m) => m.getName()));
  }
  return sym;
}

function extractTypeAlias(
  t: TypeAliasDeclaration,
  file: string,
  module: string,
): SymbolDetail {
  const description = tsDocOf(t);
  const sym: SymbolDetail = {
    name: t.getName(),
    kind: "type",
    file,
    exported: t.isExported(),
    module,
  };
  if (description) sym.description = description;
  return sym;
}

function extractEnum(
  e: EnumDeclaration,
  file: string,
  module: string,
  verbose: boolean,
): SymbolDetail {
  const description = tsDocOf(e);
  const sym: SymbolDetail = {
    name: e.getName(),
    kind: "enum",
    file,
    exported: e.isExported(),
    module,
  };
  if (description) sym.description = description;
  if (verbose) sym.members = e.getMembers().map((m) => m.getName());
  return sym;
}

function extractFunction(
  f: FunctionDeclaration,
  file: string,
  module: string,
  verbose: boolean,
): SymbolDetail | null {
  const name = f.getName();
  if (!name) return null;
  // Heuristic: decorator factory if returns ClassDecorator / MethodDecorator / PropertyDecorator / ParameterDecorator
  const returnTypeText = f.getReturnTypeNode()?.getText() ?? "";
  const isDecorator =
    returnTypeText.endsWith("Decorator") ||
    /Decorator\s*\|/.test(returnTypeText);
  const description = tsDocOf(f);
  const sym: SymbolDetail = {
    name,
    kind: isDecorator ? "decorator-fn" : "function",
    file,
    exported: f.isExported() || f.isDefaultExport(),
    module,
  };
  if (description) sym.description = description;
  if (verbose) {
    sym.signature = f.getText().split("\n")[0].slice(0, 200);
  }
  return sym;
}

function extractConsts(
  stmt: VariableStatement,
  file: string,
  module: string,
  verbose: boolean,
): SymbolDetail[] {
  if (!stmt.isExported() && !stmt.hasModifier?.(SyntaxKind.ExportKeyword))
    return [];
  const description = tsDocOf(stmt);
  return stmt.getDeclarations().map((d) => {
    const sym: SymbolDetail = {
      name: d.getName(),
      kind: "const",
      file,
      exported: true,
      module,
    };
    if (description) sym.description = description;
    if (verbose) {
      sym.signature = d.getText().slice(0, 200);
    }
    return sym;
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

function generate(): void {
  console.log("🔧 generate-symbols — parsing TypeScript sources…");

  // Resolve globs via fast-glob first, then add files one by one to the project
  // with size guard + try/catch around each parse (ts-morph parser can stack-overflow
  // on minified/generated files — we want to skip them gracefully, not abort).
  const matched = fg.sync(config.include, {
    cwd: repoRoot,
    ignore: config.exclude,
    absolute: true,
    onlyFiles: true,
    dot: false,
  });

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: 9, // ES2022
      module: 99, // ESNext
      moduleResolution: 100, // Bundler
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      strict: false, // tolerant — we only parse AST
      allowJs: false,
      noEmit: true,
      skipLibCheck: true,
    },
  });

  let skippedSize = 0;
  let skippedParse = 0;
  for (const absPath of matched) {
    const size = fs.statSync(absPath).size;
    if (size > 500_000) {
      console.log(
        `  ⚠ skip large file (${(size / 1024).toFixed(0)} KB): ${relPath(absPath)}`,
      );
      skippedSize++;
      continue;
    }
    try {
      project.addSourceFileAtPath(absPath);
    } catch (err) {
      console.warn(
        `  ⚠ skip ${relPath(absPath)} — parse error: ${(err as Error).message.split("\n")[0]}`,
      );
      skippedParse++;
    }
  }

  const sourceFiles = project.getSourceFiles();
  console.log(
    `  → ${matched.length} files matched, ${sourceFiles.length} parsed (skipped: ${skippedSize} large, ${skippedParse} parse errors)`,
  );

  const stableSymbols: SymbolDetail[] = [];
  const verboseSymbols: SymbolDetail[] = [];
  const filesImports: FileImports[] = [];
  const stats = {
    files: sourceFiles.length,
    symbols: 0,
    classes: 0,
    interfaces: 0,
    types: 0,
    enums: 0,
    functions: 0,
    constants: 0,
  };

  for (const sf of sourceFiles) {
    const file = relPath(sf.getFilePath());
    const module = moduleOf(file);

    try {
      // Imports
      const imports = sf.getImportDeclarations().map((imp) => {
        const moduleSpec = imp.getModuleSpecifierValue();
        const names: string[] = [];
        if (imp.getDefaultImport())
          names.push(imp.getDefaultImport()!.getText());
        for (const named of imp.getNamedImports()) names.push(named.getName());
        if (imp.getNamespaceImport())
          names.push("* as " + imp.getNamespaceImport()!.getText());
        return { module: moduleSpec, names, isTypeOnly: imp.isTypeOnly() };
      });
      if (imports.length) filesImports.push({ file, imports });

      // Classes
      for (const cls of sf.getClasses()) {
        const stableSym = extractClass(cls, file, module, false);
        const verboseSym = extractClass(cls, file, module, true);
        if (stableSym) {
          stableSymbols.push(stableSym);
          stats.classes++;
          stats.symbols++;
        }
        if (verboseSym) verboseSymbols.push(verboseSym);
      }
      // Interfaces
      for (const iface of sf.getInterfaces()) {
        stableSymbols.push(extractInterface(iface, file, module, false));
        verboseSymbols.push(extractInterface(iface, file, module, true));
        stats.interfaces++;
        stats.symbols++;
      }
      // Types
      for (const t of sf.getTypeAliases()) {
        const sym = extractTypeAlias(t, file, module);
        stableSymbols.push(sym);
        verboseSymbols.push(sym);
        stats.types++;
        stats.symbols++;
      }
      // Enums
      for (const e of sf.getEnums()) {
        stableSymbols.push(extractEnum(e, file, module, false));
        verboseSymbols.push(extractEnum(e, file, module, true));
        stats.enums++;
        stats.symbols++;
      }
      // Functions
      for (const f of sf.getFunctions()) {
        const stableSym = extractFunction(f, file, module, false);
        const verboseSym = extractFunction(f, file, module, true);
        if (stableSym) {
          stableSymbols.push(stableSym);
          stats.functions++;
          stats.symbols++;
        }
        if (verboseSym) verboseSymbols.push(verboseSym);
      }
      // Exported consts
      for (const stmt of sf.getVariableStatements()) {
        const consts = extractConsts(stmt, file, module, false);
        const constsV = extractConsts(stmt, file, module, true);
        stableSymbols.push(...consts);
        verboseSymbols.push(...constsV);
        stats.constants += consts.length;
        stats.symbols += consts.length;
      }
    } catch (err) {
      console.warn(
        `  ⚠ skip ${file} — parse error: ${(err as Error).message.split("\n")[0]}`,
      );
    }
  }

  const generated = new Date().toISOString();

  // Build a name-indexed map for O(1) lookup.
  // Homonym policy: first wins by simple name; later collisions are stored
  // under "Module:Name" so both remain reachable. Console-warn so the user
  // can rename or namespace if a clash is unintentional.
  function buildSymbolMap(list: SymbolDetail[]): Record<string, SymbolDetail> {
    const map: Record<string, SymbolDetail> = {};
    // Les homonymes (même nom dans 2 modules) sont attendus et namespacés.
    // On NE log PLUS chaque ligne (bruit ~50 lignes/commit dans le hook pre-commit) :
    // 1 résumé suffit. Détail ligne-par-ligne via `--verbose`.
    const verbose = process.argv.includes("--verbose");
    let homonyms = 0;
    for (const sym of list) {
      if (map[sym.name] === undefined) {
        map[sym.name] = sym;
        continue;
      }
      const existing = map[sym.name];
      if (existing.module === sym.module && existing.file === sym.file)
        continue; // exact dup, ignore
      const namespaced = `${sym.module}:${sym.name}`;
      map[namespaced] = sym;
      homonyms++;
      if (verbose) {
        console.warn(
          `  ⚠ homonym: ${sym.name} exists in ${existing.module} and ${sym.module} → stored as "${namespaced}"`,
        );
      }
    }
    if (homonyms > 0 && !verbose) {
      console.warn(
        `  ⚠ ${homonyms} homonymes namespacés (lancer avec --verbose pour le détail)`,
      );
    }
    return map;
  }

  // Build inverse relation indexes. extendedBy / implementedBy / decoratedBy
  // are built from the stable list (exported only). usedBy comes from the
  // imports scan and is keyed by simple symbol name.
  function buildRelations(list: SymbolDetail[]): Relations {
    const extendedBy: Record<string, string[]> = {};
    const implementedBy: Record<string, string[]> = {};
    const decoratedBy: Record<string, string[]> = {};
    for (const sym of list) {
      if (sym.extends) {
        // Strip generics: `BaseService<T>` → `BaseService`
        const parent = sym.extends.split("<")[0].split(",")[0].trim();
        if (parent) (extendedBy[parent] ??= []).push(sym.name);
      }
      if (sym.implements) {
        for (const iface of sym.implements) {
          const base = iface.split("<")[0].trim();
          if (base) (implementedBy[base] ??= []).push(sym.name);
        }
      }
      if (sym.decorators) {
        for (const dec of sym.decorators) {
          (decoratedBy[dec] ??= []).push(sym.name);
        }
      }
    }
    return { extendedBy, implementedBy, decoratedBy, usedBy: {} };
  }

  const stableExported = stableSymbols.filter((s) => s.exported);
  const stableMap = buildSymbolMap(stableExported);
  const verboseMap = buildSymbolMap(verboseSymbols);
  const relations = buildRelations(stableExported);

  // usedBy index: symbol name → files that import it (works on simple names;
  // homonyms collapse in the same bucket — acceptable for analysis).
  const allSymbolNames = new Set(stableSymbols.map((s) => s.name));
  for (const fi of filesImports) {
    for (const imp of fi.imports) {
      for (const name of imp.names) {
        if (allSymbolNames.has(name)) {
          (relations.usedBy[name] ??= []).push(fi.file);
        }
      }
    }
  }

  const stableOutput: SymbolsOutput = {
    generated,
    version: "2.0.0",
    repoRoot: ".",
    stats: { ...stats },
    symbols: stableMap,
    relations,
  };

  const verboseOutput: SymbolsOutput = {
    generated,
    version: "2.0.0",
    repoRoot: ".",
    stats,
    symbols: verboseMap,
    relations,
    imports: filesImports,
  };

  // Write stable
  const stablePath = path.join(repoRoot, config.output.stable);
  fs.mkdirSync(path.dirname(stablePath), { recursive: true });
  fs.writeFileSync(
    stablePath,
    JSON.stringify(stableOutput, null, 2) + "\n",
    "utf8",
  );

  // Write verbose
  const verbosePath = path.join(repoRoot, config.output.verbose);
  fs.mkdirSync(path.dirname(verbosePath), { recursive: true });
  fs.writeFileSync(
    verbosePath,
    JSON.stringify(verboseOutput, null, 2) + "\n",
    "utf8",
  );

  console.log("✅ generate-symbols done");
  console.log(`  → ${stats.files} files, ${stats.symbols} symbols`);
  console.log(
    `     classes: ${stats.classes}, interfaces: ${stats.interfaces}, types: ${stats.types}, enums: ${stats.enums}, functions: ${stats.functions}, constants: ${stats.constants}`,
  );
  console.log(
    `  → stable  : ${config.output.stable} (${(fs.statSync(stablePath).size / 1024).toFixed(1)} KB, ${Object.keys(stableMap).length} exported symbols)`,
  );
  console.log(
    `  → verbose : ${config.output.verbose} (${(fs.statSync(verbosePath).size / 1024).toFixed(1)} KB, ${Object.keys(verboseMap).length} symbols)`,
  );
}

// ─── --check-staged mode (for pre-commit hook) ──────────────────────────────
//
// Reads `git diff --cached --name-only` and tests staged files against the
// same include/exclude globs the script uses for parsing.
//   exit 0 → no staged file matches → no regeneration needed
//   exit 1 → at least one match → caller should run generate-symbols
//
// This is the unique source of truth: change include/exclude in
// `generate-symbols.config.ts` and both the parsing scope and the hook
// trigger update together.

function checkStaged(): never {
  let stagedFiles: string[] = [];
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd: repoRoot,
      encoding: "utf8",
    });
    stagedFiles = out.split("\n").filter(Boolean);
  } catch {
    // git unavailable or no commit in progress — treat as nothing staged
    process.exit(0);
  }

  if (stagedFiles.length === 0) process.exit(0);

  const includeMatchers = config.include.map((p) => picomatch(p));
  const excludeMatchers = config.exclude.map((p) => picomatch(p));

  for (const file of stagedFiles) {
    const matchesInclude = includeMatchers.some((m) => m(file));
    if (!matchesInclude) continue;
    const matchesExclude = excludeMatchers.some((m) => m(file));
    if (matchesExclude) continue;
    // At least one staged file is within the parsed scope.
    process.exit(1);
  }

  process.exit(0);
}

// Entrypoint
if (process.argv.includes("--check-staged")) {
  checkStaged();
}

generate();
