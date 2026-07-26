/// <reference types="node" />
import { expect } from "chai";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { IParsedUploadFile } from "../../interfaces/IUpload.js";
import { UploadedFile } from "../../service/upload/upload-service.js";

/**
 * Racine temporaire CANONIQUE.
 *
 * `os.tmpdir()` rend sous Windows la forme courte 8.3 (`C:\Users\RUNNER~1\…`) là où la
 * résolution système (`fsp.realpath`, celle qu'emploie `FileClass.from()`) rend la forme
 * longue (`C:\Users\runneradmin\…`). Deux écritures du MÊME dossier : bâtir le décor sur
 * une racine déjà canonique met le test et le code dans le même espace de noms — sans
 * quoi `startsWith(dir + sep)` rend `false` alors qu'aucune garde n'a cédé, et l'on
 * conclurait à une faille là où il n'y a qu'un décor mal posé. Sans effet sous POSIX.
 */
const TMP_ROOT = fs.realpathSync.native(os.tmpdir());

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
      TMP_ROOT,
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
      const dst = path.join(TMP_ROOT, `nf-moved-${Date.now()}.txt`);
      tmp.push(dst);
      const f = await UploadedFile.create(fakeParsed(src), "field");
      const moved = await f.moveAsync(dst);
      expect(moved.path).to.equal(fs.realpathSync(dst));
      expect(await fsp.readFile(dst, "utf8")).to.equal("payload");
      expect(fs.existsSync(src)).to.be.false;
    });

    it("déplace DANS un dossier existant (utilise filename)", async () => {
      const src = await mkTmp("data");
      const dir = await fsp.mkdtemp(path.join(TMP_ROOT, "nf-updir-"));
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
      const dst = path.join(TMP_ROOT, `nf-syncmoved-${Date.now()}.txt`);
      tmp.push(dst);
      const f = await UploadedFile.create(fakeParsed(src), "field");
      const moved = f.move(dst);
      expect(moved.path).to.equal(fs.realpathSync(dst));
      expect(fs.readFileSync(dst, "utf8")).to.equal("legacy");
    });
  });
});

/**
 * F188 — `originalFilename` vient de l'en-tête multipart : c'est une donnée
 * d'ATTAQUANT. Le fichier temporaire porte un nom généré, donc sûr ; mais dès que
 * l'application écrit `file.move("/var/uploads")`, c'est le nom client qui compose
 * la destination — et `path.resolve` honore les `..`. Un nom
 * `../../etc/cron.d/x` sortait alors du dossier visé.
 */
describe("UploadedFile — le nom client ne compose pas la destination (F188)", () => {
  const tmpDirs: string[] = [];
  const tmpFiles: string[] = [];

  async function mkUpload(originalFilename: string): Promise<UploadedFile> {
    const src = path.join(
      TMP_ROOT,
      `nf-f188-src-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fsp.writeFile(src, "payload");
    tmpFiles.push(src);
    return UploadedFile.create(fakeParsed(src, { originalFilename }), "champ");
  }

  async function mkDir(): Promise<string> {
    const dir = await fsp.mkdtemp(path.join(TMP_ROOT, "nf-f188-dst-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterAll(async () => {
    for (const f of tmpFiles) await fsp.rm(f, { force: true });
    for (const d of tmpDirs) await fsp.rm(d, { recursive: true, force: true });
  });

  it("un nom en `../` ne sort PAS du dossier de destination (async)", async () => {
    const dir = await mkDir();
    const file = await mkUpload("../../../etc/cron.d/nodefony-pwn");
    const moved = await file.moveAsync(dir);
    const dest = path.resolve(String(moved.path));
    expect(dest.startsWith(fs.realpathSync(dir) + path.sep)).to.equal(true);
    expect(path.basename(dest)).to.equal("nodefony-pwn");
    expect(fs.existsSync(path.join(dir, "nodefony-pwn"))).to.equal(true);
  });

  it("les séparateurs Windows sont coupés aussi (`..\\..\\x`)", async () => {
    const dir = await mkDir();
    const file = await mkUpload("..\\..\\windows\\system32\\evil.exe");
    const moved = await file.moveAsync(dir);
    const dest = path.resolve(String(moved.path));
    expect(dest.startsWith(fs.realpathSync(dir) + path.sep)).to.equal(true);
    expect(path.basename(dest)).to.equal("evil.exe");
  });

  it("même verrou sur la variante synchrone", async () => {
    const dir = await mkDir();
    const file = await mkUpload("../../../tmp/nf-f188-sync-pwn");
    const moved = file.move(dir);
    const dest = path.resolve(String(moved.path));
    expect(dest.startsWith(fs.realpathSync(dir) + path.sep)).to.equal(true);
    expect(path.basename(dest)).to.equal("nf-f188-sync-pwn");
  });

  it("un nom réduit à `..` retombe sur le nom temporaire, jamais sur le client", async () => {
    const dir = await mkDir();
    const file = await mkUpload("..");
    const moved = await file.moveAsync(dir);
    const dest = path.resolve(String(moved.path));
    expect(dest.startsWith(fs.realpathSync(dir) + path.sep)).to.equal(true);
    expect(path.basename(dest)).to.not.equal("..");
  });

  it("un nom ordinaire reste intact (on durcit sans dégrader l'usage normal)", async () => {
    const dir = await mkDir();
    const file = await mkUpload("rapport 2026.pdf");
    const moved = await file.moveAsync(dir);
    expect(path.basename(String(moved.path))).to.equal("rapport 2026.pdf");
  });
});
