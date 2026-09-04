import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runCheckCommand } from "../checks/runCheck";

const options: OptionsCommandInterface = {
  // Lancée depuis le menu, cette commande BOOTE (le fast-path standalone ne
  // vaut que pour une invocation directe) : sa sortie serait noyée sous le
  // journal de cycle de vie.
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony doctor` — contrôle la cohérence des paquets de l'application.
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
 * nodefony doctor         # sortie lisible, sort en erreur si un manquement
 * nodefony doctor --json  # même chose, exploitable par un script de CI
 * nodefony doctor          # alias historique — même commande
 * ```
 */
class Check extends Command {
  constructor(cli: CliKernel) {
    super(
      "doctor",
      "Diagnostic statique du projet : câblage, dépendances, bilan du dernier démarrage",
      cli as CliKernel,
      options,
    );
    // `doctor` est le nom PRINCIPAL : c'est le mot qu'on tape quand quelque
    // chose ne va pas, celui que les autres écosystèmes ont installé
    // (`brew doctor`, `flutter doctor`), et celui qu'un agent trouve en
    // cherchant à diagnostiquer. « check » ne dit pas ce qu'il vérifie ; il
    // reste en ALIAS, parce qu'il a voyagé et qu'un nom qui a servi ne se
    // retire pas sans prévenir.
    this.alias("check");
    this.addOption("--json", "Machine-readable output");
    this.addOption(
      "--cwd <path>",
      "Start directory (the app root is resolved from it)",
    );
  }

  override async generate(opts?: {
    json?: boolean;
    cwd?: string;
  }): Promise<this> {
    const argv: string[] = [];
    if (opts?.json) argv.push("--json");
    if (opts?.cwd) argv.push("--cwd", opts.cwd);
    const code = await runCheckCommand(argv);
    await this.terminate(code);
    return this;
  }
}

export default Check;
