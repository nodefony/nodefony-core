// Les règles du contrôle de dérive, sans réseau : l'accès GitHub est un faux
// qui rend ce que chaque cas exige, le système de fichiers un dossier jetable.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  COMPARE_FILE_LIMIT,
  anchorDrift,
  checkLocalCopies,
  contentFingerprint,
  copyDrift,
  findFrozenDirs,
} from "./amont-lib.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "nf-amont-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
function corpus(files) {
  const dir = path.join(root, `c${(seq += 1)}`);
  mkdirSync(dir);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

function pinned(dir, name, extra = {}) {
  return {
    path: `docs/${name}`,
    blob: "b0",
    sha256: contentFingerprint(path.join(dir, name)),
    ...extra,
  };
}

/** Faux accès GitHub : `routes` associe un préfixe de route à sa réponse. */
function fakeGet(routes) {
  return async (route) => {
    for (const [prefix, answer] of Object.entries(routes)) {
      if (route.startsWith(prefix)) return answer;
    }
    throw new Error(`route non prévue : ${route}`);
  };
}

describe("checkLocalCopies — l'intégrité hors ligne d'un corpus", () => {
  it("ne signale rien quand chaque fichier est déclaré et intact", () => {
    const dir = corpus({ "a.md": "A\n", "INDEX.md": "index" });
    const manifest = {
      sources: [
        { repo: "o/r", ref: "main", copies: { "a.md": pinned(dir, "a.md") } },
      ],
      untracked: { "INDEX.md": "rédigé ici" },
    };
    expect(checkLocalCopies(dir, manifest)).toEqual([]);
  });

  it("nomme la page retouchée sans avoir été re-figée", () => {
    const dir = corpus({ "a.md": "A\n" });
    const manifest = {
      sources: [
        { repo: "o/r", ref: "main", copies: { "a.md": pinned(dir, "a.md") } },
      ],
    };
    writeFileSync(path.join(dir, "a.md"), "A retouchée\n");
    expect(checkLocalCopies(dir, manifest)).toEqual([
      { file: "a.md", problem: "modified" },
    ]);
  });

  it("ne prend pas une extraction CRLF pour une retouche", () => {
    const dir = corpus({ "a.md": "l1\nl2\n" });
    const manifest = {
      sources: [
        { repo: "o/r", ref: "main", copies: { "a.md": pinned(dir, "a.md") } },
      ],
    };
    writeFileSync(path.join(dir, "a.md"), "l1\r\nl2\r\n");
    expect(checkLocalCopies(dir, manifest)).toEqual([]);
  });

  it("nomme la page présente mais ni suivie ni déclarée hors amont", () => {
    const dir = corpus({ "a.md": "A", "orpheline.md": "?" });
    const manifest = {
      sources: [
        { repo: "o/r", ref: "main", copies: { "a.md": pinned(dir, "a.md") } },
      ],
    };
    expect(checkLocalCopies(dir, manifest)).toEqual([
      { file: "orpheline.md", problem: "undeclared" },
    ]);
  });

  it("nomme la copie déclarée absente, et celle jamais figée", () => {
    const dir = corpus({ "b.md": "B" });
    const manifest = {
      sources: [
        {
          repo: "o/r",
          ref: "main",
          copies: {
            "a.md": { path: "a.md", blob: "x", sha256: "y" },
            "b.md": { path: "b.md" },
          },
        },
      ],
    };
    expect(checkLocalCopies(dir, manifest)).toEqual([
      { file: "a.md", problem: "missing" },
      { file: "b.md", problem: "unpinned" },
    ]);
  });
});

describe("copyDrift — la dérive d'une page, par blob", () => {
  const source = { repo: "o/r", ref: "main" };
  const copy = { path: "docs/a.md", blob: "b0" };

  it("rend fresh quand le blob de tête est celui figé", async () => {
    const get = fakeGet({
      "repos/o/r/contents/": { status: 200, body: { sha: "b0" } },
    });
    expect(await copyDrift(source, copy, get)).toEqual({ state: "fresh" });
  });

  it("rend drifted avec la date du dernier changement", async () => {
    const get = fakeGet({
      "repos/o/r/contents/": { status: 200, body: { sha: "b1" } },
      "repos/o/r/commits?": {
        status: 200,
        body: [{ commit: { committer: { date: "2026-10-02T16:11:08Z" } } }],
      },
    });
    expect(await copyDrift(source, copy, get)).toEqual({
      state: "drifted",
      since: "2026-10-02T16:11:08Z",
    });
  });

  it("rend removed quand l'amont ne connaît plus le fichier", async () => {
    const get = fakeGet({ "repos/o/r/contents/": { status: 404, body: null } });
    expect(await copyDrift(source, copy, get)).toEqual({ state: "removed" });
  });

  it("rend unknown quand l'amont ne répond pas — jamais fresh", async () => {
    const get = fakeGet({ "repos/o/r/contents/": null });
    expect(await copyDrift(source, copy, get)).toEqual({ state: "unknown" });
  });
});

describe("anchorDrift — un dossier ancré à un SHA", () => {
  const anchor = {
    repo: "o/r",
    ref: "main",
    sha: "s0",
    fichiers: ["a.adoc", "b.adoc"],
  };
  const head = { status: 200, body: { sha: "s1" } };

  it("suit un fichier suivi renommé par son ancien nom", async () => {
    const get = fakeGet({
      "repos/o/r/commits/main": head,
      "repos/o/r/compare/": {
        status: 200,
        body: {
          ahead_by: 2,
          html_url: "u",
          files: [{ filename: "c.adoc", previous_filename: "b.adoc" }],
        },
      },
    });
    expect(await anchorDrift(anchor, get)).toEqual({
      state: "drifted",
      touched: ["b.adoc"],
      url: "u",
    });
  });

  it("compare les blobs quand le comparatif est tronqué, au lieu de conclure à jour", async () => {
    // Le comparatif plein ne cite aucun fichier suivi : sans repli, « à jour ».
    const files = Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) => ({
      filename: `bruit/${i}`,
    }));
    const get = fakeGet({
      "repos/o/r/commits/main": head,
      "repos/o/r/compare/": {
        status: 200,
        body: { ahead_by: 900, html_url: "u", files },
      },
      "repos/o/r/contents/a.adoc?ref=s0": { status: 200, body: { sha: "x" } },
      "repos/o/r/contents/a.adoc?ref=s1": { status: 200, body: { sha: "x" } },
      "repos/o/r/contents/b.adoc?ref=s0": { status: 200, body: { sha: "y" } },
      "repos/o/r/contents/b.adoc?ref=s1": { status: 200, body: { sha: "z" } },
    });
    expect(await anchorDrift(anchor, get)).toEqual({
      state: "drifted",
      touched: ["b.adoc"],
      url: "u",
    });
  });
});

describe("findFrozenDirs — le balayage de tous les skills", () => {
  it("rend chaque sous-dossier d'un references/, et seulement eux", () => {
    const skills = path.join(root, "skills");
    mkdirSync(path.join(skills, "s1", "references", "corpus"), {
      recursive: true,
    });
    mkdirSync(path.join(skills, "s2", "scripts"), { recursive: true });
    writeFileSync(path.join(skills, "s1", "references", "plat.md"), "");
    expect(findFrozenDirs(skills).map((d) => d.label)).toEqual(["s1/corpus"]);
  });
});
