/**
 * `analyzeScript` — ce que la fiche publique d'un skill dit de chacun de ses scripts.
 *
 * Un module (ni ligne de commande lue, ni usage déclaré) n'a AUCUNE option : les
 * `--x` de son source sont des données — variables CSS, arguments de `git`, options
 * de `rg` relancées par `proof-commands.mjs`. Les publier décrirait une interface
 * qui n'existe pas.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeScript } from "./script-doc.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-script-doc-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name, src) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, src);
  return file;
};

describe("analyzeScript — les options d'un script", () => {
  it("un MODULE ne publie aucune option, même s'il cite des `--x`", () => {
    const file = write(
      "module.mjs",
      '/** Relance rg. */\nexport const argv = ["--no-config", "--color", "never"];\n',
    );
    expect(analyzeScript(file).flags).toEqual([]);
  });

  it("le `$1` d'un remplacement JavaScript n'en fait pas une commande shell", () => {
    const file = write(
      "replace.mjs",
      '/** Lit un corps. */\nexport const f = (l) => l.replace(/`(\\d+)`/g, "$1") + " --count";\n',
    );
    expect(analyzeScript(file).flags).toEqual([]);
  });

  it("un script shell qui lit `$1` publie ses options", () => {
    const file = write(
      "run.sh",
      '#!/bin/sh\n# Lance.\ncase "$1" in --fast) ;; esac\n',
    );
    expect(analyzeScript(file).flags).toEqual(["--fast"]);
  });

  it("une commande qui lit process.argv publie ses options", () => {
    const file = write(
      "cli.mjs",
      '/** Banc. */\nconst a = process.argv.slice(2);\nif (a.includes("--json")) {}\n',
    );
    expect(analyzeScript(file).flags).toEqual(["--json"]);
  });

  it("une commande qui lit ses arguments par un utilitaire importé se reconnaît à sa ligne d'usage", () => {
    const file = write(
      "bench.mjs",
      '/**\n * Banc.\n *   node bench.mjs [--port P]\n */\nconst PORT = arg("port", "5251");\n// --port\n',
    );
    expect(analyzeScript(file).flags).toEqual(["--port"]);
  });
});
