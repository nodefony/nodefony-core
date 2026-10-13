// Les pages `publish: core|none` restent-elles hors du tarball ?
//
// `pagesNonServies` sert deux fois dans `pack-all.mjs` : poser les négations
// de `files` avant `npm pack`, puis constater sur le tarball dépaqueté
// qu'aucune page interne n'y est restée. Ce test éprouve le parcours ET la
// règle réelle du cœur, composée par `regleDApplication`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pagesNonServies, regleDApplication } from "./doc-pages.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const decor = fs.mkdtempSync(path.join(os.tmpdir(), "nf-doc-pages-"));
afterAll(() => fs.rmSync(decor, { recursive: true, force: true }));

// Le premier import charge le cœur et la documentation bâtis : plusieurs
// secondes, payées UNE fois.
let servie;
beforeAll(async () => {
  servie = await regleDApplication();
}, 60_000);

function page(rel, publish) {
  const f = path.join(decor, ...rel.split("/"));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const fm =
    publish === undefined ? "" : `---\ntitle: x\npublish: ${publish}\n---\n`;
  fs.writeFileSync(f, `${fm}# Page\n`);
}

page("docs/interne.md", "core");
page("docs/archive/vieille.md", '"none"');
page("docs/historique.md", "false");
page("docs/publique.md", "user");
page("docs/sans-portee.md", undefined);
page("docs/notes.txt", "core");
page("ailleurs/hors-docs.md", "core");

describe("pagesNonServies — règle du cœur, vue d'une application", () => {
  it("retire core, none et la forme booléenne false ; garde user et l'absence de portée", () => {
    expect(pagesNonServies(decor, servie)).toEqual([
      "docs/archive/vieille.md",
      "docs/historique.md",
      "docs/interne.md",
    ]);
  });

  it("rend des chemins en `/`, ce que `files` attend sur les trois plateformes", () => {
    for (const p of pagesNonServies(decor, servie))
      expect(p).not.toContain("\\");
  });

  it("un paquet sans docs/ ne rend rien", () => {
    expect(pagesNonServies(path.join(decor, "ailleurs"), () => false)).toEqual(
      [],
    );
  });

  it("désigne la page interne réelle du dépôt (realtime/couverture-bancs)", () => {
    const realtime = path.join(
      ROOT,
      "src",
      "packages",
      "@nodefony",
      "realtime",
    );
    expect(pagesNonServies(realtime, servie)).toContain(
      "docs/couverture-bancs.md",
    );
  });
});
