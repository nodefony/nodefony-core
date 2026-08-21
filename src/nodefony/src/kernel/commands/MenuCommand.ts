import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import {
  buildStartMenu,
  buildInspectMenu,
  NPM_SCRIPT_PREFIX,
  type StartMenuItem,
  type IStartMenuModuleCommand,
} from "../../cli/startMenu";
import { readCliManifest } from "../../cli/completion";
import { INSPECT_SUBJECTS } from "../inspect/adminSubjects";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onStart",
};

/**
 * Menu interactif du CLI (`nodefony menu`, ou `nodefony` nu en TTY).
 *
 * La COMPOSITION du menu (groupes, entrées, conseils d'usage) vit dans
 * `cli/startMenu.ts` — pure, testée sans TTY. Ici : l'adaptation inquirer et
 * l'exécution du choix. Deux contextes, détectés par `kernel.trunk` (résolu au
 * `start()` du kernel) : dans un projet, le menu propose les gestes du projet ;
 * hors projet, ceux qui ont un sens partout (créer, voir ce qui tourne).
 */
class Menu extends Command {
  constructor(cli: CliKernel) {
    super(
      "menu",
      "Menu interactif : les commandes utiles ici, expliquées",
      cli,
      options,
    );
    //force interractive
    this.forceInteractiveMode();
  }

  /**
   * Traduit les items neutres de la composition en choices inquirer.
   * `Separator` est une classe du paquet — donc instanciée ICI, jamais dans la
   * composition pure (qui resterait sinon couplée à l'import lourd).
   */
  private toInquirerChoices(items: StartMenuItem[]): unknown[] {
    return items.map((item) =>
      item.kind === "separator"
        ? new this.prompts.Separator(item.label)
        : { name: item.name, value: item.value, description: item.description },
    );
  }

  /**
   * Commandes de MODULE connues du manifest cache de complétion : celles que
   * commander ne connaît pas encore à `onStart` (dispatch différé). Cache
   * absent (jamais booté en dev) → liste vide, le groupe n'apparaît pas.
   */
  private moduleCommandsFromManifest(): IStartMenuModuleCommand[] {
    const manifest = readCliManifest(process.cwd());
    if (!manifest) {
      return [];
    }
    return manifest.commands
      .filter((c) => !this.cli?.getCommand(c.name))
      .map((c) => ({ name: c.name, description: c.description }));
  }

  /**
   * Noms des scripts du `package.json` du projet — le menu n'en proposera que
   * ceux de son catalogue. Lecture fail-soft : pas de fichier, JSON invalide →
   * liste vide, les groupes n'apparaissent pas.
   */
  private npmScriptsFromPackageJson(): string[] {
    try {
      const raw = readFileSync(
        path.join(process.cwd(), "package.json"),
        "utf8",
      );
      const parsed: unknown = JSON.parse(raw);
      const scripts = (parsed as { scripts?: Record<string, string> }).scripts;
      return scripts ? Object.keys(scripts) : [];
    } catch {
      return [];
    }
  }

  override async interaction(): Promise<string | void> {
    const { message, items } = buildStartMenu({
      inProject: Boolean(this.kernel?.trunk),
      projectName: this.kernel?.projectName,
      describe: (name) => {
        const command = this.cli?.getCommand(name);
        return command ? command.description() : null;
      },
      moduleCommands: this.moduleCommandsFromManifest(),
      npmScripts: this.npmScriptsFromPackageJson(),
    });
    const selected = await this.prompts
      .select<string>({
        message,
        choices: this.toInquirerChoices(items) as never,
        pageSize: 18,
        loop: false,
      })
      .catch((e) => {
        this.log((e as Error).message, "ERROR");
        this.terminate(1);
      });
    if (selected === "inspect") {
      const sub = buildInspectMenu(INSPECT_SUBJECTS);
      const subject = await this.prompts
        .select<string>({
          message: sub.message,
          choices: this.toInquirerChoices(sub.items) as never,
          pageSize: 12,
          loop: false,
        })
        .catch((e) => {
          this.log((e as Error).message, "ERROR");
          this.terminate(1);
        });
      // Sentinelle interne « inspect <sujet> » — dépliée par generate().
      return subject ? `inspect ${subject}` : selected;
    }
    return selected as string | void;
  }

  override async generate(response: string): Promise<this> {
    this.log(`run menu : ${response}`);
    if (!this.cli) {
      throw new Error(`cli not found`);
    }
    // Script npm (« npm:verify ») : le geste appartient au projet, pas à
    // commander — on l'exécute tel que l'utilisateur l'aurait tapé, sortie
    // héritée, et le code de sortie du script devient le nôtre.
    if (response.startsWith(NPM_SCRIPT_PREFIX)) {
      const script = response.slice(NPM_SCRIPT_PREFIX.length);
      const r = spawnSync("npm", ["run", script], { stdio: "inherit" });
      this.terminate(r.status ?? 1);
      return this;
    }
    // Choix à ARGUMENT (« inspect routes ») : le chemin rapide `action()`
    // ci-dessous ne rejoue pas argv — seul le re-parse commander porte
    // l'argument jusqu'à la commande. On passe donc directement par lui.
    if (response.includes(" ")) {
      const [name, ...args] = response.split(" ");
      await this.cli.runCommandAsync(name as string, args);
      return this;
    }
    const command = this.cli.getCommand(response);
    if (command && response) {
      if (this.kernel) {
        this.cli.clearCommand();
        if (response) {
          process.argv.push(response);
        }
        // Câblage centralisé (kernel.command + runProfile déclaré + setEvents).
        // On est ICI à `onStart` (phase de cette commande) : les hooks de la
        // commande choisie câblés sur des phases déjà passées ne re-fireront
        // pas → on rejoue son `onKernelStart` à la main, puis on exécute
        // directement si sa phase cible est déjà atteinte (`isComplete`).
        (this.cli as CliKernel).resolveCommand(
          command,
          this.kernel.commandArgs,
        );
        if (command.onKernelStart) {
          await command.onKernelStart(...this.kernel.commandArgs);
        }
        // `kernelEvent === "onStart"` : on est PENDANT le fire de cette phase →
        // `progress` ne la porte pas encore (setCommandComplete arrive après) et
        // le `once` posé par setEvents ne re-firera jamais → exécution directe.
        if (command.isComplete() || command.kernelEvent === this.kernelEvent) {
          await command.action(...this.kernel.commandArgs);
          return this;
        }
        // Phase cible pas encore atteinte → on retombe sur le re-parse commander
        // ci-dessous (évaluation des options de la commande choisie) ; les `once`
        // déjà posés sont protégés par le guard `eventsRegistered`.
      }
    }
    return await this.cli.runCommandAsync(response).then(() => {
      return this;
    });
  }

  override async showBanner(): Promise<string> {
    const name = this.kernel?.projectName as string;
    await this.cli?.showAsciify(name);
    return this.cli?.showBanner() as string;
  }
}

export default Menu;
