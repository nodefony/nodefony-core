import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runAiMcpCommand } from "../../cli/aiMcp";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onRegister",
  // 🔴 Le fast-path standalone ne s'applique QU'À une invocation directe :
  // lancée depuis le menu, le kernel tourne déjà, la commande passe par
  // commander et BOOTE. Sa sortie arrivait alors sous dix lignes de
  // « MODULE ADD » — pour écrire un fichier de trois lignes.
  quietBoot: true,
};

/**
 * Commande `nodefony ai:mcp` — déclare le serveur MCP de cette application à
 * l'agent (`.mcp.json`).
 *
 * **Exécutée en « standalone » (zéro boot).** L'enregistrement ici sert au help
 * (`nodefony --help`) et à la complétion ; l'exécution réelle est interceptée
 * par le fast-path de {@link CliKernel.start} — elle n'écrit qu'un fichier de
 * câblage, le serveur MCP étant une ROUTE de l'application. Le `generate()`
 * ci-dessous n'est qu'un FILET.
 *
 * @example
 * ```bash
 * nodefony ai:mcp             # écrit/actualise .mcp.json
 * nodefony ai:mcp --dry-run   # le plan, sans rien écrire
 * nodefony ai:mcp --auth      # mode authentifié (en-tête ${NF_MCP_TOKEN})
 * ```
 */
class AiMcp extends Command {
  constructor(cli: CliKernel) {
    super(
      "ai:mcp",
      "Déclare le serveur MCP de cette application à ton agent (.mcp.json)",
      cli as CliKernel,
      options,
    );
    this.addOption(
      "-a, --auth",
      "Mode authentifié : l'en-tête porte ${NF_MCP_TOKEN}, jamais le jeton",
    );
    this.addOption(
      "--no-auth",
      "Retire l'en-tête d'autorisation (sans option, le mode en place est CONSERVÉ)",
    );
    this.addOption(
      "--url <origine>",
      "Origine forcée (ex. https://localhost:5152)",
    );
    this.addOption("--dry-run", "Le plan, sans rien écrire");
    this.addOption("--json", "Sortie exploitable par un script");
    this.addOption(
      "--cwd <path>",
      "Point de départ (la racine de l'app est résolue en remontant)",
    );
  }

  override async generate(opts?: {
    auth?: boolean;
    noAuth?: boolean;
    url?: string;
    dryRun?: boolean;
    json?: boolean;
    cwd?: string;
  }): Promise<this> {
    const argv = ["node", "nodefony", "ai:mcp"];
    if (opts?.auth) argv.push("--auth");
    if (opts?.noAuth) argv.push("--no-auth");
    if (opts?.url) argv.push("--url", opts.url);
    if (opts?.dryRun) argv.push("--dry-run");
    if (opts?.json) argv.push("--json");
    if (opts?.cwd) argv.push("--cwd", opts.cwd);
    await this.terminate(await runAiMcpCommand(argv));
    return this;
  }
}

export default AiMcp;
