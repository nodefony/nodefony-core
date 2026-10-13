import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runManCommand } from "../../cli/man";

const options: OptionsCommandInterface = {
  helpGroup: "COMPRENDRE",
  // Lancée depuis le menu, cette commande BOOTE (le fast-path standalone ne
  // vaut que pour une invocation directe) : sa sortie serait noyée sous le
  // journal de cycle de vie.
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony man` — ouvre la page de manuel du paquet `nodefony` qui
 * pilote le projet.
 *
 * `man nodefony` ne la trouve qu'après une installation GLOBALE : dans une
 * application, c'est la seule porte qui mène à la page de la bonne version.
 *
 * **Exécutée en « standalone » (zéro boot)** : l'enregistrement ici sert à
 * l'aide, au menu et à la complétion ; l'exécution réelle est interceptée par
 * le fast-path de {@link CliKernel.start}. Le `generate()` n'est qu'un FILET.
 *
 * @example
 * ```bash
 * nodefony man          # lit le manuel
 * nodefony man --path   # le chemin de la page
 * ```
 */
class Man extends Command {
  constructor(cli: CliKernel) {
    super("man", "la page de manuel de la version du projet", cli, options);
    this.addOption("--path", "Écrit le chemin de la page, sans l'ouvrir");
  }

  override async generate(opts?: { path?: boolean }): Promise<this> {
    const argv = ["node", "nodefony", "man"];
    if (opts?.path) argv.push("--path");
    await this.terminate(runManCommand(argv));
    return this;
  }
}

export default Man;
