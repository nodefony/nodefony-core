import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import {
  COMPLETION_SHELLS,
  renderCompletionScript,
  detectShell,
  type CompletionShell,
} from "../../cli/completion";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onStart",
};

/**
 * Commande `nodefony completion <shell>` — imprime le script de complétion à sourcer
 * (bash / zsh / fish).
 *
 * En pratique l'invocation directe est interceptée par le fast-path STANDALONE de
 * `CliKernel.start` (0 boot — cf `cli/completion.ts`) ; cette classe existe pour la
 * surface commander (help, menu interactif `start`) et rend le MÊME script (une seule
 * source : `renderCompletionScript`).
 */
class Completion extends Command {
  constructor(cli: CliKernel) {
    super(
      "completion",
      `Print shell completion script (${COMPLETION_SHELLS.join(" | ")})`,
      cli,
      options,
    );
    this.addArgument(
      "[shell]",
      `target shell: ${COMPLETION_SHELLS.join(", ")}`,
    );
  }

  override async generate(shell?: string): Promise<this> {
    const target =
      shell && (COMPLETION_SHELLS as readonly string[]).includes(shell)
        ? (shell as CompletionShell)
        : detectShell();
    if (!target) {
      this.log(
        `shell inconnu — usage : nodefony completion <${COMPLETION_SHELLS.join("|")}>`,
        "ERROR",
      );
      return this;
    }
    process.stdout.write(renderCompletionScript(target));
    return this;
  }
}

export default Completion;
