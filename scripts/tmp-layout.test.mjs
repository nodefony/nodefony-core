/**
 * Arborescence de `tmp/` — catégories créées, README régénéré, égarés signalés,
 * purge bornée à l'expiré et jamais au runtime.
 */
import { describe, it, expect, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureLayout,
  expiredFiles,
  prune,
  rootStrays,
  strayEntries,
  MAX_AGE_MS,
  RUNTIME_ENTRIES,
  TMP_LAYOUT,
} from "./tmp-layout.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "nf-tmp-layout-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Un `tmp/` neuf par cas, sous la racine jetable du fichier. */
let n = 0;
function freshTmp() {
  const tmp = path.join(root, `tmp-${n++}`);
  mkdirSync(tmp);
  return tmp;
}

/** Écrit un fichier et le vieillit de `ageMs`. */
function file(p, ageMs = 0) {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "x");
  const t = (Date.now() - ageMs) / 1000;
  utimesSync(p, t, t);
  return p;
}

describe("tmp-layout", () => {
  it("crée chaque catégorie et un README qui les nomme toutes", () => {
    const tmp = freshTmp();
    ensureLayout(tmp);
    const readme = readFileSync(path.join(tmp, "README.md"), "utf8");
    for (const c of TMP_LAYOUT) {
      expect(existsSync(path.join(tmp, c.dir))).toBe(true);
      expect(readme).toContain(`\`${c.dir}/\``);
    }
  });

  it("signale ce qui est posé à la racine hors catégorie, jamais le runtime", () => {
    const tmp = freshTmp();
    ensureLayout(tmp);
    file(path.join(tmp, "er2.log"));
    mkdirSync(path.join(tmp, "wait-cut"));
    for (const r of RUNTIME_ENTRIES) file(path.join(tmp, r, "keep"));
    expect(strayEntries(tmp)).toEqual(["er2.log", "wait-cut"]);
  });

  it("ne purge que l'expiré — ni le récent, ni le runtime, ni le README", () => {
    const tmp = freshTmp();
    ensureLayout(tmp);
    const old = file(path.join(tmp, "runs", "vieux.log"), MAX_AGE_MS + 60_000);
    const fresh = file(path.join(tmp, "runs", "frais.log"));
    const upload = file(path.join(tmp, "upload", "reçu.txt"), MAX_AGE_MS * 10);
    const readme = path.join(tmp, "README.md");
    const t = (Date.now() - MAX_AGE_MS * 10) / 1000;
    utimesSync(readme, t, t);

    expect(expiredFiles(tmp)).toEqual([old]);
    prune(tmp);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(upload)).toBe(true);
    expect(existsSync(readme)).toBe(true);
  });

  it("racine du dépôt : signale l'artefact généré, tolère le runtime et le profond", () => {
    const lines = [
      "!! dist/",
      "!! node_modules/",
      "!! tmp/",
      "!! isolate-0x7f-123-v8.log",
      "!! dist-site/",
      "?? rapport.html",
      "!! .ai/symbols.verbose.json",
      "?? src/nouveau.ts",
      " M CLAUDE.md",
    ];
    expect(rootStrays(lines)).toEqual([
      "dist-site",
      "isolate-0x7f-123-v8.log",
      "rapport.html",
    ]);
  });

  it("retire les dossiers vidés par la purge, garde les catégories", () => {
    const tmp = freshTmp();
    ensureLayout(tmp);
    file(
      path.join(tmp, "bench", "archive", "20260901", "r.json"),
      MAX_AGE_MS * 2,
    );
    file(path.join(tmp, "wait-cut", "w.json"), MAX_AGE_MS * 2);
    prune(tmp);
    expect(existsSync(path.join(tmp, "bench", "archive"))).toBe(false);
    expect(existsSync(path.join(tmp, "wait-cut"))).toBe(false);
    expect(existsSync(path.join(tmp, "bench"))).toBe(true);
  });
});
