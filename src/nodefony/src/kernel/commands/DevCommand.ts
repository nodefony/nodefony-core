import Command from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";

class Dev extends Command {
  constructor(cli: CliKernel) {
    super("development", "Start Server in development Mode", cli as CliKernel, {
      showBanner: false,
    });
    this.alias("dev");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  override async generate(options: any): Promise<Kernel> {
    (this.cli as CliKernel).setType("SERVER");
    try {
      return (await this.cli?.kernel?.start()) as Kernel;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }
}

export default Dev;
