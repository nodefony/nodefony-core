/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert";
import "mocha";
import Command, { OptionsCommandInterface } from "../../command/Command";
import Cli from "../../Cli";

describe("Command", () => {
  beforeEach(() => {});
  describe("Instance", () => {
    beforeEach(() => {});
    // it("instance", () => {
    //   const inst = new Command("start1", "start1 framawork");
    //   assert(inst);
    //   assert.equal(inst.name, "start1");
    // });

    it("instance Cli", async () => {
      return new Cli("NODE", {
        clear: false,
        autostart: false,
        asciify: false,
      })
        .start()
        .then((cli) => {
          const options: OptionsCommandInterface = {
            showBanner: false,
          };
          const inst2 = new Command(
            "start2",
            "start2 framawork",
            cli as Cli,
            options
          );
          const inst3 = new Command(
            "start3",
            "start3 framawork",
            cli as Cli,
            options
          );
          assert(inst2);
          assert(inst3);
          assert.equal(inst2.name, "start2");
          assert.equal(inst3.name, "start3");
          (cli as Cli).runCommand("start2", ["-i", "-d"]);
          assert.strictEqual(inst2.debug, true);
          assert.strictEqual(inst2.interactive, true);

          inst3.runCommand("start3", ["-i"]);
          assert.strictEqual(inst3.debug, false);
          assert.strictEqual(inst3.interactive, true);
          inst3.runCommand("start3");
          assert.strictEqual(inst3.debug, false);
          assert.strictEqual(inst3.interactive, false);
        });
    });
  });
});
