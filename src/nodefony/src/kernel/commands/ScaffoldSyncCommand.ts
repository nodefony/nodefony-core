import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runScaffoldSyncCommand } from "../../cli/contributions";

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
 * Commande `nodefony scaffold:sync` — pose les fichiers que livrent les paquets
 * installés (`nodefony.contribute`), sans jamais remplacer un fichier présent.
 *
 * **Exécutée en « standalone » (zéro boot)**, comme `ai:sync` : l'enregistrement
 * ici sert à l'aide et à la complétion ; l'exécution réelle est interceptée par
 * le fast-path de {@link CliKernel.start}. Le `generate()` n'est qu'un FILET.
 *
 * @example
 * ```bash
 * nodefony scaffold:sync            # pose les fichiers manquants
 * nodefony scaffold:sync --dry-run  # le plan, sans rien écrire
 * ```
 */
class ScaffoldSync extends Command {
  constructor(cli: CliKernel) {
    super(
      "scaffold:sync",
      "pose les fichiers livrés par les paquets installés",
      cli,
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
    const argv = ["node", "nodefony", "scaffold:sync"];
    if (opts?.dryRun) argv.push("--dry-run");
    if (opts?.json) argv.push("--json");
    if (opts?.cwd) argv.push("--cwd", opts.cwd);
    await this.terminate(await runScaffoldSyncCommand(argv));
    return this;
  }
}

export default ScaffoldSync;
