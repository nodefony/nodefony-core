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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeScript, createLaunchFinder } from "./script-doc.mjs";

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

describe("createLaunchFinder — un runner lancé sur un DOSSIER", () => {
  const finder = (scripts) =>
    createLaunchFinder(new Map(), JSON.stringify({ scripts }));
  // Construire un finder BALAYE le dépôt (tests de `src/` lus un à un, `git grep`) :
  // ~3 s en local, le double sur le runner macOS de la forge. Une construction par
  // `it` dépassait le délai de 5 s d'un test ; deux constructions, une fois, ici.
  let folderTarget;
  let substringOnly;
  beforeAll(() => {
    folderTarget = finder({ tooling: "vitest run scripts/deps" });
    substringOnly = finder({ one: "node scripts/deps/check.mjs" });
  }, 60_000);

  it("un test rangé PLUSIEURS niveaux sous le dossier ciblé est lancé", () => {
    const { appelants } = folderTarget;
    expect(appelants("scripts/deps/shims/x/index.test.mjs")).toContainEqual({
      label: "un script npm (cible-dossier)",
      name: "npm run tooling",
    });
  });

  it("un dossier cité comme SOUS-CHAÎNE d'un chemin ne lance rien", () => {
    const { appelants } = substringOnly;
    expect(appelants("scripts/deps/shims/x/index.test.mjs")).toEqual([]);
  });

  it("un outil (non-test) du sous-dossier n'est pas blanchi par la cible-dossier", () => {
    const { appelants } = folderTarget;
    expect(appelants("scripts/deps/shims/x/index.mjs")).toEqual([]);
  });
});

describe("createLaunchFinder — un nom de fichier n'est appelé qu'ENTIER", () => {
  // Vécu : `render-demo.mjs` ajouté au script `build` « lançait » le
  // `demo.mjs` du skill html-report — son acquittement passait pour périmé
  // et bloquait tout commit.
  let finder;
  beforeAll(() => {
    finder = createLaunchFinder(
      new Map(),
      JSON.stringify({
        scripts: {
          build: "turbo run build && node scripts/repo/render-probe.mjs",
          other: "node .claude/skills/x/scripts/other-probe.mjs",
          bare: "cd .claude/skills/y/scripts && node runme.mjs",
        },
      }),
    );
  }, 60_000);

  it("un nom qui en TERMINE un autre ne lance rien (probe.mjs ≠ render-probe.mjs)", () => {
    expect(finder.appelants(".claude/skills/z/scripts/probe.mjs")).toEqual([]);
  });

  it("le nom entier, précédé d'un espace, reste un appel", () => {
    expect(
      finder.appelants(".claude/skills/y/scripts/runme.mjs"),
    ).toContainEqual({ label: "un script npm", name: "npm run bare" });
  });
});
