import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runImageCheckCommand } from "../../cli/image";

const options: OptionsCommandInterface = {
  helpGroup: "GÉNÉRER ET CONSTRUIRE",
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony image:check` — refuse une image qui embarque un secret.
 *
 * **Exécutée en « standalone » (zéro boot)**, comme `doctor`, `env` et
 * `symbols` : l'enregistrement ici sert au help. Elle lit une archive produite
 * par `docker save`, jamais l'application — la faire démarrer serait absurde
 * (on juge un artefact, pas un serveur) et la rendrait muette là où elle sert
 * le plus : une chaîne d'intégration qui vient de construire une image.
 *
 * @example
 * ```bash
 * nodefony image:check mon-app:1.2.3       # avant de pousser
 * nodefony image:check --files relevé.txt  # juger un inventaire, sans docker
 * ```
 */
class Image extends Command {
  constructor(cli: CliKernel) {
    super(
      "image:check",
      "refuse une image de conteneur qui embarque un secret",
      cli,
      options,
    );
    this.addOption(
      "--files <path>",
      "juger un inventaire de chemins déjà relevé (sans docker)",
    );
  }

  /**
   * La voie NORMALE est le fast-path de {@link CliKernel} ; ce chemin-ci ne
   * sert qu'à une invocation différée (menu, dispatch). On y relit
   * `process.argv` plutôt que de recomposer un argv depuis les options de
   * commander : la référence de l'image est un argument POSITIONNEL, et le
   * recomposer le perdrait — la commande jugerait alors « rien », sans le dire.
   */
  override async generate(): Promise<this> {
    await this.terminate(await runImageCheckCommand(process.argv));
    return this;
  }
}

export default Image;
