import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import {
  buildStartMenu,
  buildInspectMenu,
  filterStartMenu,
  NPM_SCRIPT_PREFIX,
  type StartMenuItem,
  type IStartMenuModuleCommand,
  planMenuAction,
} from "../../cli/startMenu";
import { readCliManifest } from "../../cli/completion";
import { INSPECT_SUBJECTS } from "../inspect/adminSubjects";
import { resolveColorEnabled } from "../../syslog/logColor";

const options: OptionsCommandInterface = {
  // L'en-tête du menu est UNE ligne sobre (posée par interaction) — pas
  // l'ascii-art : un menu se lit, il ne s'annonce pas.
  showBanner: false,
  kernelEvent: "onStart",
};

/** Choice inquirer rendu par l'adaptateur (name stylé, short = le nom brut). */
interface IRenderedChoice {
  name: string;
  value: string;
  short: string;
  description: string;
}

/**
 * Menu interactif du CLI (`nodefony menu`, ou `nodefony` nu en TTY).
 *
 * La COMPOSITION (groupes, entrées, conseils, filtrage à la frappe) vit dans
 * `cli/startMenu.ts` — pure, testée sans TTY. Ici : le RENDU (couleurs gatées,
 * alignement à la largeur du terminal, aération des groupes), le prompt
 * `search` (taper filtre, façon palette), et l'exécution du choix. Ctrl+C est
 * un choix légitime : sortie 0, une ligne sobre — jamais une erreur.
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

  // ── Style — ANSI gaté par la même règle que les logs (NO_COLOR, TTY) ──────
  #color = false;
  #dim(text: string): string {
    return this.#color ? `\x1b[2m${text}\x1b[22m` : text;
  }
  #bold(text: string): string {
    return this.#color ? `\x1b[1m${text}\x1b[22m` : text;
  }
  #cyan(text: string): string {
    return this.#color ? `\x1b[36m${text}\x1b[39m` : text;
  }

  /** Largeur utile du terminal (bornée : un résumé ne dépasse jamais). */
  #columns(): number {
    return Math.min(process.stdout.columns || 80, 110);
  }

  /**
   * Traduit les items neutres en choices inquirer STYLÉS :
   * - un titre de groupe = une ligne vide puis le titre en capitales discrètes
   *   (l'aération est ce qui rend une liste de 20 entrées lisible) ;
   * - un choix = label cyan aligné sur la colonne + résumé estompé, tronqué à
   *   la largeur réelle du terminal (une ligne qui replie casse l'alignement).
   */
  #render(
    items: StartMenuItem[],
  ): (IRenderedChoice | InstanceType<typeof this.prompts.Separator>)[] {
    const labels = items.filter((i) => i.kind === "choice");
    const col = Math.max(...labels.map((c) => c.label.length), 10) + 2;
    const width = this.#columns();
    const out: (
      IRenderedChoice | InstanceType<typeof this.prompts.Separator>
    )[] = [];
    for (const item of items) {
      if (item.kind === "separator") {
        out.push(new this.prompts.Separator(" "));
        out.push(
          new this.prompts.Separator(
            `  ${this.#bold(this.#dim(item.label.toUpperCase()))}`,
          ),
        );
        continue;
      }
      const room = width - col - 6;
      const summary =
        item.summary.length > room && room > 8
          ? `${item.summary.slice(0, room - 1)}…`
          : item.summary;
      out.push({
        name: `${this.#cyan(item.label.padEnd(col))}${this.#dim(summary)}`,
        value: item.value,
        short: item.label,
        description: this.#dim(item.description),
      });
    }
    return out;
  }

  /** Thème partagé des prompts du menu — sobre, aide clavier en français. */
  #theme() {
    return {
      prefix: { idle: this.#cyan("⬢"), done: this.#cyan("⬢") },
      icon: { cursor: "❯" },
      style: {
        highlight: (text: string) => this.#bold(this.#cyan(text)),
        description: (text: string) => `\n  ${text}`,
        keysHelpTip: () =>
          this.#dim(
            "  ↑↓ naviguer · taper pour filtrer · ⏎ choisir · ctrl+c quitter",
          ),
      },
    };
  }

  /** Ctrl+C pendant un prompt = un choix, pas une panne : sortie 0, sobre. */
  async #quit(e: unknown): Promise<never> {
    if ((e as Error)?.name === "ExitPromptError") {
      process.stdout.write(`\n${this.#dim("À bientôt.")}\n`);
      // Sortie par le shutdown NORMAL du kernel (drain compris), en `quiet` :
      // après « À bientôt. », la moindre ligne de log — même INFO — redonne
      // l'air d'une erreur (vécu, deux fois : le throw, puis le log kernel).
      await this.cli?.terminate(0, true);
    }
    this.log((e as Error).message, "ERROR");
    this.terminate(1);
    // `terminate` est ASYNCHRONE : relancer ici ferait remonter l'erreur au
    // kernel AVANT l'exit — CRITIC + sortie 1 (vécu). Promesse en attente :
    // le process sort par terminate, jamais par ce fil.
    return new Promise<never>(() => {});
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
    // Exclusion par NOMS ET ALIAS des built-ins (dérivés de commander) — pas
    // par getCommand, qui ignore les alias : un manifest écrit par une version
    // antérieure peut porter une commande devenue alias (vécu : `start`,
    // devenu l'alias de `production`, présenté comme commande du projet).
    const builtins = (this.cli as CliKernel).getBuiltinCommandNames();
    return manifest.commands
      .filter((c) => !builtins.has(c.name))
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
    this.#color = resolveColorEnabled(Boolean(this.kernel?.isTTY));
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
    const version = this.kernel?.version ? ` v${this.kernel.version}` : "";
    process.stdout.write(
      `\n${this.#bold(this.kernel?.projectName ?? "nodefony")}${this.#dim(version)}\n`,
    );
    const pageSize = Math.max(
      8,
      Math.min(items.length + 8, (process.stdout.rows || 24) - 6),
    );
    const selected = await this.prompts
      .search<string>({
        message,
        source: (term) => this.#render(filterStartMenu(items, term ?? "")),
        pageSize,
        theme: this.#theme(),
      })
      .catch((e) => this.#quit(e));
    if (selected === "inspect") {
      const sub = buildInspectMenu(INSPECT_SUBJECTS);
      const subject = await this.prompts
        .select<string>({
          message: sub.message,
          choices: this.#render(sub.items) as never,
          pageSize: 12,
          loop: false,
          theme: this.#theme(),
        })
        .catch((e) => this.#quit(e));
      // Sentinelle interne « inspect <sujet> » — dépliée par generate().
      return `inspect ${subject}`;
    }
    return selected;
  }

  override async generate(response: string): Promise<this> {
    if (!this.cli) {
      throw new Error(`cli not found`);
    }
    // Écran REMIS À ZÉRO avant d'exécuter : la commande démarre sur une page
    // propre, avec une ligne qui rappelle ce qui se lance — le menu a rempli
    // l'écran, le laisser derrière rend toute sortie illisible.
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    process.stdout.write(
      `${this.#cyan("⬢")} ${this.#bold(this.kernel?.projectName ?? "nodefony")} ${this.#dim(`— ${response.replace(NPM_SCRIPT_PREFIX, "npm run ")}`)}\n\n`,
    );
    // Script npm (« npm:verify ») : le geste appartient au projet, pas à
    // commander — on l'exécute tel que l'utilisateur l'aurait tapé, sortie
    // héritée, et le code de sortie du script devient le nôtre.
    const plan = planMenuAction(response, (name) =>
      Boolean(this.cli?.getCommand(name)),
    );
    if (plan.kind === "npm") {
      const r = spawnSync("npm", ["run", plan.script], { stdio: "inherit" });
      this.terminate(r.status ?? 1);
      return this;
    }
    // Commande de MODULE : commander ne la connaît PAS à `onStart` (elles sont
    // posées à `onPreRegister`, par le dispatch différé), et le re-parse
    // répondait « unknown command 'http:network' » + CRITIC + exit 1 — un menu
    // qui propose un geste puis le refuse. On relance le CLI dans un process
    // neuf, qui boote normalement et dispatche : le même patron que le script
    // npm juste au-dessus. `process.argv[1]` est le bin par lequel on est entré,
    // donc l'exécution reste celle du projet (le lanceur a déjà tranché entre
    // CLI global et CLI local).
    if (plan.kind === "respawn") {
      const bin = process.argv[1];
      // 🔴 `--interactive` PROPAGÉ à l'appel système. Une commande choisie au
      // menu n'a pas été tapée : personne n'a pu lui passer d'argument ni
      // d'option. Elle doit donc poser ses questions — et le process relancé
      // n'a aucun autre moyen de savoir qu'il vient de là. Sans ce drapeau, le
      // menu proposait des gestes que la commande refusait ensuite.
      const r = bin
        ? spawnSync(process.execPath, [bin, "--interactive", ...plan.argv], {
            stdio: "inherit",
          })
        : { status: 1 };
      this.terminate(r.status ?? 1);
      return this;
    }
    // Choix à ARGUMENT (« inspect routes ») : le chemin rapide `action()`
    // ci-dessous ne rejoue pas argv — seul le re-parse commander porte
    // l'argument jusqu'à la commande. On passe donc directement par lui.
    if (response.includes(" ")) {
      const [name, ...args] = response.split(" ");
      // Même règle que le respawn ci-dessus, sans changer de process : la
      // commande vient d'un CHOIX, elle doit pouvoir demander ce qui lui
      // manque. (`interaction()` par défaut rend ses arguments, désormais
      // étalés correctement vers `generate` — cf `Command.run`.)
      this.cli.getCommand(name as string)?.forceInteractiveMode();
      await this.cli.runCommandAsync(name as string, args);
      return this;
    }
    const command = this.cli.getCommand(response);
    if (command && response) {
      // Choisie au menu, donc interactive : elle réclamera ce qu'il lui faut.
      command.forceInteractiveMode();
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
}

export default Menu;
