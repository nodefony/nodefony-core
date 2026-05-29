/// <reference types="node" />
import { expect } from "chai";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { IParsedUploadFile } from "../../interfaces/IUpload.js";
import { UploadedFile } from "../../service/upload/upload-service.js";

/**
 * Construit un faux fichier parsé pointant vers un vrai fichier temporaire
 * (pour que `stat()` fonctionne). `size`/`mimetype`/`hash` proviennent du
 * parser (pas du disque) — comme en prod (busboy).
 */
function fakeParsed(
  filepath: string,
  opts: Partial<IParsedUploadFile> = {},
): IParsedUploadFile {
  return {
    filepath,
    newFilename: path.basename(filepath),
    originalFilename: opts.originalFilename ?? "upload.txt",
    mimetype: opts.mimetype ?? "text/plain",
    size: opts.size ?? 5,
    mtime: opts.mtime ?? new Date(),
    hashAlgorithm: false,
    hash: opts.hash ?? null,
  };
}

describe("UploadedFile — unit (async, non bloquant)", () => {
  const tmp: string[] = [];

  async function mkTmp(content = "hello", name?: string): Promise<string> {
    const p = path.join(
      os.tmpdir(),
      name ?? `nf-up-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    await fsp.writeFile(p, content);
    tmp.push(p);
    return p;
  }

  afterEach(async () => {
    await Promise.all(tmp.splice(0).map((p) => fsp.rm(p, { force: true })));
  });

  describe("create() — factory async", () => {
    it("hydrate l'instance sans lstatSync bloquant", async () => {
      const src = await mkTmp("hello");
      const f = await UploadedFile.create(
        fakeParsed(src, { originalFilename: "photo.png", size: 5 }),
        "field",
      );
      expect(f).to.be.instanceOf(UploadedFile);
      expect(f.type).to.equal("File");
      expect(f.stats).to.be.instanceOf(fs.Stats);
      expect(f.filename).to.equal("photo.png"); // originalFilename prioritaire
      expect(f.size).to.equal(5);
      expect(f.prettySize).to.be.a("string");
    });

    it("mimeType : priorité au type détecté par le parser (busboy)", async () => {
      const src = await mkTmp("x");
      const f = await UploadedFile.create(
        fakeParsed(src, { mimetype: "image/jpeg", size: 1 }),
        "field",
      );
      expect(f.mimeType).to.equal("image/jpeg");
    });

    it("realName : fallback sur le nom de champ puis newFilename", async () => {
      const src = await mkTmp("x");
      const f = await UploadedFile.create(
        fakeParsed(src, { originalFilename: "", size: 1 }),
        "champ",
      );
      expect(f.filename).to.equal("champ");
    });
  });

  describe("moveAsync() — déplacement non bloquant", () => {
    it("déplace vers un fichier cible + source supprimée", async () => {
      const src = await mkTmp("payload");
      const dst = path.join(os.tmpdir(), `nf-moved-${Date.now()}.txt`);
      tmp.push(dst);
      const f = await UploadedFile.create(fakeParsed(src), "field");
      const moved = await f.moveAsync(dst);
      expect(moved.path).to.equal(fs.realpathSync(dst));
      expect(await fsp.readFile(dst, "utf8")).to.equal("payload");
      expect(fs.existsSync(src)).to.be.false;
    });

    it("déplace DANS un dossier existant (utilise filename)", async () => {
      const src = await mkTmp("data");
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "nf-updir-"));
      const f = await UploadedFile.create(
        fakeParsed(src, { originalFilename: "doc.bin" }),
        "field",
      );
      const moved = await f.moveAsync(dir);
      const expected = path.join(dir, "doc.bin");
      expect(fs.existsSync(expected)).to.be.true;
      expect(moved.name).to.equal("doc.bin");
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it("rejette si le dossier cible n'existe pas (pas de throw sync)", async () => {
      const src = await mkTmp("x");
      const f = await UploadedFile.create(fakeParsed(src), "field");
      let rejected = false;
      try {
        await f.moveAsync("/no/such/dir/xyz/file.txt");
      } catch {
        rejected = true;
      }
      expect(rejected).to.be.true;
    });
  });

  describe("move() — sync conservé (backward compat)", () => {
    it("déplace toujours en synchrone", async () => {
      const src = await mkTmp("legacy");
      const dst = path.join(os.tmpdir(), `nf-syncmoved-${Date.now()}.txt`);
      tmp.push(dst);
      const f = await UploadedFile.create(fakeParsed(src), "field");
      const moved = f.move(dst);
      expect(moved.path).to.equal(fs.realpathSync(dst));
      expect(fs.readFileSync(dst, "utf8")).to.equal("legacy");
    });
  });
});
