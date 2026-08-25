import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { COMPLETION_SHELLS, runCompletionCommand } from "../../cli/completion";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onStart",
};

/**
 * Commande `nodefony completion [install|uninstall] <shell>` — imprime le script de
 * complétion à sourcer (bash / zsh / fish), ou l'installe dans le rc du shell (bloc
 * marqué idempotent, réversible par `uninstall`).
 *
 * En pratique l'invocation directe est interceptée par le fast-path STANDALONE de
 * `CliKernel.start` (0 boot — cf `cli/completion.ts`) ; cette classe existe pour la
 * surface commander (help, menu interactif `start`) et route vers la MÊME logique
 * (une seule source : `runCompletionCommand`).
 */
class Completion extends Command {
  constructor(cli: CliKernel) {
    super(
      "completion",
      `Complétion shell : script à sourcer (${COMPLETION_SHELLS.join(" | ")})`,
      cli,
      options,
    );
    this.addArgument("[action]", "install | uninstall (default: print script)");
    this.addArgument(
      "[shell]",
      `target shell: ${COMPLETION_SHELLS.join(", ")} (default: $SHELL)`,
    );
  }

  override async generate(): Promise<this> {
    // Même routeur que le fast-path — argv porte déjà action/shell.
    runCompletionCommand(process.argv);
    return this;
  }
}

export default Completion;
