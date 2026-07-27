/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from "chai";
import assert from "node:assert";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Builder, { BuilderObject } from "../../command/Builder";
import Command from "../../command/Command";
import Cli from "../../Cli";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TMP = path.resolve(process.cwd(), "tmp");

function makeCli(): Cli {
  return new Cli("NODE", { clear: false, asciify: false, autostart: false });
}

async function makeBuilder(): Promise<Builder> {
  const cli = makeCli();
  const cmd = new Command("start", "start framework", cli);
  return new Builder(cmd);
}

async function cleanTmp(name: string): Promise<void> {
  const target = path.join(TMP, name);
  await fsp.rm(target, { recursive: true, force: true });
}

// ─── 1. Construction ─────────────────────────────────────────────────────────

describe("Builder — construction", () => {
  it("instance créée depuis un Command", async () => {
    const builder = await makeBuilder();
    assert(builder instanceof Builder);
  });

  it("force = false par défaut", async () => {
    const builder = await makeBuilder();
    assert.strictEqual(builder.force, false);
  });

  it("location = process.cwd() par défaut", async () => {
    const builder = await makeBuilder();
    assert.strictEqual(builder.location, process.cwd());
  });
});

// ─── 2. build() — directory ───────────────────────────────────────────────────

describe("Builder — build() directory", () => {
  let builder: Builder;
  beforeAll(async () => {
    builder = await makeBuilder();
    await fsp.mkdir(TMP, { recursive: true });
  });

  afterEach(async () => {
    await cleanTmp("testDir");
  });

  it("crée un répertoire simple", async () => {
    const obj: BuilderObject = { name: "testDir", type: "directory" };
    const result = await builder.build(obj, TMP, true);
    expect(result).not.to.be.null;
    expect(result?.name).to.equal("testDir");
    assert.ok(fs.existsSync(path.join(TMP, "testDir")));
  });

  it("retourne le résultat avec le bon nom", async () => {
    const obj: BuilderObject = { name: "testDir", type: "directory" };
    const result = await builder.build(obj, TMP, true);
    assert.strictEqual(result?.name, "testDir");
  });

  it("force=true — recrée si existant", async () => {
    const obj: BuilderObject = { name: "testDir", type: "directory" };
    await builder.build(obj, TMP, true);
    const result = await builder.build(obj, TMP, true);
    assert.ok(result !== null);
  });
});

// ─── 3. build() — file ───────────────────────────────────────────────────────

describe("Builder — build() file", () => {
  let builder: Builder;
  beforeAll(async () => {
    builder = await makeBuilder();
    await fsp.mkdir(TMP, { recursive: true });
  });

  afterEach(async () => {
    await cleanTmp("testFichier");
    await cleanTmp("testFile2");
  });

  it("crée un fichier simple", async () => {
    const obj: BuilderObject = { name: "testFichier", type: "file" };
    const result = await builder.build(obj, TMP);
    expect(result).not.to.be.null;
    assert.ok(fs.existsSync(path.join(TMP, "testFichier")));
  });

  it("fichier créé est vide par défaut", async () => {
    const obj: BuilderObject = { name: "testFile2", type: "file" };
    await builder.build(obj, TMP);
    const content = fs.readFileSync(path.join(TMP, "testFile2"), "utf-8");
    assert.strictEqual(content, "");
  });
});

// ─── 4. build() — symlink ─────────────────────────────────────────────────────

describe("Builder — build() symlink", () => {
  let builder: Builder;
  beforeAll(async () => {
    builder = await makeBuilder();
    await fsp.mkdir(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, "symlinkSource"), "");
  });

  afterEach(async () => {
    await cleanTmp("testSymlink");
  });

  it("crée un symlink vers un fichier existant", async () => {
    const obj: BuilderObject = {
      name: "testSymlink",
      type: "symlink",
      params: {
        source: path.join(TMP, "symlinkSource"),
        dest: path.join(TMP, "testSymlink"),
      },
    };
    const result = await builder.build(obj, TMP, true);
    expect(result).not.to.be.null;
    assert.ok(fs.existsSync(path.join(TMP, "testSymlink")));
  });
});

// ─── 5. build() — arborescence récursive ─────────────────────────────────────

describe("Builder — build() arborescence récursive", () => {
  let builder: Builder;
  beforeAll(async () => {
    builder = await makeBuilder();
    await fsp.mkdir(TMP, { recursive: true });
  });

  afterEach(async () => {
    await cleanTmp("parentDirectory");
  });

  it("répertoire avec enfants récursifs", async () => {
    const obj: BuilderObject = {
      name: "parentDirectory",
      type: "directory",
      childs: [
        { name: "childFile", type: "file" },
        {
          name: "childDirectory",
          type: "directory",
          childs: [{ name: "grandchildFile", type: "file" }],
        },
      ],
    };
    const result = await builder.build(obj, TMP, true);
    expect(result).not.to.be.null;
    expect(result?.name).to.equal("parentDirectory");
    assert.ok(fs.existsSync(path.join(TMP, "parentDirectory", "childFile")));
    assert.ok(
      fs.existsSync(path.join(TMP, "parentDirectory", "childDirectory")),
    );
    assert.ok(
      fs.existsSync(
        path.join(TMP, "parentDirectory", "childDirectory", "grandchildFile"),
      ),
    );
  });

  it("arborescence 3 niveaux — tous les nœuds créés", async () => {
    const obj: BuilderObject = {
      name: "parentDirectory",
      type: "directory",
      childs: [
        {
          name: "level1",
          type: "directory",
          childs: [
            {
              name: "level2",
              type: "directory",
              childs: [{ name: "deep.txt", type: "file" }],
            },
          ],
        },
      ],
    };
    await builder.build(obj, TMP, true);
    assert.ok(
      fs.existsSync(
        path.join(TMP, "parentDirectory", "level1", "level2", "deep.txt"),
      ),
    );
  });
});

// ─── 6. build() — copy ───────────────────────────────────────────────────────

describe("Builder — build() copy", () => {
  let builder: Builder;

  // Décor PROPRE au test. Il copiait auparavant `src/tests`, c'est-à-dire l'arbre
  // de tests du dépôt — le seul endroit du code qui porte des symlinks, et ils y
  // forment une BOUCLE (`data/dir2` → `dir1/dir2`, `dir1/dir2/dir3/dir2` →
  // `../../../dir2`). Invisible sous POSIX (`fs.cp` ne déréférence pas), le
  // décor changeait sous Windows où un checkout sans privilège matérialise ces
  // liens en fichiers : ENOENT en pleine descente. Un test de copie doit poser
  // l'arbre qu'il copie, sinon il éprouve le dépôt et non la brique.
  const FIXTURE = path.join(TMP, "copyFixture");

  beforeAll(async () => {
    builder = await makeBuilder();
    await fsp.mkdir(path.join(FIXTURE, "sub", "deep"), { recursive: true });
    await fsp.writeFile(path.join(FIXTURE, "file.txt"), "racine");
    await fsp.writeFile(path.join(FIXTURE, "sub", "nested.txt"), "niveau 1");
    await fsp.writeFile(
      path.join(FIXTURE, "sub", "deep", "leaf.txt"),
      "feuille",
    );
  });

  afterAll(async () => {
    await cleanTmp("copyFixture");
  });

  afterEach(async () => {
    await cleanTmp("copied");
  });

  it("copie récursive — l'arborescence ET le contenu arrivent", async () => {
    const obj: BuilderObject = {
      name: "copied",
      type: "copy",
      path: FIXTURE,
      params: { recurse: true },
    };
    await builder.build(obj, TMP);
    const copied = path.join(TMP, "copied");
    assert.ok(fs.existsSync(path.join(copied, "file.txt")));
    assert.ok(fs.existsSync(path.join(copied, "sub", "nested.txt")));
    assert.strictEqual(
      fs.readFileSync(path.join(copied, "sub", "deep", "leaf.txt"), "utf8"),
      "feuille",
      "la copie doit descendre jusqu'à la feuille, pas seulement créer la racine",
    );
  });

  it("sans `recurse`, un fichier seul est copié", async () => {
    const obj: BuilderObject = {
      name: "copied",
      type: "copy",
      path: path.join(FIXTURE, "file.txt"),
    };
    await builder.build(obj, TMP);
    assert.strictEqual(
      fs.readFileSync(path.join(TMP, "copied"), "utf8"),
      "racine",
    );
  });

  // La capacité se CONSTATE : créer un lien symbolique demande un privilège sous
  // Windows et peut lever EPERM. On l'éprouve si la plateforme le permet, et on
  // ÉNONCE ce qui n'a pas pu l'être sinon — plutôt qu'un rouge qui ne parle pas
  // de la brique, ou un skip muet qui se lit comme un succès.
  it("un lien symbolique reste un lien dans la copie (si la plateforme le permet)", async () => {
    const linked = path.join(FIXTURE, "sub", "link.txt");
    let supported = true;
    try {
      await fsp.symlink(path.join("..", "file.txt"), linked);
    } catch {
      supported = false;
    }
    if (!supported) {
      console.warn(
        "Builder: lien symbolique NON éprouvé — la plateforme refuse d'en créer " +
          "(privilège requis sous Windows). La copie de liens reste non couverte ici.",
      );
      return;
    }
    try {
      const obj: BuilderObject = {
        name: "copied",
        type: "copy",
        path: FIXTURE,
        params: { recurse: true },
      };
      await builder.build(obj, TMP);
      assert.ok(
        fs
          .lstatSync(path.join(TMP, "copied", "sub", "link.txt"))
          .isSymbolicLink(),
        "fs.cp ne déréférence pas : la copie doit porter un lien, pas le fichier",
      );
    } finally {
      await fsp.rm(linked, { force: true });
    }
  });
});

// ─── 7. Performance ──────────────────────────────────────────────────────────

describe("Builder — performance", () => {
  let builder: Builder;
  beforeAll(async () => {
    builder = await makeBuilder();
    await fsp.mkdir(TMP, { recursive: true });
  });

  afterAll(async () => {
    for (let i = 0; i < 20; i++) {
      await cleanTmp(`perfDir_${i}`);
    }
  });

  it("création de 20 répertoires < 2000ms", async () => {
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      const obj: BuilderObject = {
        name: `perfDir_${i}`,
        type: "directory",
      };
      await builder.build(obj, TMP, true);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).to.be.lessThan(2000);
  });
});
