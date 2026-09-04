import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runGitHooksCommand } from "../../cli/gitHooks";

const options: OptionsCommandInterface = {
  helpGroup: "AGENTS ET OUTILLAGE",
  // Lancée depuis le menu, cette commande BOOTE (le fast-path standalone ne
  // vaut que pour une invocation directe) : sa sortie serait noyée sous le
  // journal de cycle de vie.
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony git:hooks` — hooks git natifs (`core.hooksPath`), zéro
 * dépendance.
 *
 * **Exécutée en « standalone » (zéro boot).** L'enregistrement ici sert au help
 * (`nodefony --help`) et à la complétion ; l'exécution réelle est interceptée
 * par le fast-path de {@link CliKernel.start} AVANT toute construction de
 * Kernel — la commande n'écrit que deux fichiers et une clé de config. Le
 * `generate()` ci-dessous n'est qu'un FILET.
 *
 * @example
 * ```bash
 * nodefony git:hooks            # pose .githooks/ + core.hooksPath
 * nodefony git:hooks --dry-run  # le plan, sans rien écrire ni configurer
 * ```
 */
class GitHooks extends Command {
  constructor(cli: CliKernel) {
    super(
      "git:hooks",
      "Hooks git natifs (core.hooksPath) : typecheck+lint au commit, verify au push",
      cli as CliKernel,
      options,
    );
    this.addOption("--dry-run", "Le plan, sans rien écrire ni configurer");
    this.addOption("--json", "Sortie exploitable par un script");
    this.addOption(
      "--cwd <path>",
      "Point de départ (la racine de l'app est résolue en remontant)",
    );
  }

  override async generate(opts?: {
    dryRun?: boolean;
    json?: boolean;
    cwd?: string;
  }): Promise<this> {
    const argv = ["node", "nodefony", "git:hooks"];
    if (opts?.dryRun) argv.push("--dry-run");
    if (opts?.json) argv.push("--json");
    if (opts?.cwd) argv.push("--cwd", opts.cwd);
    await this.terminate(runGitHooksCommand(argv));
    return this;
  }
}

export default GitHooks;
