/// <reference types="node" />
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  countModuleDocs,
  listModuleDocs,
  readModuleDoc,
  searchModuleDocs,
} from "../../src/docsReader";

/**
 * Ce que cette suite prouve : l'onglet Docs d'un module ne sert une page
 * `publish: core` que dans le dépôt du framework, et une page `publish: none`
 * nulle part — par la liste, par le slug (lien direct) et par la recherche.
 * Une application générée reçoit ces pages dans `node_modules` : c'est ce
 * lecteur qui ne doit pas les lui montrer.
 */

let root: string;
const mod = (): string => join(root, "realtime");

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "nf-docs-scope-"));
  const write = async (slug: string, publish: string | null) => {
    await mkdir(join(mod(), "docs"), { recursive: true });
    await writeFile(
      join(mod(), "docs", `${slug}.md`),
      [
        "---",
        `title: Page ${slug}`,
        ...(publish ? [`publish: ${publish}`] : []),
        "---",
        "",
        "Le banc éprouve la contre-pression.",
      ].join("\n"),
      "utf8",
    );
  };
  await write("index", null);
  await write("couverture-bancs", "core");
  await write("brouillon", "none");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("docsReader — portée des pages (publish)", () => {
  it("🔴 dans une APPLICATION, la liste ne porte ni core ni none", async () => {
    const slugs = (await listModuleDocs(mod(), false, false)).map(
      (d) => d.slug,
    );
    expect(slugs).to.deep.equal(["index"]);
  });

  it("dans le DÉPÔT du framework, la page core est servie, la page none jamais", async () => {
    const slugs = (await listModuleDocs(mod(), false, true)).map((d) => d.slug);
    expect(slugs.sort()).to.deep.equal(["couverture-bancs", "index"]);
  });

  it("🔴 le lien direct ne contourne pas la portée", async () => {
    expect(await readModuleDoc(mod(), "couverture-bancs", false)).to.equal(
      null,
    );
    expect(await readModuleDoc(mod(), "couverture-bancs", true)).to.not.equal(
      null,
    );
    expect(await readModuleDoc(mod(), "brouillon", true)).to.equal(null);
  });

  it("🔴 le compte du module (KPI) suit la même portée que la liste", async () => {
    expect(await countModuleDocs(mod(), false)).to.equal(1);
    expect(await countModuleDocs(mod(), true)).to.equal(2);
  });

  it("🔴 la recherche ne trouve pas une page core hors du dépôt", async () => {
    const target = [{ key: "realtime", path: mod() }];
    const app = await searchModuleDocs(target, "contre-pression");
    expect(app.hits.map((h) => h.slug)).to.deep.equal(["index"]);
    const repo = await searchModuleDocs(target, "contre-pression", {
      frameworkRepository: true,
    });
    expect(repo.hits.map((h) => h.slug).sort()).to.deep.equal([
      "couverture-bancs",
      "index",
    ]);
  });
});
