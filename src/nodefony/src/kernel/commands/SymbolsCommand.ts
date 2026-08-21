import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runSymbolsCommand } from "../../cli/symbols";

const options: OptionsCommandInterface = {
  // Lancée depuis le menu, cette commande BOOTE (le fast-path standalone ne
  // vaut que pour une invocation directe) : sa sortie serait noyée sous le
  // journal de cycle de vie.
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony symbols` — le graphe symbolique du framework, en O(1).
 *
 * Répond à « qu'est-ce que ce symbole, où est-il défini, qui l'étend » sans
 * ouvrir un `.d.ts` ni parcourir des sources — et donc sans que l'agent ait à
 * deviner.
 *
 * **Exécutée en « standalone » (zéro boot)**, comme `check`, `env` et `card` :
 * l'enregistrement ici sert au help. Le graphe est un FICHIER ; le faire lire
 * par une application démarrée aurait rendu la commande muette exactement quand
 * l'application ne démarre plus, et coûté un boot pour une lecture de JSON.
 *
 * @example
 * ```bash
 * nodefony symbols AbstractCrudService      # définition + TSDoc + parenté
 * nodefony symbols --module @nodefony/http  # la surface exportée d'un paquet
 * nodefony symbols                          # d'où vient le graphe, ce qu'il couvre
 * ```
 */
class Symbols extends Command {
  constructor(cli: CliKernel) {
    super(
      "symbols",
      "Graphe symbolique : définition, description et parenté d'un symbole",
      cli as CliKernel,
      options,
    );
    this.addOption("-j, --json", "sortie JSON (scriptable)");
    this.addOption(
      "--cwd <path>",
      "Point de départ (la racine de l'app est résolue en remontant)",
    );
    this.addOption("-m, --module <nom>", "n'afficher qu'un paquet");
  }

  override async generate(opts?: {
    json?: boolean;
    module?: string;
  }): Promise<this> {
    const argv = ["symbols"];
    if (opts?.json) argv.push("--json");
    if (opts?.module) argv.push("--module", opts.module);
    await this.terminate(runSymbolsCommand(argv));
    return this;
  }
}

export default Symbols;
