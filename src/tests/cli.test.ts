/* eslint-disable @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import 'mocha';
import clc  from 'cli-color'
import Cli  ,{CliDefaultOptions} from '../Cli'
//console.log(Cli)
import path from "node:path"
let processName: string| null  = null;
if (process.argv && process.argv[1]) {
  processName = path.basename(process.argv[1]);
} else {
  processName = process.title || "nodefony";
}


describe("NODEFONY CLI", () => {
  beforeEach(() => {});

  describe("SIMPLE", () => {
    it("CREATE", (done) => {
      const project = new Cli("project", {
        version: "2.0.0",
        pid: true,
        color: clc.red.bold,
        clear: false,
      });
      assert.strictEqual(project.name, "project");
      assert.strictEqual(project.commander.version(), "2.0.0");
      const options = {
        processName ,
        autostart: true,
        asciify: true,
        clear: false,
        prompt: "default",
        commander: true,
        color: clc.red.bold,
        signals: true,
        autoLogger: true,
        resize: false,
        version: "2.0.0",
        warning: false,
        pid: true,
        promiseRejection: true
      };
      assert.deepStrictEqual(<CliDefaultOptions>options, project.options);

      const banner = `          Version : ${clc.blueBright.bold("2.0.0")}   Platform : ${clc.green(process.platform)}   Process : ${clc.green("project")}   Pid : ${project.pid}`;
      let res = null;
      project.start()
        .then((cli :Cli) => {
          res = cli.showBanner();
          assert.strictEqual(banner, res);
          
          res = cli.terminate(0, true);
          assert.strictEqual(res, 0);
          done();
        })
        .catch((e) => {
          console.error(e)
          throw e;
        });
    });
  });
});