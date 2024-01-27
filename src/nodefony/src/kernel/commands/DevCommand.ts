import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onPostReady",
};

class Dev extends Command {
  constructor(cli: CliKernel) {
    super(
      "development",
      "Start Server in development Mode",
      cli as CliKernel,
      options
    );
    this.alias("dev");
  }

  override async onStart(): Promise<void> {
    (this.cli as CliKernel).setType("SERVER");
    this.cli.environment = "development";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  override async generate(options: any): Promise<Kernel> {
    try {
      return this.cli?.kernel as Kernel;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }
}

export default Dev;
