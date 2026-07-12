import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { CREATE_TYPES, runCreateCommand } from "../../cli/create";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onStart",
};

/**
 * Commande `nodefony create <type> <name>` — scaffold d'un projet Nodefony depuis
 * les templates shippés (`templates/<type>/`).
 *
 * En pratique l'invocation directe est interceptée par le fast-path STANDALONE de
 * `CliKernel.start` (0 boot — cas nominal : `npx nodefony create app mon-app` HORS
 * de tout projet) ; cette classe existe pour la surface commander (help, complétion)
 * et route vers la MÊME logique (une seule source : `runCreateCommand`).
 */
class Create extends Command {
  constructor(cli: CliKernel) {
    super(
      "create",
      `Scaffold a new Nodefony project (${CREATE_TYPES.join(" | ")})`,
      cli,
      options,
    );
    this.addArgument("<type>", CREATE_TYPES.join(" | "));
    this.addArgument("<name>", "project name (kebab-case)");
    this.addOption("--dir <path>", "target directory (default: ./<name>)");
    this.addOption("-f, --force", "allow a non-empty target directory");
    this.addOption(
      "--link",
      "wire nodefony deps as file: links to a local checkout (framework dev)",
    );
  }

  override async generate(): Promise<this> {
    // Même routeur que le fast-path — argv porte déjà type/name/options.
    runCreateCommand(process.argv);
    return this;
  }
}

export default Create;
