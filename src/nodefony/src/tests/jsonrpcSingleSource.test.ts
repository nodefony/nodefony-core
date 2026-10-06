/// <reference types="node" />
/**
 * JSON-RPC 2.0 : UNE source, et un bundle navigateur qui la tient.
 *
 * Le framework parle JSON-RPC par deux portes — le pair temps réel et le
 * serveur MCP —, qui ont longtemps porté chacune leur copie des codes d'erreur
 * et des formes de message. Les deux copies concordaient, rien ne les tenait
 * ensemble, et elles avaient DÉJÀ divergé (le MCP n'exigeait pas `jsonrpc:
 * "2.0"`). Les briques vivent désormais dans `src/nodefony/src/jsonrpc/`.
 *
 * Deux gardes, parce que la règle peut se perdre de deux façons :
 *
 * 1. **Dans les sources** — quelqu'un réécrit un code standard en littéral
 *    (`-32601`) ou fabrique une frame à la main (`jsonrpc: "2.0"`). Lu sur
 *    l'ARBRE SYNTAXIQUE (API TypeScript) : un commentaire ou une phrase qui
 *    cite le code ne compte pas, une expression si.
 * 2. **Dans l'artefact** — `jsonrpc/` entre dans `nodefony/client` (le pair y
 *    est embarqué). Un import `node:` ou un import de `mcp/` qui s'y glisserait
 *    casserait le navigateur, ou y ferait entrer le serveur MCP. Lu sur le
 *    `dist/client` BÂTI : c'est ce que reçoit l'application, pas ce qu'on écrit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";
import { JsonRpcError, JsonRpcServerError } from "../jsonrpc/index";

/** Racine du dépôt — ce test lit les sources de TOUS les workspaces. */
const REPO = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const SOURCE_ROOT = path.join(REPO, "src");
/** Le seul endroit où ces valeurs ont le droit d'être écrites. */
const HOME = path.join(REPO, "src", "nodefony", "src", "jsonrpc");
const CLIENT_DIST = path.join(REPO, "src", "nodefony", "dist", "client");

/** Chemin d'affichage : un chemin qui VOYAGE s'écrit en `/`. */
const show = (p: string): string =>
  path.relative(REPO, p).split(path.sep).join("/");

/**
 * Codes qui n'ont qu'UNE définition, et le nom à employer à leur place.
 *
 * `-32001` (refus du verrou temps réel) n'y est pas : il a sa constante unique,
 * propre au pair. Les codes MCP (`-32020`, `-32022`) non plus : ils vivent dans
 * `mcp/protocol.ts`, seule source.
 */
const OWNED_CODES = new Map<number, string>([
  ...Object.entries(JsonRpcError).map(([name, code]): [number, string] => [
    code,
    `JsonRpcError.${name}`,
  ]),
  [JsonRpcServerError.DEFAULT, "JsonRpcServerError.DEFAULT"],
]);

/**
 * Ce que la garde des sources ne lit pas — chaque exclusion a son motif.
 *
 * - les bancs (`tests/`, `*.test.*`) écrivent les frames TELLES qu'elles
 *   passent sur le fil : c'est ce qu'ils éprouvent ;
 * - `realtime/nodefony/testing/` est une fabrique de frames de test, publiée
 *   pour les bancs des applications, volontairement libre ;
 * - `dist/`, `node_modules/` : du généré ou du tiers.
 */
const SKIPPED_DIRS = new Set(["node_modules", "dist", "tests", "testing"]);

/** Fichiers TypeScript du périmètre, hors exclusions. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name) || full === HOME) continue;
      sourceFiles(full, out);
    } else if (
      /\.(ts|tsx|mts)$/.test(entry.name) &&
      !/\.test\.|\.d\.ts$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Le nœud est-il le nom `jsonrpc` (identifiant ou chaîne) ? */
const isJsonrpcName = (node: ts.Node): boolean =>
  (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
  node.text === "jsonrpc";

/**
 * Relevé d'un texte source : codes en littéral et frames écrites à la main.
 *
 * @param file - chemin du fichier (affichage et dialecte TSX)
 * @param text - son contenu
 * @returns une ligne par trouvaille, `chemin:ligne  quoi`
 */
function scanText(file: string, text: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: string[] = [];
  const at = (node: ts.Node, what: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    findings.push(`${show(file)}:${line + 1}  ${what}`);
  };
  const visit = (node: ts.Node): void => {
    // `-32601` : un moins unaire devant un littéral numérique.
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand)
    ) {
      // `-32_601` (séparateurs numériques) est le même littéral.
      const name = OWNED_CODES.get(
        -Number(node.operand.text.replaceAll("_", "")),
      );
      if (name) at(node, `-${node.operand.text} → ${name}`);
    }
    // `{ jsonrpc: "2.0", … }` : une frame fabriquée à la main.
    if (
      ts.isPropertyAssignment(node) &&
      isJsonrpcName(node.name) &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === "2.0"
    ) {
      at(node, "frame écrite à la main → fabriques de `jsonrpc/`");
    }
    // `x.jsonrpc !== "2.0"` : une classification écrite à la main.
    if (
      ts.isBinaryExpression(node) &&
      [node.left, node.right].some(
        (side) => ts.isStringLiteral(side) && side.text === "2.0",
      ) &&
      [node.left, node.right].some(
        (side) =>
          (ts.isPropertyAccessExpression(side) &&
            side.name.text === "jsonrpc") ||
          (ts.isElementAccessExpression(side) &&
            isJsonrpcName(side.argumentExpression)),
      )
    ) {
      at(node, "frame classée à la main → classifyJsonRpcFrame");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** Relevé d'un fichier du dépôt — pré-filtré : la plupart ne contiennent rien. */
function scan(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return /3_?2_?(?:7_?0_?0|6_?0_?[0-3]|0_?0_?0)|jsonrpc/.test(text)
    ? scanText(file, text)
    : [];
}

/**
 * Spécificateurs importés par un module JavaScript BÂTI (statiques et
 * dynamiques, réexports compris).
 */
function importedSpecifiers(code: string): string[] {
  const specifiers: string[] = [];
  for (const match of code.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g,
  )) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

/** Fichiers `.js` du bundle client, déclarations exclues. */
function clientBundleFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "types") clientBundleFiles(full, out);
    } else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/**
 * Relevé d'un module bâti : import `node:` (le navigateur ne le résout pas)
 * ou import du serveur MCP (il n'a rien à faire chez le client).
 */
function bundleFindings(file: string, code: string): string[] {
  const findings: string[] = [];
  if (show(file).includes("/mcp/"))
    findings.push(`${show(file)}  module MCP embarqué`);
  for (const spec of importedSpecifiers(code)) {
    // `node:fs` comme `events` nu : un module intégré de Node n'existe pas
    // dans le navigateur (le shim du bundle client, lui, est un chemin relatif).
    if (spec.startsWith("node:") || builtinModules.includes(spec)) {
      findings.push(`${show(file)}  importe ${spec}`);
    } else if (/(^|\/)mcp\//.test(spec))
      findings.push(`${show(file)}  importe ${spec}`);
  }
  return findings;
}

describe("JSON-RPC 2.0 — une seule source (#545)", () => {
  it("🔴 aucun code standard en littéral ni frame fabriquée à la main hors de `jsonrpc/`", () => {
    const files = sourceFiles(SOURCE_ROOT);
    // Témoin : le périmètre n'est pas vide (un chemin faux rendrait 0 fichier,
    // donc 0 trouvaille — un vert qui ne prouverait rien).
    expect(files.length).toBeGreaterThan(500);
    expect(
      files.some((f) => f.endsWith(path.join("realtime", "JsonRpcPeer.ts"))),
    ).toBe(true);

    const findings = files.flatMap(scan);
    expect(
      findings,
      "Ces valeurs ont UNE définition, dans src/nodefony/src/jsonrpc/ — " +
        "importer la constante ou la fabrique depuis `nodefony` :\n" +
        findings.join("\n"),
    ).toEqual([]);
  });

  it("la garde MORD : elle relève un littéral, une frame et une classification écrits à la main", () => {
    // Éprouvée sur un texte construit, pour que la garde ne puisse pas devenir
    // muette sans que rien ne tombe (un pré-filtre trop strict, un nœud renommé
    // par une version de TypeScript).
    const probe = path.join(SOURCE_ROOT, "probe.ts");
    const findings = scanText(
      probe,
      [
        "const a = -32601;",
        "const c = -32_603;",
        "// -32603 dans un commentaire ne compte pas",
        'const s = "-32700 dans une chaîne non plus";',
        'send({ jsonrpc: "2.0", id, result });',
        'if (frame.jsonrpc !== "2.0") return;',
        "const b = -32001; // code propre au temps réel, hors garde",
      ].join("\n"),
    );
    expect(findings.map((f) => f.split("  ")[0])).toEqual([
      "src/probe.ts:1",
      "src/probe.ts:2",
      "src/probe.ts:5",
      "src/probe.ts:6",
    ]);
  });
});

describe("JSON-RPC 2.0 — le bundle navigateur reste isomorphe (#545)", () => {
  it("🔴 `dist/client` n'importe ni `node:` ni le serveur MCP", () => {
    // Pas de saut silencieux : un garde sauté compte comme vert. Sans dist, la
    // passe ÉCHOUE et dit quoi faire (la CI bâtit avant de tester).
    expect(
      existsSync(CLIENT_DIST),
      `${show(CLIENT_DIST)} absent — lancer \`npm run build\` : ce garde lit l'ARTEFACT publié`,
    ).toBe(true);
    const files = clientBundleFiles(CLIENT_DIST);
    // Témoins : le pair ET les briques partagées sont bien dans le bundle lu.
    const shown = files.map(show);
    expect(shown).toContain("src/nodefony/dist/client/realtime/JsonRpcPeer.js");
    expect(shown).toContain("src/nodefony/dist/client/jsonrpc/index.js");

    const findings = files.flatMap((f) =>
      bundleFindings(f, readFileSync(f, "utf8")),
    );
    expect(
      findings,
      "Le bundle navigateur doit rester isomorphe :\n" + findings.join("\n"),
    ).toEqual([]);
  });

  it("la garde MORD : elle relève un import `node:` et un import de `mcp/`", () => {
    const file = path.join(CLIENT_DIST, "jsonrpc", "index.js");
    const findings = bundleFindings(
      file,
      [
        'import { x } from "node:fs";',
        'export { y } from "../mcp/protocol.js";',
        'const z = await import("node:path");',
        'import { EventEmitter } from "events";',
        'import { ok } from "../realtime/JsonRpcPeer.js";',
      ].join("\n"),
    );
    expect(findings).toEqual([
      "src/nodefony/dist/client/jsonrpc/index.js  importe node:fs",
      "src/nodefony/dist/client/jsonrpc/index.js  importe ../mcp/protocol.js",
      "src/nodefony/dist/client/jsonrpc/index.js  importe node:path",
      "src/nodefony/dist/client/jsonrpc/index.js  importe events",
    ]);
  });
});
