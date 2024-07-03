import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
//import Module from "../Module";
//import Kernel from "../Kernel";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onRegister",
};

class Dev extends Command {
  constructor(cli: CliKernel) {
    super("build", "build Framework", cli as CliKernel, options);
    this.alias("compile");
  }

  override async onKernelStart(): Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  override async generate(/*options: any*/): Promise<this> {
    try {
      //return this.runCommandAsync("install");
      if (this.kernel?.modules && Object.keys(this.kernel.modules).length) {
        for (const moduleName in this.kernel?.modules) {
          try {
            const module = this.kernel.modules[moduleName];
            this.log(`BUild ${moduleName} path : ${module.path}`);
            await module.build();
            this.log(`${moduleName} build ok`);
          } catch (e) {
            this.log(e, "ERROR");
          }
        }
      }
      return Promise.resolve(this);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }
}

export default Dev;
