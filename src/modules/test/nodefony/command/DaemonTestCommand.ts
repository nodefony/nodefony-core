import { Command } from "nodefony";
import type { CliKernel, OptionsCommandInterface } from "nodefony";

const options: OptionsCommandInterface = {
  showBanner: false,
  // CONSOLE long-running : aucun serveur HTTP/WS. `lifetime:"longrunning"` DÉCLARE le
  // mode daemon → le Kernel parke LUI-MÊME à `onReady` (cf Kernel.finishOrPark), gardant
  // le process vivant comme un worker de queue/consumer/agent, sans binder de port. La
  // commande n'a plus à inliner son park ni son keep-alive timer.
  kernelEvent: "onReady",
  lifetime: "longrunning",
};

/**
 * Commande `nodefony test:daemon` — démontre/teste le **mode DAEMON** : process CONSOLE
 * long-running qui ne démarre AUCUN serveur réseau mais reste vivant (park) jusqu'à un signal.
 * C'est le régime des workers de queue / consumers / agents IA / cron daemon (le master
 * cluster en est un autre exemple). Banc pour le filet d'intégration (3 modes de boot).
 */
class DaemonTest extends Command {
  override async generate(): Promise<void> {
    // Marqueur de readiness daemon (pas de "Server Listen on"). Le park + le keep-alive
    // sont désormais posés par le Kernel (lifetime:"longrunning" + servers:false), pas ici.
    this.log("DAEMON MODE OK — running without HTTP server", "INFO");
  }

  override async onKernelTerminate(): Promise<void> {
    // Graceful shutdown du daemon — fermerait ici les ressources (consumer, sockets…).
    // Le timer de park est libéré par Kernel.terminate (centralisé) — rien à nettoyer ici.
    this.log("DAEMON graceful shutdown (onKernelTerminate)", "INFO");
  }

  constructor(cli: CliKernel) {
    super(
      "test:daemon",
      "Long-running daemon (CONSOLE, no server, parks until signal)",
      cli,
      options,
    );
  }
}

export default DaemonTest;
