/**
 * Éprouve le gate de syntaxe des bundles : il doit REFUSER un fichier que V8 ne
 * lit pas, accepter l'ESM valide, trouver les dossiers de build sous les deux
 * séparateurs, et ne jamais rendre vert sur zéro fichier.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkAll,
  checkSyntax,
  findBundleDirs,
  isBundleDir,
  listScripts,
} from "./check-bundle-syntax.mjs";

const SCRIPT = fileURLToPath(
  new URL("./check-bundle-syntax.mjs", import.meta.url),
);

let racine = "";
let studio = "";
let module = "";

beforeAll(() => {
  racine = mkdtempSync(path.join(tmpdir(), "nf-bundle-syntax-"));
  studio = path.join(racine, "studio", "dist", "frontend");
  module = path.join(racine, "mod", "public", "dist");
  mkdirSync(path.join(studio, "assets"), { recursive: true });
  mkdirSync(module, { recursive: true });
  // La forme exacte du défaut vécu : un appel dont la parenthèse manque, dans un ESM minifié.
  writeFileSync(
    path.join(studio, "assets", "index-bad.js"),
    'import{a as e}from"./c.js";e(1,{b:2};\n',
  );
  writeFileSync(
    path.join(studio, "assets", "chunk-ok.js"),
    'import{a as e}from"./c.js";export const x=e(1,{b:2});\n',
  );
  writeFileSync(path.join(module, "main.mjs"), "export default 1;\n");
  // Hors build : ne doit PAS être parcouru.
  mkdirSync(path.join(racine, "node_modules", "x", "dist", "frontend"), {
    recursive: true,
  });
  writeFileSync(
    path.join(racine, "node_modules", "x", "dist", "frontend", "bad.js"),
    "f(;\n",
  );
});

afterAll(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe("check-bundle-syntax", () => {
  it("reconnaît les sorties de build de front, quel que soit le séparateur", () => {
    expect(isBundleDir("src/packages/@nodefony/studio/dist/frontend")).toBe(
      true,
    );
    expect(
      isBundleDir(path.win32.join("src", "modules", "m", "public", "dist")),
    ).toBe(true);
    expect(isBundleDir("dist/frontend/")).toBe(true);
    expect(isBundleDir("src/demo/dist/nodefony/frontend")).toBe(false);
    expect(
      isBundleDir("src/packages/@nodefony/studio/dist/types/frontend"),
    ).toBe(false);
  });

  it("trouve les deux dossiers de build et ignore node_modules", () => {
    expect(findBundleDirs(racine)).toEqual([module, studio].sort());
  });

  it("V8 refuse le fichier cassé et accepte l'ESM valide", async () => {
    expect(
      await checkSyntax(path.join(studio, "assets", "index-bad.js")),
    ).toMatch(/SyntaxError/);
    expect(
      await checkSyntax(path.join(studio, "assets", "chunk-ok.js")),
    ).toBeNull();
  });

  it("checkAll rend exactement les fichiers refusés", async () => {
    const files = [...listScripts(studio), ...listScripts(module)];
    expect(files).toHaveLength(3);
    const failures = await checkAll(files);
    expect(failures.map((f) => path.basename(f.file))).toEqual([
      "index-bad.js",
    ]);
  });

  it("la commande échoue sur un bundle cassé, et sur zéro fichier", () => {
    const run = (...args) => {
      try {
        execFileSync(process.execPath, [SCRIPT, ...args], { stdio: "pipe" });
        return 0;
      } catch (e) {
        return /** @type {{ status: number }} */ (e).status;
      }
    };
    expect(run(studio)).toBe(1);
    expect(run(module)).toBe(0);
    const vide = path.join(racine, "vide");
    mkdirSync(vide);
    expect(run(vide)).toBe(1);
    expect(run(vide, "--allow-empty")).toBe(0);
  });
});
