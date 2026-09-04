import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { runStatusReport } from "../../service/dev/devStatusReport";

const options: OptionsCommandInterface = {
  helpGroup: "LANCER",
  showBanner: false,
  kernelEvent: "onStart",
};

/**
 * Commande `nodefony status` — photo instantanée des process de développement
 * (superviseur / serveur / Vite + PID, parent, uptime, RSS, %CPU, ports).
 *
 * **Exécutée en « standalone » (zéro boot, hors trunk possible).** L'enregistrement
 * ici sert au help (`nodefony --help`) ; l'exécution réelle est interceptée par le
 * fast-path de {@link CliKernel.start} AVANT tout boot kernel — pur outillage de
 * process ({@link runStatusReport} : `ps` + sonde ports), lançable de n'importe où.
 * Le `generate()` ci-dessous n'est qu'un FILET (si une trunk a booté jusqu'ici).
 */
class Status extends Command {
  constructor(cli: CliKernel) {
    super(
      "status",
      "Montre les runtimes Nodefony actifs (superviseur, serveurs, Vite) et leurs ports",
      cli as CliKernel,
      options,
    );
  }

  override async generate(): Promise<this> {
    await runStatusReport(process.cwd());
    await this.terminate(0);
    return this;
  }
}

export default Status;
