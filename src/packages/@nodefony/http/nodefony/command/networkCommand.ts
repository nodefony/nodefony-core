//import nodefony, { Cli, Command } from "@nodefony/core";
import os from "node:os";
import { inspect } from "node:util";
import {
  OptionsCommandInterface,
  CliKernel,
  Command,
  NetworkInterface,
} from "nodefony";

const options: OptionsCommandInterface = {
  helpGroup: "FRONT ET RÉSEAU",
  showBanner: false,
  kernelEvent: "onRegister",
};

class Network extends Command {
  constructor(cli: CliKernel) {
    super(
      "http:network",
      "les interfaces réseau et adresses de cette machine",
      cli,
      options,
    );
    this.addArgument("[interface]", "Selection interface example eth0 ");
    this.addOption("-j, --json", "get json");
  }

  override async generate(
    arg: string,
    // `opts`, pas `options` : ce nom masquait la constante `options` du module
    // (la description de la commande passée à `super`).
    opts: { json: boolean },
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

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, undefined, " ")}\n`);
    } else {
      // Sortie CLI lisible (dump objet coloré) — stdout, pas un log syslog.
      process.stdout.write(
        `${inspect(result, { colors: process.stdout.isTTY })}\n`,
      );
    }
    return this;
  }
}

export default Network;
