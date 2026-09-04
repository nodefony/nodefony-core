import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";

const optionsCommand: OptionsCommandInterface = {
  helpGroup: "GÉNÉRER ET CONSTRUIRE",
  showBanner: false,
  kernelEvent: "onRegister",
};

class Install extends Command {
  constructor(cli: CliKernel) {
    super(
      "install",
      "installe les dépendances puis construit le projet",
      cli as CliKernel,
      optionsCommand,
    );
    this.addOption("-f, --force", "Force Install");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async generate(options: any): Promise<this> {
    const modules = this.kernel?.getModules();
    if (modules) {
      for (const moduleName in modules) {
        const module = modules[moduleName];
        await module.install(options?.force);
      }
    }
    return this;
  }
}

export default Install;
