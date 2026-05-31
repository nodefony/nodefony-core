import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanDocsDir } from "../../src/docScanner";

let base: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "nf-docscan-"));
  await mkdir(join(base, "guides"), { recursive: true });
  await mkdir(join(base, "node_modules"), { recursive: true });
  await writeFile(
    join(base, "index.md"),
    "---\ntitle: Accueil\naudience: [developer]\n---\nx",
  );
  await writeFile(join(base, "guides", "01-intro.md"), "# pas de frontmatter");
  await writeFile(join(base, "node_modules", "junk.md"), "# segment exclu");
  await writeFile(join(base, "notes.txt"), "pas un .md");
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("scanDocsDir", () => {
  it("dossier absent → [] (best-effort, pas d'erreur)", async () => {
    expect(await scanDocsDir(join(base, "nope"))).toEqual([]);
  });

  it("ne retourne que les .md, exclut les segments exclus, trié par relPath", async () => {
    const docs = await scanDocsDir(base, { kind: "root" }, ["node_modules"]);
    const slugs = docs.map((d) => d.slug);
    expect(slugs).toEqual(["root~guides~01-intro", "root~index"]);
    expect(slugs).not.toContain("root~node_modules~junk");
  });

  it("calcule le group et le titre (frontmatter > nom de fichier humanisé)", async () => {
    const docs = await scanDocsDir(base, { kind: "root" }, ["node_modules"]);
    const by = new Map(docs.map((d) => [d.slug, d]));
    const index = by.get("root~index")!;
    expect(index.group).toBe("racine");
    expect(index.title).toBe("Accueil"); // frontmatter
    expect(index.meta.audience).toEqual(["developer"]);
    const intro = by.get("root~guides~01-intro")!;
    expect(intro.group).toBe("guides");
    expect(intro.title).toBe("Intro"); // humanisé : préfixe « 01- » retiré
  });

  it("tague la source module et préfixe les slugs en mod~", async () => {
    const docs = await scanDocsDir(
      base,
      { kind: "module", module: "@nodefony/http" },
      ["node_modules"],
    );
    expect(docs.length).toBe(2);
    expect(docs.every((d) => d.slug.startsWith("mod~http~"))).toBe(true);
  });
});
