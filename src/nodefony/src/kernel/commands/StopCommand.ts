import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runStopReport } from "../../service/dev/devStop";

const options: OptionsCommandInterface = {
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
      "Stop running Nodefony dev processes (supervisor/server/vite) cleanly",
      cli as CliKernel,
      options,
    );
  }

  override async generate(): Promise<this> {
    await runStopReport(process.cwd());
    await this.terminate(0);
    return this;
  }
}

export default Stop;
