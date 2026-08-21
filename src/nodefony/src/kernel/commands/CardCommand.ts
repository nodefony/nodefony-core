import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runCardCommand } from "../../cli/card";
import { version } from "../../../package.json";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony card` — la carte de visite de l'application : qui répond,
 * où aller ensuite, quoi lancer.
 *
 * C'est la PREMIÈRE commande d'un agent (ou d'un humain) qui arrive dans une
 * application qu'il ne connaît pas — donc la seule qui ne peut se permettre
 * aucune condition d'accès.
 *
 * **Exécutée en « standalone » (zéro boot).** L'enregistrement ici sert au help
 * (`nodefony --help`) ; l'exécution réelle est interceptée par le fast-path de
 * {@link CliKernel.start}. Délibéré, et pour deux raisons mesurées : une
 * application fraîchement générée n'est pas encore CONSTRUITE (tout ce qui exige
 * un Kernel répond alors « lance npm run build »), et un terminal sans
 * `NODE_ENV` faisait disparaître la carte avec le module `policy: "dev"` qui la
 * portait (`unknown command`, sans piste).
 *
 * L'alias `devkit:card` reste reconnu — c'est le nom sous lequel la carte a
 * d'abord existé, et il est écrit dans les `AGENTS.md` déjà générés.
 *
 * @example
 * ```bash
 * nodefony card           # la carte, pour un humain ou un agent qui lit un terminal
 * nodefony card --json    # la même, pour un programme
 * ```
 */
class Card extends Command {
  constructor(cli: CliKernel) {
    super(
      "card",
      "Carte de visite de l'application : où aller, quoi lancer",
      cli as CliKernel,
      options,
    );
    this.alias("devkit:card");
    this.addOption("-j, --json", "sortie JSON (scriptable)");
    this.addOption(
      "--cwd <path>",
      "Point de départ (la racine de l'app est résolue en remontant)",
    );
  }

  override async generate(opts?: { json?: boolean }): Promise<this> {
    const code = runCardCommand(
      opts?.json ? ["card", "--json"] : ["card"],
      version,
    );
    await this.terminate(code);
    return this;
  }
}

export default Card;
