/* eslint-disable @typescript-eslint/no-explicit-any */
import 'mocha';
import assert from 'node:assert'
import Finder , {TotalInterface}from '../finder/Finder'
import path from 'node:path'
import Result from '../finder/Result';
import FileResult from '../finder/FileResult'
import File from '../finder/File'
import FileClass from '../FileClass'

declare let global: NodeJS.Global & { 
    bundlePath :string
    nodefonyPath: string
    dataPath: string
    arrayPath: string[]
    excludeDir: RegExp
    finder:  Finder
    finderInstance: Finder
 };

describe("NODEFONY CORE FINDER", () => {
  before( () => {
      try{
        global.bundlePath = path.resolve("src", "tests", "finder" , "bundles");
        global.nodefonyPath = path.resolve("src", "tests", "finder" ,"nodefony");
        global.dataPath = path.resolve("src", "tests", "finder","data");
        global.arrayPath = [global.bundlePath, global.nodefonyPath];
        global.excludeDir = /node_modules|tmp|docker|.git|assets|tests|test|doc|documentation|public/;
        global.finderInstance = new Finder({
          // excludeDir: global.excludeDir
         });
      }catch(e){
        console.error(e)
      }
  });

  describe("CONTRUSTROR ", () => {
    beforeEach(() => {
      global.finder = new Finder({
        excludeDir: global.excludeDir,
        // match: /.*.js$|.*.es6$/,
        recurse: true,
        depth: 1,
        seeHidden: true,
        followSymLink: true
      });
    });

    it("NEW", async () => {
      assert.equal(typeof Finder, "function");
      assert.equal(typeof global.finder.in, "function");
      assert.equal(global.finder instanceof Finder, true);
      assert.equal(false, global.finderInstance.settings.recurse);
      assert.equal(10, global.finderInstance.settings.depth);
      assert.equal(false, global.finderInstance.settings.seeHidden);
      assert.equal(null, global.finderInstance.settings.match);
      assert.equal(null, global.finderInstance.settings.exclude);
      assert.equal(null, global.finderInstance.settings.excludeFile);
      assert.equal(null, global.finderInstance.settings.excludeDir);
      assert.equal(false, global.finderInstance.settings.followSymLink);
      return global.finderInstance;
    });

    it("PATH", async () => {
      assert.throws(() => {
        global.finder.ckeckPath(path.resolve("src", "bundle"));
      });
      let result = global.finder.ckeckPath(global.bundlePath);
      assert(result instanceof FileResult);
      assert.strictEqual(result.length, 1);
      let file = result[0];
      assert(file);
      assert(file instanceof FileClass);
      assert(file instanceof File);
      assert.equal(file.type, "Directory");
      assert.equal(file.name, "bundles");
      assert.equal(file.path, global.bundlePath);
      assert.throws(() => {
        global.finder.ckeckPath("bad path");
      });
      // array
      result = global.finder.ckeckPath(global.arrayPath);
      assert.strictEqual(result.length, 2);
      file = result[0];
      assert(file instanceof FileClass);
      assert.equal(file.type, "Directory");
      assert.equal(file.name, "bundles");
      const file2 = result[1];
      assert(file2 instanceof FileClass);
      assert.equal(file2.type, "Directory");
      assert.equal(file2.name, "nodefony");
    });

    it("PARSE IN", async () => {
      assert.rejects(global.finder.in("bad path"));
      let res = await global.finder
        .in("bad path")
        .catch((e) => {
          assert.ok(e.message.indexOf("no such file or director") >= 0);
        });
      assert.equal(res, undefined);
      assert.rejects(async () => {
        res = await global.finder
          .in("bad path")
          .catch((e) => {
            assert.match(e.message, /no such file or director/);
            throw e;
          });
      });

      res = await global.finder
        .in(global.nodefonyPath)
        .then((result) => {
          assert(result);
          assert.strictEqual(result.length, 1);
          const file = result[0];
          assert(result instanceof FileResult);
          assert.equal(file.name, "nodefony");
          assert.equal(file.path, global.nodefonyPath);
          return result;
        });
      assert(res);
      assert.strictEqual(res.length, 1);
    });
  });

  /* TEST REC*/

  describe("RESULT ", () => {
    beforeEach(() => {
      global.finder = new Finder({
        excludeDir: global.excludeDir
        // match: /.*.js$|.*.es6$/,
      });
    });

    it("SIMPLE RESULT ", async () => {
      const res = await global.finder
        .in(global.dataPath, {
          recurse: false,
          seeHidden: true
        })
        .then((result) => {
          assert(result);
          assert.strictEqual(result.length, 1);
          assert(result[0]);
          assert.strictEqual(result[0].length, 5);
          assert.strictEqual(result[0].children.length, 5);
          const sort = result[0].children.sortByName();
          assert.strictEqual(sort[0].name, ".gitignore");
          assert.strictEqual(sort[0].isHidden(), true);
          assert.strictEqual(sort[0].isFile(), true);
          assert.strictEqual(sort[1].name, "data.js");
          assert.strictEqual(sort[1].isFile(), true);
          assert.strictEqual(sort[2].name, "data.png");
          assert.strictEqual(sort[2].isFile(), true);
          assert.strictEqual(sort[3].name, "dir1");
          assert.strictEqual(sort[3].isDirectory(), true);
          assert.strictEqual(sort[3].children.length, 0);
          assert.strictEqual(sort[4].name, "dir2");
          // assert.strictEqual(sort[4].isSymbolicLink(), true);
          assert.strictEqual(sort[4].children.length, 0);
          return result[0];
        });
      assert(res);
      assert(res instanceof File);
    });

    it("HIDDEN", async () => {
      const res = await global.finder
        .in(global.dataPath, {
          seeHidden: false
        })
        .then((result) => {
          assert(result[0]);
          // assert.strictEqual(result[0].length, 4);
          return result;
        });
      assert(res);
      assert(res instanceof FileResult);
    });

    it("DEEP 2", async () => {
      const res = await global.finder
        .in(global.dataPath, {
          seeHidden: true,
          recurse: true,
          depth: 2
        })
        .then((result) => {
          assert(result[0]);
          assert.strictEqual(result[0].length, 5);
          const sort = result[0].children.sortByName();
          const dir1 = sort[3];
          assert.strictEqual(dir1.children.length, 3);
          assert.strictEqual(dir1.name, "dir1");
          const dir2 = dir1.children[2];
          assert.strictEqual(dir2.name, "dir2");
          assert.strictEqual(dir2.children.length, 0);
          return sort;
        });
      assert(res);
    });

    it("DEEP 3", async () => {
      const res = await global.finder
        .in(global.dataPath, {
          seeHidden: true,
          recurse: true,
          depth: 3
        })
        .then((result) => {
          assert(result[0]);
          const sort = result[0].children.sortByName();
          const dir1 = sort[3];
          const dir2 = dir1.children[2];
          assert.strictEqual(dir2.children.length, 4);
          const sort2 = dir2.children.sortByName();
          assert.strictEqual(sort2.length, 4);
          const dir3 = sort2[3];
          assert.strictEqual(dir3.name, "dir3");
          assert.strictEqual(dir3.children.length, 0);
          return sort;
        });
      assert(res);
    });

    it("Default DEEP ", async () => {
      const res = await global.finder
        .in(global.dataPath, {
          recurse: true,
          seeHidden: true,
          followSymLink: true
        })
        .then((result) => {
          const sort = result[0].children.sortByName();
          const dir1 = sort[3];
          const dir2 = dir1.children[2];
          const sort2 = dir2.children.sortByName();
          const dir3 = sort2[3];
          assert.strictEqual(dir3.children.length, 2);
          return sort;
        });
      assert(res);
    });

    describe("RESULT ", () => {
      it("TOTAL ", async () => {
        const finder = new Finder({
          excludeDir: global.excludeDir,
          seeHidden: true,
          recurse: true,
          followSymLink: true
        });
         await finder.in(global.dataPath, {
          onFinish: (res: Result, totals: TotalInterface) => {
            if (process.platform !== "win32") {
              assert.strictEqual(totals.Directory, 4);
              assert.strictEqual(totals.File, 13);
              assert.strictEqual(totals.symbolicLink, 3);
              assert.strictEqual(totals.hidden, 3);
            }
          }
        });
         await finder.in(global.dataPath, {
          seeHidden: false,
          onFinish: (res: Result, totals: TotalInterface) => {
            if (process.platform !== "win32") {
              assert.strictEqual(totals.Directory, 4);
              assert.strictEqual(totals.File, 10);
              assert.strictEqual(totals.symbolicLink, 3);
              assert.strictEqual(totals.hidden, 0);
            }
          }
        });
         await finder.in(global.dataPath, {
          followSymLink: false,
          onFinish: (res: Result , totals: TotalInterface) => {
            // console.log(res)
            // console.log( res[0].children.getDirectories() )
            // assert.strictEqual(totals.Directory, 4);
            if (process.platform !== "win32") {
              assert.strictEqual(totals.File, 9);
              assert.strictEqual(totals.symbolicLink, 2);
              assert.strictEqual(totals.hidden, 2);
            }
          }
        });
      });
    });

    describe("RESULT FIND", () => {
      beforeEach(() => {
        global.finder = new Finder({
          excludeDir: global.excludeDir,
          // match: /.*.js$|.*.es6$/,
          seeHidden: true,
          recurse: true,
          followSymLink: true
        });
      });

      it("SIMPLE", async () => {
        const finder = new Finder({
          excludeDir: global.excludeDir,
          seeHidden: true,
          recurse: true,
          followSymLink: true
        });
         await finder.in(global.dataPath, {});
        // let ret = res[0].children.find(/^dir/);
      });
    });

    describe("RESULT JSON", () => {
      beforeEach(() => {
        global.finder = new Finder({
          excludeDir: global.excludeDir,
          // match: /.*.js$|.*.es6$/,
          seeHidden: true,
          recurse: true,
          followSymLink: true
        });
      });
      it("SIMPLE RESULT JSON", async () => {
        const res = await global.finder.in(global.dataPath);
        assert.strictEqual(res[0].children.length, 5);
        assert(res[0] instanceof Object);
        assert(res[0].children instanceof Array);
        // console.log(res[0].toJson())
        // console.log(res.toJson())
        // console.log(JSON.stringify(res.toJson()))
        /* console.log(util.inspect(res.toJson(), {
          depth: 100
        }));*/
      });
    });
  });
});
