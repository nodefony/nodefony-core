import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runUpgradeCommand, UPGRADE_USAGE } from "../../cli/upgrade";
import { usageExamples } from "../../cli/usageReport";

const options: OptionsCommandInterface = {
  // Rangée à côté d'`outdated` et d'`install` : c'est la suite du même geste —
  // voir le retard, monter les paquets, puis remettre l'application au niveau.
  helpGroup: "GÉNÉRER ET CONSTRUIRE",
  // Lancée depuis le menu, cette commande BOOTE (le fast-path standalone ne
  // vaut que pour une invocation directe) : sa sortie serait noyée sous le
  // journal de cycle de vie.
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony upgrade` — remet une application au niveau de la version
 * de Nodefony installée : bloc framework d'`AGENTS.md`, pointeurs de skills,
 * copies livrées intactes.
 *
 * **Exécutée en « standalone » (zéro boot)**, comme `scaffold:sync` :
 * l'enregistrement ici sert à l'aide, au menu et à la complétion ; l'exécution
 * réelle est interceptée par le fast-path de {@link CliKernel.start}. Le
 * `generate()` n'est qu'un FILET.
 *
 * @example
 * ```bash
 * npm install nodefony@beta @nodefony/http@beta …   # monter les paquets
 * nodefony upgrade                                  # puis l'application
 * nodefony upgrade --check                          # en CI : 1 si en retard
 * ```
 */
class Upgrade extends Command {
  constructor(cli: CliKernel) {
    super("upgrade", "aligne l'app sur la version de Nodefony installée", cli, {
      ...options,
      examples: () => usageExamples(UPGRADE_USAGE),
    });
    this.addOption("--check", "Dit ce qui est en retard, sort en 1 si oui");
    this.addOption("--dry-run", "Le plan, sans rien écrire");
    this.addOption("--json", "Sortie exploitable par un script");
    this.addOption(
      "--cwd <path>",
      "Point de départ (la racine de l'app est résolue en remontant)",
    );
  }

  override async generate(opts?: {
    check?: boolean;
    dryRun?: boolean;
    json?: boolean;
    cwd?: string;
  }): Promise<this> {
    const argv = ["node", "nodefony", "upgrade"];
    if (opts?.check) argv.push("--check");
    if (opts?.dryRun) argv.push("--dry-run");
    if (opts?.json) argv.push("--json");
    if (opts?.cwd) argv.push("--cwd", opts.cwd);
    await this.terminate(await runUpgradeCommand(argv));
    return this;
  }
}

export default Upgrade;
