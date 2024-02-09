import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import cluster from "node:cluster";
//import { extend } from "../../Tools";

import { cpus } from "os";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onStart",
};

class Staging extends Command {
  cpu: number = cpus().length;
  constructor(cli: CliKernel) {
    super("staging", "Start Server in staging Mode", cli as CliKernel, options);
    this.alias("preprod");
  }

  override async onKernelStart(): Promise<void> {
    (this.cli as CliKernel).setType("SERVER");
    this.cli.environment = "production";
    process.env.MODE_START = "staging";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  override async generate(options: any): Promise<void> {
    try {
      return this.preProd();
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  preProd(): void {
    if (cluster.isPrimary) {
      for (let i = 0; i < this.cpu; i++) {
        cluster.fork();
      }
      cluster.on("disconnect", (/* worker*/) => {
        console.error("disconnect!");
      });
      // cluster.on("fork", (worker) => {
      //   const wid = worker.id;
      //   this.log(`fork cluster id: ${wid}`);
      //   const message = extend({}, { worker: worker.id });
      //   worker.send(message, (err) => {
      //     if (err) {
      //       throw err;
      //     }
      //     this.log(message, "INFO", `WORKER ${worker.id} SEND`);
      //   });
      // });
    } else if (cluster.isWorker) {
      const kernel = new Kernel(
        this.cli.environment,
        this.cli as CliKernel,
        options
      );
      kernel.start().catch((e) => {
        this.cli.log(e, "ERROR");
        throw e;
      });
    }
  }
}

export default Staging;
