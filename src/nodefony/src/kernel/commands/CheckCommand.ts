import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runCheckCommand } from "../checks/runCheck";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony check` — contrôle la cohérence des paquets de l'application.
 *
 * Elle répond à une question qu'aucun test applicatif ne pose : **ce que mes
 * modules importent, est-ce qu'ils le déclarent ?** Tant qu'on développe, la
 * réponse n'a aucune importance — npm hisse tout à la racine du projet, donc un
 * import non déclaré se résout quand même. Elle en prend le jour où le module
 * part ailleurs : l'installation n'amène pas ce qui n'est pas déclaré, et un
 * outil de construction ne peut pas ordonner ce qu'on ne lui a pas dit.
 *
 * **Exécutée en « standalone » (zéro boot).** L'enregistrement ici sert au help
 * (`nodefony --help`) ; l'exécution réelle est interceptée par le fast-path de
 * {@link CliKernel.start} AVANT toute construction de Kernel — le contrôle ne
 * lit que des fichiers. Le `generate()` ci-dessous n'est qu'un FILET.
 *
 * Un projet déclare ses exceptions dans son `package.json`, clé
 * `nodefony.check` (`typeCycles`, `typesUnreachable`) : un cycle de types
 * légitime existe, et un contrôle qu'on ne peut pas satisfaire est un contrôle
 * qu'on apprend à ignorer.
 *
 * @example
 * ```bash
 * nodefony check          # sortie lisible, sort en erreur si un manquement
 * nodefony check --json   # même chose, exploitable par un script de CI
 * ```
 */
class Check extends Command {
  constructor(cli: CliKernel) {
    super(
      "check",
      "Check that every Nodefony package imported by the app is declared",
      cli as CliKernel,
      options,
    );
    this.addOption("--json", "Machine-readable output");
  }

  override async generate(opts?: { json?: boolean }): Promise<this> {
    const code = runCheckCommand(opts?.json ? ["--json"] : []);
    await this.terminate(code);
    return this;
  }
}

export default Check;
