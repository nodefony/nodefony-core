import Command from "../../command/Command";
import CliKernel from "../CliKernel";

class Install extends Command {
  constructor(cli: CliKernel) {
    super("install", "Install Nodefony Framework", cli as CliKernel, {
      showBanner: false,
    });
  }
  override generate(options: any): Promise<this> {
    return Promise.resolve(this);
  }
}

export default Install;
