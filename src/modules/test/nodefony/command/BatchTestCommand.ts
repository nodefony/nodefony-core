import { Command } from "nodefony";
import type { CliKernel, OptionsCommandInterface } from "nodefony";

const options: OptionsCommandInterface = {
  showBanner: false,
  // CONSOLE one-shot : aucun setType("SERVER") → 0 serveur HTTP/WS. Le Kernel boote
  // jusqu'à onReady, generate s'exécute, puis setCommandComplete(onReady) → terminate(0).
  kernelEvent: "onReady",
};

/**
 * Commande `nodefony test:batch` — démontre/teste le **mode BATCH one-shot** : boot CONSOLE
 * (sans serveur réseau), exécution d'un job, puis terminaison propre. Sert de banc pour le
 * filet d'intégration (3 modes : server / batch / daemon) et exerce le dispatch d'une
 * commande de MODULE (namespace `<module>:<action>`).
 */
class BatchTest extends Command {
  constructor(cli: CliKernel) {
    super(
      "test:batch",
      "Batch one-shot job (CONSOLE, no server)",
      cli,
      options,
    );
  }

  override async generate(): Promise<void> {
    // Marqueur lu par le filet : prouve qu'un job CONSOLE a tourné sans démarrer de serveur.
    this.log("BATCH MODE OK — one-shot console job done", "INFO");
  }

  override async onKernelTerminate(): Promise<void> {
    // Démontre le hook de cleanup disponible pour tous les modes.
    this.log("BATCH cleanup (onKernelTerminate)", "INFO");
  }
}

export default BatchTest;
