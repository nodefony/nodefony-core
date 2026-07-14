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
    // `.choices()` : validation commander + candidats du TAB (le manifest de
    // complétion extrait `argChoices` — sans lui, `create <TAB>` ne proposait
    // jamais `app`).
    this.addArgument("<type>", CREATE_TYPES.join(" | ")).choices([
      ...CREATE_TYPES,
    ]);
    this.addArgument("[name]", "project name (kebab-case — asked if omitted)");
    this.addOption("--dir <path>", "target directory (default: ./<name>)");
    this.addOption("-f, --force", "allow a non-empty target directory");
    this.addOption("--preset <preset>", "complete (default) | minimal");
    this.addOption("--frontend <fw>", "none (default) | react | vue | angular");
    this.addOption("-y, --yes", "accept spec defaults (skip interactive mode)");
    this.addOption(
      "--link",
      "wire nodefony deps as file: links to a local checkout (framework dev)",
    );
    this.addOption("--no-link", "force registry versions (skip link question)");
    // `create entity Post title:string content:text` — les champs sont positionnels ;
    // ces options règlent le reste (clé primaire, artefacts, cible).
    this.addOption(
      "--id <kind>",
      "entity primary key: uuid7 (default) | uuid4 | serial",
    );
    this.addOption("--soft-delete", "entity: add deletedAt column");
    this.addOption("--no-timestamps", "entity: drop createdAt/updatedAt");
    this.addOption("--no-controller", "entity: skip the REST/WS controller");
    this.addOption("--no-tests", "entity: skip the generated tests");
    this.addOption(
      "--connector <name>",
      "entity: ORM connector (default: default)",
    );
    this.addOption(
      "--dialect <d>",
      "entity: sqlite | postgres | mysql (default: from config)",
    );
    this.addOption(
      "--fields <spec>",
      'entity: "title:string content:text" (else positional)',
    );
  }

  override async generate(): Promise<this> {
    // Même routeur que le fast-path — argv porte déjà type/name/options.
    await runCreateCommand(process.argv);
    return this;
  }
}

export default Create;
