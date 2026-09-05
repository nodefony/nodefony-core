#!/usr/bin/env node
/**
 * Renomme des identifiants par le LanguageService TypeScript — jamais par regex.
 *
 * Outil du chantier #187 (« écrire tous les identifiants du framework en
 * anglais ») : il part d'une DÉCLARATION repérée dans l'arbre syntaxique, demande
 * à TypeScript tous ses sites d'usage, et applique les éditions telles quelles.
 * Les chaînes de caractères et les commentaires ne sont jamais touchés — la règle
 * du dépôt veut que la prose reste en français.
 *
 * Usage :
 *   node scripts/rename-identifiers.mjs --project src/nodefony/tsconfig.json \
 *        --plan tmp/plan.json [--dry]
 *
 * Le plan est un objet { "<fichier>": { "<ancienNom>": "<nouveauNom>" } }.
 * Les chemins sont relatifs à la racine du dépôt.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const repoRoot = process.cwd();

const argv = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const projectPath = path.resolve(
  repoRoot,
  readFlag("--project", "src/nodefony/tsconfig.json"),
);
const planPath = path.resolve(repoRoot, readFlag("--plan", ""));
const dryRun = argv.includes("--dry");

if (!fs.existsSync(planPath)) {
  console.error(`Plan introuvable : ${planPath}`);
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

// --- Programme TypeScript -------------------------------------------------
const parsed = ts.getParsedCommandLineOfConfigFile(
  projectPath,
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      process.exit(2);
    },
  },
);
if (!parsed) {
  console.error(`tsconfig illisible : ${projectPath}`);
  process.exit(2);
}

/** Contenu courant de chaque fichier, édité en mémoire avant écriture. */
const contents = new Map();
const versions = new Map();
const normalize = (p) => path.resolve(repoRoot, p).replace(/\\/g, "/");
const readCurrent = (fileName) => {
  const key = normalize(fileName);
  if (!contents.has(key)) {
    contents.set(key, ts.sys.readFile(key) ?? "");
    versions.set(key, 0);
  }
  return contents.get(key);
};

const host = {
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (fileName) =>
    String(versions.get(normalize(fileName)) ?? 0),
  getScriptSnapshot: (fileName) => {
    const key = normalize(fileName);
    if (contents.has(key))
      return ts.ScriptSnapshot.fromString(contents.get(key));
    if (!ts.sys.fileExists(key)) return undefined;
    return ts.ScriptSnapshot.fromString(readCurrent(key));
  },
  getCurrentDirectory: () => repoRoot,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: (f) => contents.has(normalize(f)) || ts.sys.fileExists(f),
  readFile: (f) =>
    contents.has(normalize(f))
      ? contents.get(normalize(f))
      : ts.sys.readFile(f),
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
  realpath: ts.sys.realpath,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());

// --- Repérage des déclarations -------------------------------------------
/** Vrai si `node` est le NOM d'une déclaration (et non un simple usage). */
const isDeclarationName = (node) => {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return false; // la déclaration est ailleurs
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
    return parent.propertyName === undefined && parent.name === node;
  }
  return "name" in parent && parent.name === node;
};

/**
 * Positions des déclarations nommées `name` dans ce fichier.
 *
 * `line` restreint aux déclarations situées sur cette ligne : une même
 * orthographe peut nommer des symboles SANS rapport — une fonction et la
 * propriété d'une interface — que rien ne doit renommer ensemble.
 */
const collectDeclarations = (sourceFile, name, line) => {
  const found = [];
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === name &&
      isDeclarationName(node)
    ) {
      const start = node.getStart(sourceFile);
      if (line === undefined) found.push(start);
      else if (
        sourceFile.getLineAndCharacterOfPosition(start).line + 1 ===
        line
      ) {
        found.push(start);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

// --- Application ----------------------------------------------------------
const preferences = { providePrefixAndSuffixTextForRename: true };
/** Éditions collectées par fichier, appliquées de la fin vers le début. */
const applyEdits = (edits) => {
  const byFile = new Map();
  for (const location of edits) {
    const key = normalize(location.fileName);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(location);
  }
  for (const [file, locations] of byFile) {
    let text = readCurrent(file);
    locations.sort((a, b) => b.textSpan.start - a.textSpan.start);
    for (const location of locations) {
      const start = location.textSpan.start;
      const end = start + location.textSpan.length;
      const replacement = `${location.prefixText ?? ""}${location.newName}${location.suffixText ?? ""}`;
      text = text.slice(0, start) + replacement + text.slice(end);
    }
    contents.set(file, text);
    versions.set(file, (versions.get(file) ?? 0) + 1);
  }
  return byFile;
};

let renamed = 0;
let sites = 0;
const untouched = [];
const touchedFiles = new Set();

for (const [relFile, table] of Object.entries(plan)) {
  const fileName = normalize(relFile);
  for (const [entry, newName] of Object.entries(table)) {
    // « nom » vise toutes les déclarations de ce nom ; « nom@512 » vise la
    // seule déclaration de la ligne 512.
    const at = entry.lastIndexOf("@");
    const oldName = at === -1 ? entry : entry.slice(0, at);
    const line = at === -1 ? undefined : Number(entry.slice(at + 1));
    const program = service.getProgram();
    const sourceFile = program?.getSourceFile(fileName);
    if (!sourceFile) {
      untouched.push(`${relFile} — absent du programme TypeScript`);
      continue;
    }
    // Une même orthographe peut nommer plusieurs symboles DISTINCTS (un
    // paramètre déclaré dans sept fonctions) : chacun se renomme séparément.
    // Un renommage édite des sites situés AVANT comme APRÈS la position
    // traitée, donc tous les autres offsets deviennent faux — on recollecte à
    // chaque tour au lieu de réutiliser un relevé périmé. Sans cela, une
    // déclaration sur deux passe à travers, et l'outil l'annonce comme « non
    // renommable » au lieu de la renommer.
    let remaining = collectDeclarations(sourceFile, oldName, line).length;
    if (remaining === 0) {
      untouched.push(`${relFile} — aucune déclaration nommée « ${oldName} »`);
      continue;
    }
    let guard = remaining + 1;
    while (remaining > 0 && guard > 0) {
      guard -= 1;
      const current = service.getProgram()?.getSourceFile(fileName);
      if (!current) break;
      const positions = collectDeclarations(current, oldName, line);
      if (positions.length === 0) break;
      const position = positions[0];
      const locations = service.findRenameLocations(
        fileName,
        position,
        false,
        false,
        preferences,
      );
      if (!locations || locations.length === 0) {
        untouched.push(
          `${relFile}:${position} — « ${oldName} » non renommable`,
        );
        break;
      }
      const withName = locations.map((l) => ({ ...l, newName }));
      if (dryRun) {
        for (const l of locations) touchedFiles.add(normalize(l.fileName));
        remaining = 0; // à blanc, rien n'est édité : une passe suffit à décrire
        renamed += positions.length;
        sites += locations.length;
        break;
      }
      for (const file of applyEdits(withName).keys()) touchedFiles.add(file);
      renamed += 1;
      sites += locations.length;
      const after = service.getProgram()?.getSourceFile(fileName);
      remaining = after ? collectDeclarations(after, oldName, line).length : 0;
    }
    if (guard === 0)
      untouched.push(`${relFile} — « ${oldName} » : boucle bornée atteinte`);
  }
}

if (!dryRun) {
  for (const [file, text] of contents) {
    if (touchedFiles.has(file)) fs.writeFileSync(file, text);
  }
}

console.log(
  `${dryRun ? "[à blanc] " : ""}${renamed} symbole(s) renommé(s), ${sites} site(s), ${touchedFiles.size} fichier(s).`,
);
for (const line of untouched) console.log(`  ⚠️ ${line}`);
process.exit(untouched.length > 0 ? 1 : 0);
