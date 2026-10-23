/**
 * Unit — `create app .` : créer l'application DANS le dossier courant.
 *
 * C'est la forme que tapent d'abord les générateurs d'application courants, et
 * deux sessions Codex sur deux l'ont essayée avant `-- <nom> --dir .` : elle
 * était refusée (« . » n'est pas un nom en kebab-case), et le refus sortait deux
 * fois (#653). Éprouvé ici : le nom se tire du dossier, le dossier devient la
 * cible, un dossier au nom inutilisable est refusé en nommant le geste qui
 * marche, et un refus d'usage n'imprime qu'une ligne.
 */
import { afterAll, afterEach, assert, describe, it, vi } from "vitest";
import path from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { nameFromDirectory, runCreateCommand } from "../cli/create";
import { SysExit } from "../cli/sysexits";

const racine = mkdtempSync(path.join(tmpdir(), "nf-create-here-"));
afterAll(() => rmSync(racine, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const argv = (...words: string[]): string[] => ["node", "nodefony", ...words];

/** Les lignes écrites sur la sortie d'erreur pendant `fn`. */
async function stderrOf(fn: () => Promise<unknown>): Promise<string> {
  let out = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await fn();
  vi.restoreAllMocks();
  return out;
}

describe("nameFromDirectory — le nom que porte un dossier", () => {
  it("dossier en kebab-case → même nom", () => {
    assert.deepEqual(nameFromDirectory("/x/testharness-codex"), {
      name: "testharness-codex",
    });
  });

  it("casse mixte → ramenée au kebab-case", () => {
    assert.deepEqual(nameFromDirectory("/x/MonApp"), { name: "mon-app" });
  });

  it("dossier inutilisable → refus qui nomme le geste", () => {
    const r = nameFromDirectory("/x/2026 projet");
    assert.property(r, "error");
    assert.include((r as { error: string }).error, "-- <nom> --dir .");
  });
});

describe("create app . — l'application naît dans le dossier courant", () => {
  it("dossier vide `testharness-codex` → app `testharness-codex` écrite ICI", async () => {
    const ici = path.join(racine, "testharness-codex");
    mkdirSync(ici);
    vi.spyOn(process, "cwd").mockReturnValue(ici);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await runCreateCommand(
      argv(
        "create",
        "app",
        ".",
        "--yes",
        "--preset",
        "minimal",
        "--frontend",
        "none",
        "--no-install",
        "--no-git",
      ),
    );
    assert.equal(code, SysExit.OK);
    const pkg = JSON.parse(
      readFileSync(path.join(ici, "package.json"), "utf8"),
    ) as { name: string };
    assert.equal(pkg.name, "testharness-codex");
    assert.isFalse(
      existsSync(path.join(ici, "testharness-codex")),
      "un sous-dossier a été créé au lieu d'écrire ici",
    );
  });

  it("dossier occupé → même refus que `--dir .`", async () => {
    const ici = path.join(racine, "occupe");
    mkdirSync(path.join(ici, "deja"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(ici);
    const err = await stderrOf(() =>
      runCreateCommand(argv("create", "app", ".", "--yes", "--no-install")),
    );
    assert.include(err, "n'est pas vide");
  });

  it("`.` ET `--dir` → refus d'usage, rien d'écrit", async () => {
    const ici = path.join(racine, "double");
    mkdirSync(ici);
    vi.spyOn(process, "cwd").mockReturnValue(ici);
    let code = -1;
    const err = await stderrOf(async () => {
      code = await runCreateCommand(
        argv("create", "app", ".", "--dir", "ailleurs", "--yes"),
      );
    });
    assert.equal(code, SysExit.USAGE);
    assert.include(err, "retire --dir");
  });
});

describe("un nom invalide n'est refusé qu'UNE fois", () => {
  it("`create app Bad_Name` → une seule ligne de refus", async () => {
    let code = -1;
    const err = await stderrOf(async () => {
      code = await runCreateCommand(
        argv(
          "create",
          "app",
          "Bad_Name",
          "--dir",
          path.join(racine, "bad"),
          "--yes",
        ),
      );
    });
    assert.equal(code, SysExit.USAGE);
    assert.lengthOf(err.match(/kebab-case attendu/gu) ?? [], 1, err);
  });
});
