import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Module from "../Module";

const optionsCommand: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onRegister",
};

class Install extends Command {
  constructor(cli: CliKernel) {
    super(
      "install",
      "Install Nodefony Framework",
      cli as CliKernel,
      optionsCommand
    );
  }
  override async generate(): Promise<this> {
    const modules = this.kernel?.getModules();
    if (modules) {
      for (const moduleName in modules) {
        const module: Module = modules[moduleName];
        await module.install();
      }
    }
    return this;
  }
}

export default Install;
