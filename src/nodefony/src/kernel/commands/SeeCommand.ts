import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runSeeCommand } from "../../cli/see";

const options: OptionsCommandInterface = {
  helpGroup: "COMPRENDRE",
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony see` — ouvrir une page dans un navigateur piloté et la MESURER.
 *
 * **Exécutée en « standalone » (zéro boot)**, comme `doctor`, `env` et `card` :
 * l'enregistrement ici sert au help et à la complétion. Elle pilote un
 * navigateur contre une application qui tourne DÉJÀ — la faire démarrer un
 * second Kernel n'apporterait rien et prendrait le port.
 *
 * Elle remplace cinq scripts du gabarit d'application, dont trois portaient un
 * chemin en dur dans `node_modules` : un tel chemin casse en silence le jour où
 * le paquet réorganise ses dossiers.
 *
 * @example
 * ```bash
 * nodefony see https://127.0.0.1:5152/            # contrastes, console, réseau
 * nodefony see https://127.0.0.1:5152/ --watch    # surveille et signale ce qui change
 * nodefony see https://127.0.0.1:5152/ --audit    # accessibilité, performance, bonnes pratiques
 * nodefony see https://127.0.0.1:5152/ --install  # installe l'outillage manquant, puis mesure
 * ```
 */
class See extends Command {
  constructor(cli: CliKernel) {
    super(
      "see",
      "ouvre une page dans un navigateur piloté et la MESURE",
      cli as CliKernel,
      options,
    );
    this.addOption(
      "--watch",
      "surveille l'écran en continu, signale ce qui change",
    );
    this.addOption(
      "--audit",
      "audit complet : accessibilité, performance, bonnes pratiques",
    );
    this.addOption(
      "--install",
      "installe l'outillage manquant avant de mesurer (plusieurs centaines de Mo)",
    );
  }

  /**
   * La voie NORMALE est le fast-path de {@link CliKernel} ; ce chemin ne sert
   * qu'à une invocation différée. On relit `process.argv` plutôt que de
   * recomposer depuis les options de commander : l'URL est un argument
   * POSITIONNEL, et la recomposer la perdrait.
   */
  override async generate(): Promise<this> {
    await this.terminate(await runSeeCommand(process.argv));
    return this;
  }
}

export default See;
