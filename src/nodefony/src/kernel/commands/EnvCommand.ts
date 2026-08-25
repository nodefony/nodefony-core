import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runEnvCommand } from "../../cli/env";

const options: OptionsCommandInterface = {
  // Lancée depuis le menu, cette commande BOOTE (le fast-path standalone ne
  // vaut que pour une invocation directe) : sa sortie serait noyée sous le
  // journal de cycle de vie.
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony env` — l'environnement de l'application, en entier.
 *
 * Elle répond aux quatre questions qu'on se pose toujours ensemble, et dont
 * aucune n'avait de réponse ailleurs que dans le code du framework : **quels
 * fichiers `.env` sont lus et dans quel ORDRE**, **quelles variables
 * l'application déclare**, **quelle valeur est effective et d'où elle vient**,
 * et **ce qui est ignoré** — une valeur masquée par un fichier plus prioritaire,
 * ou une variable `NF_` mal orthographiée, qui n'a aucun effet et ne le dit
 * jamais.
 *
 * **Exécutée en « standalone » (zéro boot).** L'enregistrement ici sert au help
 * (`nodefony --help`) ; l'exécution réelle est interceptée par le fast-path de
 * {@link CliKernel.start}. C'est délibéré : on cherche une variable
 * d'environnement précisément quand l'application NE démarre pas. Une commande
 * de diagnostic qui exige un boot réussi est muette au seul moment où elle sert.
 *
 * Sort en 78 (`EX_CONFIG`) si une variable REQUISE manque — un script s'arrête
 * là plutôt que de lancer un démarrage voué à l'échec.
 *
 * @example
 * ```bash
 * nodefony env           # cascade, variables, provenance, ce qui est ignoré
 * nodefony env --json    # même rapport, pour un script ou un agent
 * ```
 */
class Env extends Command {
  constructor(cli: CliKernel) {
    super(
      "env",
      "Variables d'environnement : cascade des .env, valeurs effectives et provenance",
      cli as CliKernel,
      options,
    );
    this.addOption("-j, --json", "sortie JSON (scriptable)");
    this.addOption(
      "--example",
      "Dérive .env.example du catalogue env.ts (ADR-0006)",
    );
    this.addOption(
      "--check",
      "Avec --example : vérifie sans écrire, sort en erreur si le fichier diverge",
    );
    this.addOption(
      "--cwd <path>",
      "Point de départ (la racine de l'app est résolue en remontant)",
    );
  }

  override async generate(opts?: { json?: boolean }): Promise<this> {
    const code = await runEnvCommand(opts?.json ? ["env", "--json"] : ["env"]);
    await this.terminate(code);
    return this;
  }
}

export default Env;
