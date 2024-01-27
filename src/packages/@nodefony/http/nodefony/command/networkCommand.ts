//import nodefony, { Cli, Command } from "@nodefony/core";
import os from "node:os";
import {
  OptionsCommandInterface,
  CliKernel,
  Command,
  NetworkInterface,
} from "nodefony";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onRegister",
};

class Network extends Command {
  constructor(cli: CliKernel) {
    super("network", "Show Network   ", cli, options);
    this.addArgument("[interface]", "Selection interface example eth0 ");
    this.addOption("-j, --json", "get json");
  }

  override async generate(
    arg: string,
    options: { json: boolean }
  ): Promise<this> {
    let network = this.kernel?.getNetwork();
    let result: NetworkInterface | os.NetworkInterfaceInfo[] | undefined = {};

    if (arg) {
      if (network?.interfaces[arg]) {
        result = network?.interfaces[arg];
      }
    } else {
      result = network?.interfaces as NetworkInterface;
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, undefined, " ")}\n`);
    } else {
      console.log(result);
    }
    return this;
  }
}

export default Network;
