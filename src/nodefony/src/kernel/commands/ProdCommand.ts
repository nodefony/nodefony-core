import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onPostReady",
};

class Prod extends Command {
  constructor(cli: CliKernel) {
    super(
      "production",
      "Start Server in Production Mode",
      cli as CliKernel,
      options
    );
    this.alias("prod");
  }

  override async onKernelStart(): Promise<void> {
    (this.cli as CliKernel).setType("SERVER");
    this.cli.environment = "production";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  override async generate(options: any): Promise<Kernel> {
    (this.cli as CliKernel).setType("SERVER");
    try {
      return this.kernel as Kernel;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }
}

export default Prod;
