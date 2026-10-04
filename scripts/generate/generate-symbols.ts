/**
 * generate-symbols.ts — Symbol graph extractor for AI agents.
 *
 * Parses TS files matching the config globs, emits three JSON outputs — all
 * GENERATED and git-ignored, never committed:
 *  - .ai/symbols.json              → le graphe du dépôt entier, pour les agents
 *  - src/nodefony/.ai/symbols.json → la copie PUBLIÉE avec `nodefony`, réduite
 *                                    aux modules publiés
 *  - .ai/symbols.verbose.json      → le détail complet
 *
 * Les hooks git `post-commit`, `post-merge` et `post-checkout` le régénèrent en
 * arrière-plan quand la zone parsée a bougé ; la CI le régénère où elle le lit.
 *
 * @usage npm run generate-symbols
 * @option --verbose  détail ligne par ligne des homonymes
 * @option --check-staged  code 1 si un fichier indexé touche la zone parsée
 * @option --check-range <de> <à>  code 1 si la zone a bougé entre deux révisions, ou si le graphe manque
 */

import {
  Project,
  SyntaxKind,
  ClassDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  EnumDeclaration,
  FunctionDeclaration,
  VariableStatement,
  SourceFile,
} from "ts-morph";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import picomatch from "picomatch";
import config from "./generate-symbols.config.ts";
import {
  filterGraphToModules,
  moduleOf,
  publishableWorkspaces,
  publishedModules,
} from "../lib/symbols-publish.mjs";
import { REPO_ROOT as repoRoot } from "../lib/repo-root.mjs";

/**
 * Écrit un fichier d'un geste : contenu posé à côté, puis renommé.
 *
 * Le graphe est désormais régénéré EN ARRIÈRE-PLAN par les hooks git : deux
 * générations peuvent se croiser, et un lecteur (agent, Studio) ne doit jamais
 * tomber sur un JSON à moitié écrit. Le renommage remplace la cible sur les
 * trois systèmes.
 */
function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

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

// Extract the leading description from a JSDoc/TSDoc block. Strips @tags and
// collapses whitespace; truncates to ~200 chars so the stable index stays
// lightweight. Returns undefined when no usable description exists.
function tsDocOf(node: {
  getJsDocs?: () => { getDescription: () => string }[];
}): string | undefined {
  if (typeof node.getJsDocs !== "function") return undefined;
  const docs = node.getJsDocs();
  const [first] = docs;
  if (!first) return undefined;
  const raw = first.getDescription().trim();
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
    sym.signature = f.getText().split("\n", 1).join("").slice(0, 200);
  }
  return sym;
}

/**
 * Noms qu'un fichier exporte par une clause GROUPÉE (`export { Get, Post };`)
 * plutôt que par le mot-clé `export` posé sur la déclaration.
 *
 * Sans cela, tout un pan du framework est invisible au graphe : `routerDecorators.ts`
 * déclare `const Get = httpMethodDecorator(["GET"])` puis exporte le lot en fin de
 * fichier. Mesuré avant correction — **16 décorateurs sur 19 absents**, dont tous
 * les verbes HTTP et tous les extracteurs de paramètres : `nodefony symbols @Get`
 * ne rendait rien sur les symboles les plus employés du framework.
 *
 * Les ré-exports depuis un AUTRE module (`export { x } from "./y"`) sont ignorés :
 * le symbole appartient au fichier qui le déclare, et c'est là qu'il sera relevé —
 * le compter deux fois créerait un homonyme avec lui-même.
 *
 * @param sf - fichier source analysé.
 * @returns les noms exportés, sous leur nom PUBLIC (l'alias quand il y en a un).
 */
function groupedExportNames(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const decl of sf.getExportDeclarations()) {
    if (decl.getModuleSpecifier()) continue;
    for (const spec of decl.getNamedExports()) {
      names.add(spec.getAliasNode()?.getText() ?? spec.getNameNode().getText());
    }
  }
  return names;
}

function extractConsts(
  stmt: VariableStatement,
  file: string,
  module: string,
  verbose: boolean,
  grouped: Set<string> = new Set(),
): SymbolDetail[] {
  const viaClause = stmt
    .getDeclarations()
    .some((d) => grouped.has(d.getName()));
  if (
    !viaClause &&
    !stmt.isExported() &&
    !stmt.hasModifier?.(SyntaxKind.ExportKeyword)
  )
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

  // Resolve globs first (`fs.globSync`, Node ≥ 22 — no dependency: `fast-glob`
  // dragged `braces` into the audit), then add files one by one to the project
  // with size guard + try/catch around each parse (ts-morph parser can stack-overflow
  // on minified/generated files — we want to skip them gracefully, not abort).
  const matched = fs
    .globSync(config.include, { cwd: repoRoot, exclude: config.exclude })
    .map((p) => path.resolve(repoRoot, p))
    .filter((p) => fs.statSync(p).isFile())
    // Un ordre qui ne dépend ni du système de fichiers ni de la plateforme : les
    // listes de relations suivent l'ordre des fichiers, et le gate de
    // reproductibilité compare octet à octet. Clé POSIX : `\\` trierait
    // autrement sous Windows.
    .sort((a, b) => {
      const ka = path.relative(repoRoot, a).split(path.sep).join("/");
      const kb = path.relative(repoRoot, b).split(path.sep).join("/");
      return ka < kb ? -1 : ka > kb ? 1 : 0;
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
      const grouped = groupedExportNames(sf);
      for (const stmt of sf.getVariableStatements()) {
        const consts = extractConsts(stmt, file, module, false, grouped);
        const constsV = extractConsts(stmt, file, module, true, grouped);
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

  // 🔴 AUCUN horodatage dans ce fichier — il est généré ET versionné.
  //
  // Une date d'exécution le rend différent à chaque régénération sur un dépôt
  // pourtant identique : toute chaîne qui le régénère salit alors l'arbre, et
  // la publication de la `10.0.0-alpha.2` a été refusée par sa propre garde
  // « arbre propre » sur ce seul champ.
  //
  // La dériver du commit ne marche pas non plus, et l'essai valait la leçon :
  // le hook `pre-commit` régénère AVANT que le commit existe — le fichier
  // porterait la date du commit PRÉCÉDENT — quand la forge régénère APRÈS. Un
  // artefact ne peut pas contenir l'identité du commit qui le contient.
  //
  // La date de génération vit donc où elle a toujours été juste : `git log`.

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
      const existing = map[sym.name];
      if (existing === undefined) {
        map[sym.name] = sym;
        continue;
      }
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
        const [head = ""] = sym.extends.split(/[<,]/, 1);
        const parent = head.trim();
        if (parent) (extendedBy[parent] ??= []).push(sym.name);
      }
      if (sym.implements) {
        for (const iface of sym.implements) {
          const [head = ""] = iface.split("<", 1);
          const base = head.trim();
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
    version: "2.0.0",
    repoRoot: ".",
    stats: { ...stats },
    symbols: stableMap,
    relations,
  };

  const verboseOutput: SymbolsOutput = {
    version: "2.0.0",
    repoRoot: ".",
    stats,
    symbols: verboseMap,
    relations,
    imports: filesImports,
  };

  // Write stable
  const stablePath = path.join(repoRoot, config.output.stable);
  writeAtomic(stablePath, JSON.stringify(stableOutput, null, 2) + "\n");

  // ─── Copie PUBLIÉE : le graphe part avec le paquet `nodefony` ──────────────
  // Sans elle, `.ai/symbols.json` n'existait qu'ici : une application installée
  // depuis npm lisait un fichier absent et recevait une liste vide, sans qu'un
  // seul message ne le dise. Le graphe du monorepo entier est publié par le
  // CŒUR — une application qui installe `nodefony` décrit donc tout le
  // framework, quelle que soit la combinaison de paquets qu'elle a retenue.
  // Un seul exemplaire, pas un par paquet : le contenu serait le même découpé,
  // et 19 copies dériveraient dès qu'une seule ne serait pas régénérée.
  //
  // RÉDUIT aux modules PUBLIÉS : le graphe du dépôt décrit aussi les modules de
  // banc et les paquets privés en chantier, qu'aucune application n'installera.
  // Les publier livrait du code interne — 173 symboles mesurés.
  const shippedPath = path.join(repoRoot, "src/nodefony/.ai/symbols.json");
  const shipped = filterGraphToModules(
    stableOutput,
    publishedModules(publishableWorkspaces(repoRoot)),
  );
  writeAtomic(shippedPath, JSON.stringify(shipped, null, 2) + "\n");

  // Write verbose
  const verbosePath = path.join(repoRoot, config.output.verbose);
  writeAtomic(verbosePath, JSON.stringify(verboseOutput, null, 2) + "\n");

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

/** Un des fichiers donnés est-il dans la zone parsée (include − exclude) ? */
function touchesParsedZone(files: string[]): boolean {
  const includeMatchers = config.include.map((p) => picomatch(p));
  const excludeMatchers = config.exclude.map((p) => picomatch(p));
  return files.some(
    (file) =>
      includeMatchers.some((m) => m(file)) &&
      !excludeMatchers.some((m) => m(file)),
  );
}

/** Lance `git` et rend ses lignes non vides — `null` si git refuse. */
function gitLines(args: string): string[] | null {
  try {
    return execSync(`git ${args}`, { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function checkStaged(): never {
  const staged = gitLines("diff --cached --name-only --diff-filter=ACMR");
  process.exit(staged && touchesParsedZone(staged) ? 1 : 0);
}

// ─── --check-range mode (hooks post-commit / post-merge / post-checkout) ────
//
// Le graphe n'est plus versionné : les hooks le régénèrent APRÈS coup, en
// arrière-plan, quand la zone parsée a bougé entre deux révisions.
//   exit 1 → régénérer (zone touchée, ou graphe absent : clone neuf)
//   exit 0 → rien à faire
function checkRange(from: string | undefined, to: string | undefined): never {
  if (!fs.existsSync(path.join(repoRoot, config.output.stable)))
    process.exit(1);
  if (!from || !to) process.exit(1);
  const changed = gitLines(`diff --name-only ${from} ${to}`);
  // Révision illisible (premier commit, ORIG_HEAD absent) : dans le doute, on
  // régénère — dix secondes en arrière-plan coûtent moins qu'un graphe faux.
  process.exit(changed === null || touchesParsedZone(changed) ? 1 : 0);
}

// Entrypoint
if (process.argv.includes("--check-staged")) {
  checkStaged();
}
const rangeAt = process.argv.indexOf("--check-range");
if (rangeAt !== -1) {
  checkRange(process.argv[rangeAt + 1], process.argv[rangeAt + 2]);
}

generate();
