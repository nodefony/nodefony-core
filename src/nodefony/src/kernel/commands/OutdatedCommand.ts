import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Module from "../Module";

const optionsCommand: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onRegister",
};

class Outdated extends Command {
  constructor(cli: CliKernel) {
    super(
      "outdated",
      "List Project dependencies outdated",
      cli as CliKernel,
      optionsCommand
    );
  }
  override async generate(): Promise<this> {
    const modules = this.kernel?.getModules();
    if (modules) {
      for (const moduleName in modules) {
        const module: Module = modules[moduleName];
        await module.outdated();
      }
    }
    return this;
  }
}

export default Outdated;
