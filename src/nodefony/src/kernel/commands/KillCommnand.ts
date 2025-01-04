import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import pm2Service from "../../service/pm2Service";
import { exec as execCb } from "child_process";
import { promisify } from "util";
const exec = promisify(execCb);

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  override async generate(/*options: any*/): Promise<Kernel> {
    try {
      await this.service?.killExec();
      //await this.pkill();
      //await this.killAll();
      return this.cli?.kernel as Kernel;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async pkill(): Promise<void> {
    try {
      const { stdout, stderr } = await exec("pkill pm2");
      if (stderr) {
        this.log(`pkill pm2  ${stderr}`, "WARNING");
      } else {
        this.log(`pkill pm2 success ${stdout}`);
      }
    } catch (e) {
      this.log(e, "WARNING");
    }
  }

  async killAll(): Promise<void> {
    try {
      const { stdout, stderr } = await exec("killall pm2");
      if (stderr) {
        this.log(`killall pm2  ${stderr}`, "WARNING");
      } else {
        this.log(`killall pm2 success ${stdout}`);
      }
    } catch (e) {
      this.log(e, "WARNING");
    }
  }
}
export default Kill;
