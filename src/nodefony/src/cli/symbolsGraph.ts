import fs from "node:fs";
import path from "node:path";
import type * as TS from "typescript";

/**
 * PRODUCTION du graphe symbolique — seule implémentation, deux appelants.
 *
 * Le graphe (`.ai/symbols.json`) décrit chaque symbole d'un code TypeScript :
 * où il est défini, ce qu'il fait (première phrase du TSDoc), de qui il hérite.
 * Il était produit par un script du DÉPÔT seul, appuyé sur `ts-morph` : une
 * application n'avait aucun moyen de décrire SON code, et l'onglet « API » de
 * ses modules restait vide dans la console d'administration.
 *
 * Ce fichier extrait ce que le script faisait, sur l'API du compilateur
 * TypeScript lui-même — que toute application installe déjà, en dépendance de
 * développement. Le script du dépôt (`scripts/generate/generate-symbols.ts`) et
 * `nodefony symbols --generate` l'appellent tous deux : deux générateurs
 * auraient produit deux formes de graphe, divergentes en silence pour le
 * lecteur unique qu'est `readSymbolsGraph`.
 *
 * Le compilateur est INJECTÉ (`tsApi`) : ce module ne l'importe jamais, il
 * n'ajoute donc aucune dépendance d'exécution au framework, et c'est l'appelant
 * qui décide d'où il vient (le dépôt, ou le `node_modules` de l'application).
 */

/** Le module `typescript`, tel que l'appelant l'a chargé. */
export type TypeScriptApi = typeof TS;

/** Nature d'un symbole dans le graphe. */
export type SymbolKind =
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "function"
  | "const"
  | "decorator-fn";

/** Visibilité d'un membre de classe. */
export type MemberVisibility = "public" | "protected" | "private";

/** Une méthode de classe — graphe détaillé seulement. */
export interface ISymbolMethod {
  name: string;
  static: boolean;
  visibility: MemberVisibility;
  decorators?: string[];
  description?: string;
}

/** Une propriété de classe — graphe détaillé seulement. */
export interface ISymbolProperty {
  name: string;
  static: boolean;
  visibility: MemberVisibility;
}

/** Un symbole tel que le générateur le PRODUIT (forme v2.0 du graphe). */
export interface ISymbolRecord {
  name: string;
  kind: SymbolKind;
  /** Chemin relatif à la racine analysée, séparateur `/`. */
  file: string;
  exported: boolean;
  /** Nom du module (paquet) qui porte le fichier. */
  module: string;
  extends?: string | null;
  implements?: string[];
  decorators?: string[];
  /** Première phrase du TSDoc, ramenée à ~200 caractères. */
  description?: string;
  methods?: ISymbolMethod[];
  properties?: ISymbolProperty[];
  /** Membres d'une énumération ou d'une interface. */
  members?: string[];
  /** Début de la déclaration (fonctions, constantes). */
  signature?: string;
}

/** Les imports d'un fichier — graphe détaillé seulement. */
export interface IFileImports {
  file: string;
  imports: { module: string; names: string[]; isTypeOnly: boolean }[];
}

/** Index inversés pré-calculés du graphe. */
export interface ISymbolRelations {
  /** `class A extends X` → `extendedBy.X = ["A", …]` */
  extendedBy: Record<string, string[]>;
  /** `class A implements X` → `implementedBy.X = ["A", …]` */
  implementedBy: Record<string, string[]>;
  /** `@injectable class A` → `decoratedBy.injectable = ["A", …]` */
  decoratedBy: Record<string, string[]>;
  /** fichier qui importe X → `usedBy.X = ["src/foo.ts", …]` */
  usedBy: Record<string, string[]>;
}

/** Comptes du graphe. */
export interface ISymbolStats {
  files: number;
  symbols: number;
  classes: number;
  interfaces: number;
  types: number;
  enums: number;
  functions: number;
  constants: number;
}

/** Le document écrit sur disque. */
export interface ISymbolsDocument {
  version: string;
  /**
   * Qui l'a produit : {@link SYMBOLS_PRODUCER_REPOSITORY} (le dépôt du
   * framework) ou {@link SYMBOLS_PRODUCER_APPLICATION}. Un producteur ne
   * réécrit jamais le graphe d'un autre.
   */
  producer: string;
  repoRoot: string;
  stats: ISymbolStats;
  /** Indexé par nom ; un homonyme d'un autre module est rangé sous `Module:Nom`. */
  symbols: Record<string, ISymbolRecord>;
  relations: ISymbolRelations;
  imports?: IFileImports[];
}

/** Un fichier source à analyser. */
export interface ISourceInput {
  /** Chemin relatif à la racine analysée, séparateur `/`. */
  file: string;
  module: string;
  text: string;
}

/** Ce que rend une génération. */
export interface ISymbolsGraphResult {
  /** Le graphe léger — symboles EXPORTÉS seulement. */
  stable: ISymbolsDocument;
  /** Le graphe détaillé — tous les symboles, membres et imports. */
  verbose: ISymbolsDocument;
  /** Homonymes rangés sous `Module:Nom`, une ligne lisible chacun. */
  homonyms: string[];
}

/** Version de la FORME du graphe — partagée par tous ses producteurs. */
export const SYMBOLS_GRAPH_VERSION = "2.0.0";

/** Graphe produit par le script du dépôt du framework. */
export const SYMBOLS_PRODUCER_REPOSITORY = "repository";

/** Graphe produit par `nodefony symbols --generate` dans une application. */
export const SYMBOLS_PRODUCER_APPLICATION = "application";

/**
 * Producteur d'un graphe déjà sur disque.
 *
 * @param file - chemin du graphe.
 * @returns son producteur ; `null` si le fichier est absent ; `""` s'il est
 *   illisible ou d'une version qui ne se déclarait pas.
 */
export function readSymbolsProducer(file: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const doc: unknown = JSON.parse(text);
    return typeof doc === "object" &&
      doc !== null &&
      "producer" in doc &&
      typeof doc.producer === "string"
      ? doc.producer
      : "";
  } catch {
    return "";
  }
}

/** Au-delà, un fichier est écarté : un source minifié peut épuiser l'analyseur. */
export const SYMBOLS_MAX_FILE_BYTES = 500_000;

/**
 * Écrit un fichier d'un geste : contenu posé à côté, puis renommé.
 *
 * Un lecteur (agent, console d'administration) peut lire le graphe pendant
 * qu'on le régénère ; il ne doit jamais tomber sur un JSON à moitié écrit. Le
 * renommage remplace la cible sur les trois systèmes.
 *
 * @param file - chemin de destination.
 * @param content - contenu complet.
 */
export function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Lit des fichiers sources pour {@link buildSymbolsGraph}, en écartant ceux
 * qui dépassent {@link SYMBOLS_MAX_FILE_BYTES}.
 *
 * @param root - racine analysée.
 * @param files - chemins relatifs à `root` (n'importe quel séparateur).
 * @param moduleOf - module qui porte un fichier (chemin relatif en `/`).
 * @returns les entrées lues, triées par chemin POSIX, et celles écartées.
 */
export function readSourceInputs(
  root: string,
  files: string[],
  moduleOf: (file: string) => string,
): { inputs: ISourceInput[]; skipped: { file: string; bytes: number }[] } {
  // Un ordre qui ne dépend ni du système de fichiers ni de la plateforme : les
  // relations suivent l'ordre des fichiers, et le graphe doit se reproduire
  // octet pour octet. Clé POSIX : `\\` trierait autrement sous Windows.
  const posix = files
    .map((f) => f.split(path.sep).join("/"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const inputs: ISourceInput[] = [];
  const skipped: { file: string; bytes: number }[] = [];
  for (const file of posix) {
    const abs = path.join(root, file);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) continue;
    if (stat.size > SYMBOLS_MAX_FILE_BYTES) {
      skipped.push({ file, bytes: stat.size });
      continue;
    }
    inputs.push({
      file,
      module: moduleOf(file),
      text: fs.readFileSync(abs, "utf8"),
    });
  }
  return { inputs, skipped };
}

/** Ce qu'un fichier apporte au graphe. */
interface IFileSymbols {
  stable: ISymbolRecord[];
  verbose: ISymbolRecord[];
  imports: IFileImports["imports"];
}

/**
 * Analyse un fichier et en extrait symboles et imports.
 *
 * Seules les déclarations de PREMIER niveau comptent, rangées par nature dans
 * un ordre fixe (classes, interfaces, types, énumérations, fonctions,
 * constantes) : c'est l'ordre que le graphe a toujours eu.
 */
function collectFileSymbols(
  tsApi: TypeScriptApi,
  input: ISourceInput,
): IFileSymbols {
  const ts = tsApi;
  const sf = ts.createSourceFile(
    input.file,
    input.text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const { file, module } = input;

  const hasModifier = (node: TS.Node, kind: TS.SyntaxKind): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);

  const visibilityOf = (node: TS.Node): MemberVisibility =>
    hasModifier(node, ts.SyntaxKind.PrivateKeyword)
      ? "private"
      : hasModifier(node, ts.SyntaxKind.ProtectedKeyword)
        ? "protected"
        : "public";

  // Noms LOCAUX exportés par une clause (`export { Get, Post as Verb };`),
  // sans le mot-clé `export` sur la déclaration. Sans eux, `routerDecorators.ts`
  // (qui exporte ses verbes HTTP en fin de fichier) était invisible au graphe.
  // Les ré-exports d'un AUTRE module (`export { x } from "./y"`) sont ignorés :
  // le symbole appartient au fichier qui le déclare, le compter deux fois
  // créerait un homonyme de lui-même.
  const exportedByClause = new Set<string>();
  // `export default Nom;` — retenu pour une DÉCLARATION (classe, fonction…),
  // pas pour une constante : `export default config` est le patron de tous les
  // fichiers de configuration, et chacun deviendrait un homonyme « config ».
  let defaultExported: string | null = null;
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier) {
      const clause = stmt.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          exportedByClause.add((el.propertyName ?? el.name).getText(sf));
        }
      }
    } else if (
      ts.isExportAssignment(stmt) &&
      ts.isIdentifier(stmt.expression)
    ) {
      defaultExported = stmt.expression.text;
    }
  }
  const isExported = (node: TS.Node, name: string): boolean =>
    hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
    exportedByClause.has(name) ||
    defaultExported === name;

  // Description du bloc TSDoc le plus PROCHE qui en porte une : balises
  // retirées, blancs repliés, ~200 caractères pour que le graphe léger reste
  // léger. Le plus proche, parce qu'un en-tête de fichier précède souvent la
  // première déclaration (le prendre décrivait l'interface par le module) ;
  // « qui en porte une », parce qu'un bloc de seules balises (`@typeParam`)
  // suit parfois la description. L'API publique (`getJSDocCommentsAndTags`)
  // ne rend que le dernier bloc : la liste complète vit sous `jsDoc`.
  const tsDocOf = (node: TS.Node): string | undefined => {
    const all: unknown = "jsDoc" in node ? node.jsDoc : undefined;
    const docs = Array.isArray(all)
      ? all.filter((d): d is TS.JSDoc => ts.isJSDoc(d as TS.Node))
      : ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
    for (let i = docs.length - 1; i >= 0; i--) {
      const doc = docs[i];
      if (!doc) continue;
      const collapsed = (ts.getTextOfJSDocComment(doc.comment) ?? "")
        .replace(/\s+/g, " ")
        .replace(/^\* /, "")
        .trim();
      if (!collapsed) continue;
      return collapsed.length > 200 ? `${collapsed.slice(0, 197)}…` : collapsed;
    }
    return undefined;
  };

  // `@foo`, `@foo()`, `@ns.foo()` → `foo`.
  const decoratorsOf = (node: TS.Node): string[] => {
    if (!ts.canHaveDecorators(node)) return [];
    return (ts.getDecorators(node) ?? []).map((d) => {
      let expr: TS.Expression = d.expression;
      while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
      if (ts.isCallExpression(expr)) expr = expr.expression;
      if (ts.isPropertyAccessExpression(expr)) return expr.name.getText(sf);
      return expr.getText(sf);
    });
  };

  // Un fichier de déclarations, ou un `declare class`, garde ses surcharges.
  const isAmbient = (node: TS.Node): boolean =>
    sf.isDeclarationFile || hasModifier(node, ts.SyntaxKind.DeclareKeyword);

  const heritage = (
    clauses: TS.NodeArray<TS.HeritageClause> | undefined,
    token: TS.SyntaxKind,
  ): string[] =>
    (clauses ?? [])
      .filter((c) => c.token === token)
      .flatMap((c) => c.types.map((t) => t.expression.getText(sf)));

  const classOf = (
    cls: TS.ClassDeclaration,
    verbose: boolean,
  ): ISymbolRecord | null => {
    const name = cls.name?.text;
    if (!name) return null;
    const description = tsDocOf(cls);
    const sym: ISymbolRecord = {
      name,
      kind: "class",
      file,
      exported: isExported(cls, name),
      module,
      extends:
        heritage(cls.heritageClauses, ts.SyntaxKind.ExtendsKeyword)[0] ?? null,
      implements: heritage(
        cls.heritageClauses,
        ts.SyntaxKind.ImplementsKeyword,
      ),
      decorators: decoratorsOf(cls),
    };
    if (description) sym.description = description;
    if (!verbose) return sym;

    // Membres retenus : hors contexte ambiant, une surcharge sans corps
    // (constructeur ou méthode non abstraite) n'est pas un membre de plus.
    const ambient = isAmbient(cls);
    const members: TS.ClassElement[] = cls.members.filter((m) => {
      if (ts.isConstructorDeclaration(m))
        return ambient || m.body !== undefined;
      if (ts.isMethodDeclaration(m)) {
        return (
          ambient ||
          hasModifier(m, ts.SyntaxKind.AbstractKeyword) ||
          m.body !== undefined
        );
      }
      return (
        ts.isPropertyDeclaration(m) ||
        ts.isGetAccessorDeclaration(m) ||
        ts.isSetAccessorDeclaration(m) ||
        ts.isClassStaticBlockDeclaration(m)
      );
    });
    const isStatic = (m: TS.Node): boolean =>
      hasModifier(m, ts.SyntaxKind.StaticKeyword);
    const isProperty = (m: TS.Node): boolean =>
      ts.isPropertyDeclaration(m) ||
      ts.isGetAccessorDeclaration(m) ||
      ts.isSetAccessorDeclaration(m) ||
      ts.isParameter(m);
    // Les propriétés de paramètre (`constructor(private x)`) prennent place
    // juste après le constructeur qui les déclare.
    const withParams: TS.Node[] = [];
    for (const m of members) {
      withParams.push(m);
      if (ts.isConstructorDeclaration(m) && m.body !== undefined) {
        for (const p of m.parameters) {
          if (ts.isParameterPropertyDeclaration(p, m)) withParams.push(p);
        }
      }
    }
    const instance = withParams.filter(
      (m) =>
        !ts.isConstructorDeclaration(m) && (ts.isParameter(m) || !isStatic(m)),
    );
    const statics = withParams.filter(
      (m) =>
        !ts.isConstructorDeclaration(m) && !ts.isParameter(m) && isStatic(m),
    );
    const memberName = (m: TS.Node): string =>
      (m as TS.NamedDeclaration).name?.getText(sf) ?? "";

    const methodOf = (
      m: TS.MethodDeclaration,
      isStaticMethod: boolean,
    ): ISymbolMethod => {
      const entry: ISymbolMethod = {
        name: memberName(m),
        static: isStaticMethod,
        visibility: visibilityOf(m),
        decorators: decoratorsOf(m),
      };
      const doc = tsDocOf(m);
      if (doc) entry.description = doc;
      return entry;
    };
    sym.methods = [
      ...instance.filter(ts.isMethodDeclaration).map((m) => methodOf(m, false)),
      ...statics.filter(ts.isMethodDeclaration).map((m) => methodOf(m, true)),
    ];
    sym.properties = [
      ...instance.filter(isProperty).map((p) => ({
        name: memberName(p),
        static: false,
        visibility: visibilityOf(p),
      })),
      ...statics.filter(isProperty).map((p) => ({
        name: memberName(p),
        static: true,
        visibility: visibilityOf(p),
      })),
    ];
    return sym;
  };

  const interfaceOf = (
    iface: TS.InterfaceDeclaration,
    verbose: boolean,
  ): ISymbolRecord => {
    const name = iface.name.text;
    const description = tsDocOf(iface);
    const sym: ISymbolRecord = {
      name,
      kind: "interface",
      file,
      exported: isExported(iface, name),
      module,
      extends:
        heritage(iface.heritageClauses, ts.SyntaxKind.ExtendsKeyword).join(
          ", ",
        ) || null,
    };
    if (description) sym.description = description;
    if (verbose) {
      sym.members = [
        ...iface.members.filter(ts.isPropertySignature),
        ...iface.members.filter(ts.isMethodSignature),
      ].map((m) => m.name.getText(sf));
    }
    return sym;
  };

  const typeOf = (t: TS.TypeAliasDeclaration): ISymbolRecord => {
    const name = t.name.text;
    const description = tsDocOf(t);
    const sym: ISymbolRecord = {
      name,
      kind: "type",
      file,
      exported: isExported(t, name),
      module,
    };
    if (description) sym.description = description;
    return sym;
  };

  const enumOf = (e: TS.EnumDeclaration, verbose: boolean): ISymbolRecord => {
    const name = e.name.text;
    const description = tsDocOf(e);
    const sym: ISymbolRecord = {
      name,
      kind: "enum",
      file,
      exported: isExported(e, name),
      module,
    };
    if (description) sym.description = description;
    if (verbose) sym.members = e.members.map((m) => m.name.getText(sf));
    return sym;
  };

  const functionOf = (
    f: TS.FunctionDeclaration,
    verbose: boolean,
  ): ISymbolRecord | null => {
    const name = f.name?.text;
    if (!name) return null;
    // Fabrique de décorateur : elle rend un `…Decorator`.
    const returnType = f.type?.getText(sf) ?? "";
    const isDecorator =
      returnType.endsWith("Decorator") || /Decorator\s*\|/.test(returnType);
    const description = tsDocOf(f);
    const sym: ISymbolRecord = {
      name,
      kind: isDecorator ? "decorator-fn" : "function",
      file,
      exported: isExported(f, name),
      module,
    };
    if (description) sym.description = description;
    if (verbose) {
      sym.signature = f.getText(sf).split("\n", 1).join("").slice(0, 200);
    }
    return sym;
  };

  const constsOf = (
    stmt: TS.VariableStatement,
    verbose: boolean,
  ): ISymbolRecord[] => {
    const decls = stmt.declarationList.declarations;
    const viaClause = decls.some((d) =>
      exportedByClause.has(d.name.getText(sf)),
    );
    if (!viaClause && !hasModifier(stmt, ts.SyntaxKind.ExportKeyword))
      return [];
    const description = tsDocOf(stmt);
    return decls.map((d) => {
      const sym: ISymbolRecord = {
        name: d.name.getText(sf),
        kind: "const",
        file,
        exported: true,
        module,
      };
      if (description) sym.description = description;
      if (verbose) sym.signature = d.getText(sf).slice(0, 200);
      return sym;
    });
  };

  const out: IFileSymbols = { stable: [], verbose: [], imports: [] };
  const statements = sf.statements;

  for (const imp of statements.filter(ts.isImportDeclaration)) {
    const clause = imp.importClause;
    const names: string[] = [];
    if (clause?.name) names.push(clause.name.getText(sf));
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        names.push((el.propertyName ?? el.name).getText(sf));
      }
    }
    if (bindings && ts.isNamespaceImport(bindings)) {
      names.push(`* as ${bindings.name.getText(sf)}`);
    }
    out.imports.push({
      module: ts.isStringLiteral(imp.moduleSpecifier)
        ? imp.moduleSpecifier.text
        : imp.moduleSpecifier.getText(sf),
      names,
      isTypeOnly: clause?.phaseModifier === ts.SyntaxKind.TypeKeyword,
    });
  }

  for (const cls of statements.filter(ts.isClassDeclaration)) {
    const stable = classOf(cls, false);
    const verbose = classOf(cls, true);
    if (stable) out.stable.push(stable);
    if (verbose) out.verbose.push(verbose);
  }
  for (const iface of statements.filter(ts.isInterfaceDeclaration)) {
    out.stable.push(interfaceOf(iface, false));
    out.verbose.push(interfaceOf(iface, true));
  }
  for (const t of statements.filter(ts.isTypeAliasDeclaration)) {
    const sym = typeOf(t);
    out.stable.push(sym);
    out.verbose.push(sym);
  }
  for (const e of statements.filter(ts.isEnumDeclaration)) {
    out.stable.push(enumOf(e, false));
    out.verbose.push(enumOf(e, true));
  }
  // Une signature de surcharge n'est pas une fonction de plus — sauf en
  // contexte ambiant, où il n'y a QUE des signatures.
  const functions = statements
    .filter(ts.isFunctionDeclaration)
    .filter((f) => f.body !== undefined || isAmbient(f));
  for (const f of functions) {
    const stable = functionOf(f, false);
    const verbose = functionOf(f, true);
    if (stable) out.stable.push(stable);
    if (verbose) out.verbose.push(verbose);
  }
  for (const stmt of statements.filter(ts.isVariableStatement)) {
    out.stable.push(...constsOf(stmt, false));
    out.verbose.push(...constsOf(stmt, true));
  }
  return out;
}

/** Bucket de {@link ISymbolStats} par nature de symbole. */
const STAT_BUCKET: Record<SymbolKind, keyof ISymbolStats> = {
  class: "classes",
  interface: "interfaces",
  type: "types",
  enum: "enums",
  function: "functions",
  "decorator-fn": "functions",
  const: "constants",
};

/**
 * Indexe une liste de symboles par nom. Le premier gagne le nom simple ; un
 * homonyme d'un autre fichier est rangé sous `Module:Nom`, pour que les deux
 * restent atteignables.
 */
function indexByName(
  list: ISymbolRecord[],
  homonyms: string[] | null,
): Record<string, ISymbolRecord> {
  const map: Record<string, ISymbolRecord> = {};
  for (const sym of list) {
    const existing = map[sym.name];
    if (existing === undefined) {
      map[sym.name] = sym;
      continue;
    }
    if (existing.module === sym.module && existing.file === sym.file) continue;
    const namespaced = `${sym.module}:${sym.name}`;
    map[namespaced] = sym;
    homonyms?.push(
      `${sym.name} existe dans ${existing.module} et ${sym.module} → rangé sous « ${namespaced} »`,
    );
  }
  return map;
}

/** Index inversés d'héritage, d'implémentation et de décoration. */
function relationsOf(list: ISymbolRecord[]): ISymbolRelations {
  const extendedBy: Record<string, string[]> = {};
  const implementedBy: Record<string, string[]> = {};
  const decoratedBy: Record<string, string[]> = {};
  for (const sym of list) {
    if (sym.extends) {
      // Génériques retirés : `BaseService<T>` → `BaseService`.
      const parent = (sym.extends.split(/[<,]/, 1)[0] ?? "").trim();
      if (parent) (extendedBy[parent] ??= []).push(sym.name);
    }
    for (const iface of sym.implements ?? []) {
      const base = (iface.split("<", 1)[0] ?? "").trim();
      if (base) (implementedBy[base] ??= []).push(sym.name);
    }
    for (const dec of sym.decorators ?? []) {
      (decoratedBy[dec] ??= []).push(sym.name);
    }
  }
  return { extendedBy, implementedBy, decoratedBy, usedBy: {} };
}

/**
 * Construit le graphe symbolique d'un ensemble de fichiers.
 *
 * Fonction pure : elle ne lit ni n'écrit rien, et rend le même document pour
 * les mêmes entrées. AUCUN horodatage : un graphe régénéré sur un code
 * inchangé doit être identique octet pour octet — la date de génération vit
 * dans le système de fichiers ou dans `git log`, jamais dans l'artefact.
 *
 * @param tsApi - le module `typescript` chargé par l'appelant.
 * @param inputs - fichiers à analyser (cf {@link readSourceInputs}).
 * @param producer - qui produit ce graphe (cf {@link ISymbolsDocument.producer}).
 * @returns le graphe léger, le graphe détaillé, et les homonymes rangés.
 */
export function buildSymbolsGraph(
  tsApi: TypeScriptApi,
  inputs: ISourceInput[],
  producer: string,
): ISymbolsGraphResult {
  const stableSymbols: ISymbolRecord[] = [];
  const verboseSymbols: ISymbolRecord[] = [];
  const filesImports: IFileImports[] = [];
  const stats: ISymbolStats = {
    files: inputs.length,
    symbols: 0,
    classes: 0,
    interfaces: 0,
    types: 0,
    enums: 0,
    functions: 0,
    constants: 0,
  };

  for (const input of inputs) {
    const found = collectFileSymbols(tsApi, input);
    if (found.imports.length) {
      filesImports.push({ file: input.file, imports: found.imports });
    }
    stableSymbols.push(...found.stable);
    verboseSymbols.push(...found.verbose);
    for (const sym of found.stable) {
      stats.symbols++;
      stats[STAT_BUCKET[sym.kind]]++;
    }
  }

  const exported = stableSymbols.filter((s) => s.exported);
  const homonyms: string[] = [];
  const stableMap = indexByName(exported, homonyms);
  const verboseMap = indexByName(verboseSymbols, null);
  const relations = relationsOf(exported);

  // `usedBy` : nom simple → fichiers qui l'importent (les homonymes partagent
  // le même seau — acceptable pour de l'analyse d'impact).
  const known = new Set(stableSymbols.map((s) => s.name));
  for (const fi of filesImports) {
    for (const imp of fi.imports) {
      for (const name of imp.names) {
        if (known.has(name)) (relations.usedBy[name] ??= []).push(fi.file);
      }
    }
  }

  return {
    stable: {
      version: SYMBOLS_GRAPH_VERSION,
      producer,
      repoRoot: ".",
      stats: { ...stats },
      symbols: stableMap,
      relations,
    },
    verbose: {
      version: SYMBOLS_GRAPH_VERSION,
      producer,
      repoRoot: ".",
      stats,
      symbols: verboseMap,
      relations,
      imports: filesImports,
    },
    homonyms,
  };
}
