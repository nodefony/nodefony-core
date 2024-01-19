//import nodefony, { Cli, Command } from "@nodefony/core";

import CliKernel from "../CliKernel";
import Command, { OptionsCommandInterface } from "../../command/Command";

//import { OptionsCommandInterface } from "@nodefony/core/types/src/command/Command";

class Split extends Command {
  constructor(cli: CliKernel) {
    super(
      "split",
      "Split a string into substrings and display as an array",
      cli
    );
    this.addArgument("<string>", "string to split");
    this.addOption("-s, --separator <char>", "separator character").default(
      ","
    );
    this.addOption("--first", "display just the first substring");
  }

  override async generate(
    str: string,
    options: OptionsCommandInterface
  ): Promise<this> {
    this.log(`test log`, "INFO");
    const limit = options.first ? 1 : undefined;
    const res = str.split(options.separator, limit);
    if (options.json) {
      process.stdout.write(JSON.stringify(res) + "\n");
    }
    console.log(res);
    return this;
  }
}

export default Split;
