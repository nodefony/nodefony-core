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

  override async generate(options: any): Promise<Kernel> {
    const App = await (this.cli as CliKernel)?.loadAppKernel();
    if (App) {
      return new App("production", this.cli as CliKernel);
    }
    throw new Error(`App not found`);
  }
}

export default Prod;
