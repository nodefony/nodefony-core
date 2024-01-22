import Command from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";

class Prod extends Command {
  constructor(cli: CliKernel) {
    super("production", "Start Server in Production Mode", cli as CliKernel, {
      showBanner: false,
    });
    this.alias("prod");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async generate(options: any): Promise<Kernel> {
    return new Kernel("production", this.cli as CliKernel);
  }
}

export default Prod;
