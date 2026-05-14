import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import pm2Service from "../../service/pm2Service";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onStart",
};

class Kill extends Command {
  service?: pm2Service | null;
  constructor(cli: CliKernel) {
    super("kill", "Kill PM2 daemon", cli as CliKernel, options);
  }

  override async onKernelStart(): Promise<void> {
    this.service = this.get<pm2Service>("pm2");
  }

  override async generate(): Promise<Kernel> {
    try {
      await this.service?.killExec();
      return this.cli?.kernel as Kernel;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }
}
export default Kill;
