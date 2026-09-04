import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runAiSyncCommand } from "../../cli/aiSync";

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
 * Commande `nodefony ai:sync` — pointeurs vers les skills d'agent livrés par
 * les paquets installés.
 *
 * **Exécutée en « standalone » (zéro boot).** L'enregistrement ici sert au help
 * (`nodefony --help`) et à la complétion ; l'exécution réelle est interceptée
 * par le fast-path de {@link CliKernel.start} — portée par un module
 * `policy: "dev"`, elle n'existerait pas dans un terminal sans `NODE_ENV`,
 * et c'est exactement ce que le fast-path évite. Le `generate()` ci-dessous
 * n'est qu'un FILET.
 *
 * @example
 * ```bash
 * nodefony ai:sync            # pose/rafraîchit .agents/skills + miroir .claude/skills
 * nodefony ai:sync --dry-run  # le plan, sans rien écrire
 * ```
 */
class AiSync extends Command {
  constructor(cli: CliKernel) {
    super(
      "ai:sync",
      "Pointeurs vers les skills d'agent des paquets installés (.agents/skills + miroir .claude/skills)",
      cli as CliKernel,
      options,
    );
    this.addOption("--dry-run", "Le plan, sans rien écrire");
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
    const argv = ["node", "nodefony", "ai:sync"];
    if (opts?.dryRun) argv.push("--dry-run");
    if (opts?.json) argv.push("--json");
    if (opts?.cwd) argv.push("--cwd", opts.cwd);
    await this.terminate(runAiSyncCommand(argv));
    return this;
  }
}

export default AiSync;
