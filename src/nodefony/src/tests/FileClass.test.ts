import { assert, expect } from "chai";
import "mocha";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import fsp from "node:fs/promises";
import FileClass from "../FileClass";

const dataDir = path.resolve("src", "tests", "finder", "data");
const dataJs = path.resolve(dataDir, "data.js");
const dataPng = path.resolve(dataDir, "data.png");

describe("NODEFONY CORE FileClass", () => {
  // temp file with actual content, shared across content/checkSum tests
  let contentFilePath: string;

  before(async () => {
    contentFilePath = path.join(os.tmpdir(), `fc-content-${Date.now()}.txt`);
    await fsp.writeFile(contentFilePath, "hello world\nsecond line\n");
  });

  after(async () => {
    await fsp.rm(contentFilePath, { force: true });
  });

  // ─── constructor ────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("throws on empty path", () => {
      expect(() => new FileClass("" as string)).to.throw();
    });

    it("throws on non-existent path", () => {
      expect(() => new FileClass("/no/such/path/xyz")).to.throw();
    });

    it("resolves relative path to absolute", () => {
      const f = new FileClass(dataJs);
      expect(path.isAbsolute(f.path as string)).to.be.true;
    });

    it("creates instance for a file", () => {
      const f = new FileClass(dataJs);
      expect(f).to.be.instanceOf(FileClass);
      expect(f.type).to.equal("File");
      expect(f.name).to.equal("data.js");
      expect(f.ext).to.equal(".js");
      expect(f.shortName).to.equal("data");
    });

    it("creates instance for a directory", () => {
      const f = new FileClass(dataDir);
      expect(f.type).to.equal("Directory");
      expect(f.name).to.equal("data");
      expect(f.ext).to.equal("");
    });

    it("sets mimeType for files", () => {
      const f = new FileClass(dataJs);
      expect(f.mimeType).to.be.a("string");
      expect(f.mimeType).to.include("javascript");
    });

    it("does not set mimeType for directories", () => {
      const f = new FileClass(dataDir);
      expect(f.mimeType).to.equal(false);
    });

    it("sets encoding for files", () => {
      const f = new FileClass(dataJs);
      expect(f.encoding).to.equal("UTF-8");
    });

    it("sets dirName correctly", () => {
      const f = new FileClass(dataJs);
      expect(f.dirName).to.equal(dataDir);
    });

    it("sets stats as fs.Stats", () => {
      const f = new FileClass(dataJs);
      expect(f.stats).to.be.instanceOf(fs.Stats);
    });
  });

  // ─── API async (from / stat / moveAsync) — non bloquante ─────────────────────
  describe("async — FileClass.from / stat / moveAsync", () => {
    it("from(file) → mêmes champs que new FileClass (parité)", async () => {
      const sync = new FileClass(dataJs);
      const asyncF = await FileClass.from(dataJs);
      expect(asyncF).to.be.instanceOf(FileClass);
      expect(asyncF.type).to.equal(sync.type);
      expect(asyncF.path).to.equal(sync.path);
      expect(asyncF.name).to.equal(sync.name);
      expect(asyncF.ext).to.equal(sync.ext);
      expect(asyncF.shortName).to.equal(sync.shortName);
      expect(asyncF.dirName).to.equal(sync.dirName);
      expect(asyncF.mimeType).to.equal(sync.mimeType);
      expect(asyncF.stats).to.be.instanceOf(fs.Stats);
    });

    it("from(dir) → type Directory", async () => {
      const f = await FileClass.from(dataDir);
      expect(f.type).to.equal("Directory");
      expect(f.mimeType).to.equal(false);
    });

    it("from(path inexistant) → rejette (pas de throw sync)", async () => {
      let rejected = false;
      try {
        await FileClass.from("/no/such/path/xyz");
      } catch {
        rejected = true;
      }
      expect(rejected).to.be.true;
    });

    it("defer:true → AUCUNE I/O au constructeur (stats non hydraté)", () => {
      const f = new FileClass(dataJs, { defer: true });
      // path résolu (pur, pas d'I/O) mais stats absent tant que stat() pas appelé
      expect(path.isAbsolute(f.path as string)).to.be.true;
      expect((f as unknown as { stats?: fs.Stats }).stats).to.equal(undefined);
    });

    it("stat() hydrate une instance deferred", async () => {
      const f = new FileClass(dataJs, { defer: true });
      const ret = await f.stat();
      expect(ret).to.equal(f); // chaînable (this)
      expect(f.stats).to.be.instanceOf(fs.Stats);
      expect(f.type).to.equal("File");
      expect(f.name).to.equal("data.js");
    });

    it("moveAsync() déplace le fichier sans bloquer + retourne un FileClass", async () => {
      const src = path.join(os.tmpdir(), `nf-move-${Date.now()}.txt`);
      const dst = path.join(os.tmpdir(), `nf-moved-${Date.now()}.txt`);
      await fsp.writeFile(src, "hello");
      const f = await FileClass.from(src);
      const moved = await f.moveAsync(dst);
      expect(moved).to.be.instanceOf(FileClass);
      expect(moved.path).to.equal(fs.realpathSync(dst));
      expect(await fsp.readFile(dst, "utf8")).to.equal("hello");
      await fsp.rm(dst, { force: true });
      expect(fs.existsSync(src)).to.be.false; // source déplacée
    });
  });

  // ─── type checks ────────────────────────────────────────────────────────────
  describe("type checks", () => {
    it("isFile() — true for file", () => {
      expect(new FileClass(dataJs).isFile()).to.be.true;
    });

    it("isFile() — false for directory", () => {
      expect(new FileClass(dataDir).isFile()).to.be.false;
    });

    it("isDirectory() — true for directory", () => {
      expect(new FileClass(dataDir).isDirectory()).to.be.true;
    });

    it("isDirectory() — false for file", () => {
      expect(new FileClass(dataJs).isDirectory()).to.be.false;
    });

    it("checkType() returns correct string", () => {
      expect(new FileClass(dataJs).checkType()).to.equal("File");
      expect(new FileClass(dataDir).checkType()).to.equal("Directory");
    });
  });

  // ─── matchName ──────────────────────────────────────────────────────────────
  describe("matchName()", () => {
    it("matches by exact string", () => {
      const f = new FileClass(dataJs);
      expect(f.matchName("data.js")).to.be.true;
      expect(f.matchName("other.js")).to.be.false;
    });

    it("matches by RegExp — returns exec result", () => {
      const f = new FileClass(dataJs);
      const result = f.matchName(/\.js$/);
      expect(result).to.not.be.null;
      expect(result).to.not.be.false;
    });

    it("returns null for non-matching RegExp", () => {
      const f = new FileClass(dataJs);
      expect(f.matchName(/\.png$/)).to.be.null;
    });
  });

  // ─── matchType ──────────────────────────────────────────────────────────────
  describe("matchType()", () => {
    it("returns true when type matches", () => {
      expect(new FileClass(dataJs).matchType("File")).to.be.true;
    });

    it("returns false when type does not match", () => {
      expect(new FileClass(dataJs).matchType("Directory")).to.be.false;
    });
  });

  // ─── isHidden ───────────────────────────────────────────────────────────────
  describe("isHidden()", () => {
    it("returns false for non-hidden files", () => {
      expect(new FileClass(dataJs).isHidden()).to.be.false;
    });

    it("returns true for hidden files (dot prefix)", () => {
      const hiddenPath = path.resolve(dataDir, ".gitignore");
      expect(new FileClass(hiddenPath).isHidden()).to.be.true;
    });
  });

  // ─── dirname ────────────────────────────────────────────────────────────────
  describe("dirname()", () => {
    it("returns parent directory", () => {
      const f = new FileClass(dataJs);
      expect(f.dirname()).to.equal(dataDir);
    });
  });

  // ─── getMimeType ─────────────────────────────────────────────────────────────
  describe("getMimeType()", () => {
    it("detects js mime type", () => {
      const f = new FileClass(dataJs);
      expect(f.getMimeType()).to.be.a("string");
    });

    it("detects png mime type", () => {
      const f = new FileClass(dataPng);
      expect(f.getMimeType()).to.equal("image/png");
    });

    it("accepts custom name argument", () => {
      const f = new FileClass(dataJs);
      expect(f.getMimeType("test.html")).to.include("html");
    });
  });

  // ─── getExtension ────────────────────────────────────────────────────────────
  describe("getExtension()", () => {
    it("returns extension from mimeType string", () => {
      const f = new FileClass(dataPng);
      expect(f.getExtension("image/png")).to.equal("png");
    });

    it("falls back to instance mimeType when false is passed", () => {
      const f = new FileClass(dataPng);
      const ext = f.getExtension(false);
      expect(ext).to.be.a("string");
    });
  });

  // ─── content / read ──────────────────────────────────────────────────────────
  describe("content() / read()", () => {
    it("content() returns file content as string", () => {
      const f = new FileClass(contentFilePath);
      const c = f.content("utf8");
      expect(c).to.be.a("string");
      expect((c as string).length).to.be.greaterThan(0);
    });

    it("content() includes expected text", () => {
      const f = new FileClass(contentFilePath);
      expect(f.content("utf8")).to.include("hello world");
    });

    it("read() returns same content as content()", () => {
      const f = new FileClass(contentFilePath);
      expect(f.read("utf8")).to.deep.equal(f.content("utf8"));
    });

    it("readByLine() calls callback for each line", () => {
      const f = new FileClass(contentFilePath);
      const lines: string[] = [];
      f.readByLine((line) => lines.push(line));
      expect(lines.length).to.be.greaterThan(1);
    });

    it("readByLine() provides line numbers starting at 1", () => {
      const f = new FileClass(contentFilePath);
      let firstN = 0;
      f.readByLine((_line, n) => {
        if (firstN === 0) firstN = n;
      });
      expect(firstN).to.equal(1);
    });
  });

  // ─── readAsync ───────────────────────────────────────────────────────────────
  describe("readAsync()", () => {
    it("returns file content asynchronously", async () => {
      const f = new FileClass(contentFilePath);
      const content = await f.readAsync("utf8");
      expect(content).to.be.a("string");
      expect((content as string).length).to.be.greaterThan(0);
    });

    it("async content matches sync content", async () => {
      const f = new FileClass(contentFilePath);
      const async_ = await f.readAsync("utf8");
      const sync_ = f.content("utf8");
      expect(async_).to.deep.equal(sync_);
    });
  });

  // ─── checkSum ────────────────────────────────────────────────────────────────
  describe("checkSum()", () => {
    it("returns hex string by default (md5)", () => {
      const f = new FileClass(contentFilePath);
      const sum = f.checkSum();
      expect(sum).to.match(/^[a-f0-9]{32}$/);
    });

    it("returns sha256 when specified", () => {
      const f = new FileClass(contentFilePath);
      const sum = f.checkSum("sha256");
      expect(sum).to.match(/^[a-f0-9]{64}$/);
    });

    it("same file → same checksum", () => {
      const f1 = new FileClass(contentFilePath);
      const f2 = new FileClass(contentFilePath);
      expect(f1.checkSum()).to.equal(f2.checkSum());
    });
  });

  // ─── toJson / toString ────────────────────────────────────────────────────────
  describe("toJson() / toString()", () => {
    it("toJson() returns object with required keys", () => {
      const f = new FileClass(dataJs);
      const json = f.toJson();
      expect(json).to.have.property("path");
      expect(json).to.have.property("name", "data.js");
      expect(json).to.have.property("type", "File");
      expect(json).to.have.property("mimeType");
      expect(json).to.have.property("encoding");
    });

    it("toJson() for directory does not include mimeType", () => {
      const f = new FileClass(dataDir);
      const json = f.toJson();
      expect(json).to.not.have.property("mimeType");
    });

    it("toString() returns JSON string", () => {
      const f = new FileClass(dataJs);
      const str = f.toString();
      const parsed = JSON.parse(str);
      expect(parsed).to.have.property("name", "data.js");
    });
  });

  // ─── write / move / unlink ────────────────────────────────────────────────────
  describe("write() / move() / unlink()", () => {
    let tmpFile: string;

    beforeEach(async () => {
      tmpFile = path.join(os.tmpdir(), `fc-test-${Date.now()}.txt`);
      await fsp.writeFile(tmpFile, "initial");
    });

    afterEach(async () => {
      await fsp.rm(tmpFile, { force: true });
    });

    it("write() updates file content", () => {
      const f = new FileClass(tmpFile);
      f.write("world", { encoding: "utf8" });
      expect(fs.readFileSync(tmpFile, "utf8")).to.equal("world");
    });

    it("move() returns new FileClass at target path", async () => {
      const target = `${tmpFile}.moved`;
      try {
        const f = new FileClass(tmpFile);
        const moved = f.move(target as fs.PathLike);
        expect(moved).to.be.instanceOf(FileClass);
        expect(moved.path).to.equal(fs.realpathSync(target));
        expect(fs.existsSync(tmpFile)).to.be.false;
        tmpFile = target;
      } finally {
        await fsp.rm(target, { force: true });
      }
    });

    it("unlink() removes the file", () => {
      const f = new FileClass(tmpFile);
      f.unlink();
      expect(fs.existsSync(tmpFile)).to.be.false;
    });
  });

  // ─── assert compatibility ────────────────────────────────────────────────────
  describe("API surface", () => {
    it("FileClass is a constructor function", () => {
      assert.isFunction(FileClass);
    });

    it("instance has all expected public properties", () => {
      const f = new FileClass(dataJs);
      assert.isDefined(f.path);
      assert.isDefined(f.name);
      assert.isDefined(f.ext);
      assert.isDefined(f.shortName);
      assert.isDefined(f.type);
      assert.isDefined(f.stats);
      assert.isDefined(f.dirName);
      assert.isDefined(f.parse);
    });
  });
});
