import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runStopReport } from "../../service/dev/devStop";

const options: OptionsCommandInterface = {
  helpGroup: "LANCER",
  showBanner: false,
  kernelEvent: "onStart",
};

/**
 * Commande `nodefony stop` — arrêt PROPRE et COMPLET des process de dev (superviseur +
 * serveur + Vite). Remplace le `pkill -9` manuel ; idempotent.
 *
 * **Exécutée en « standalone » (zéro boot, hors trunk possible)** : l'enregistrement
 * ici sert au help ; l'exécution réelle est interceptée par le fast-path de
 * {@link CliKernel.start} AVANT tout boot ({@link runStopReport} : ps + group-kill +
 * attente ports). Donc lançable de n'importe où — utile pour tuer des zombies. Le
 * `generate()` n'est qu'un FILET (si une trunk a booté jusqu'ici).
 */
class Stop extends Command {
  constructor(cli: CliKernel) {
    super(
      "stop",
      "arrête les processus Nodefony de ce projet",
      cli as CliKernel,
      options,
    );
    this.addArgument(
      "[project]",
      "projet à arrêter (nom ou chemin) — défaut : le projet du répertoire courant",
    );
    this.addOption(
      "--all",
      "stop Nodefony runtimes of ALL projects on this machine (default: current project only)",
    );
  }

  override async generate(project?: string): Promise<this> {
    const code = await runStopReport(process.cwd(), {
      all: process.argv.includes("--all"),
      target: project,
    });
    await this.terminate(code);
    return this;
  }
}

export default Stop;
