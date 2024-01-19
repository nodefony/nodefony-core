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
    const App = await (this.cli as CliKernel)?.loadAppKernel();
    (this.cli as CliKernel).setType("SERVER");
    if (App) {
      try {
        const kernel = new App("development", this.cli as CliKernel);
        return await kernel.start();
      } catch (e) {
        this.log(e, "ERROR");
        throw e;
      }
    }
    throw new Error(`App not found`);
  }
}

export default Dev;
