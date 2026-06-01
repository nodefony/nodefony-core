import { Command } from "nodefony";
import type { CliKernel, OptionsCommandInterface } from "nodefony";

const options: OptionsCommandInterface = {
  showBanner: false,
  // CONSOLE long-running : aucun serveur HTTP/WS. generate parke le flow → le process
  // reste vivant comme un daemon (worker de queue, consumer, agent…), sans binder de port.
  kernelEvent: "onReady",
};

/**
 * Commande `nodefony test:daemon` — démontre/teste le **mode DAEMON** : process CONSOLE
 * long-running qui ne démarre AUCUN serveur réseau mais reste vivant (park) jusqu'à un signal.
 * C'est le régime des workers de queue / consumers / agents IA / cron daemon (le master
 * cluster en est un autre exemple). Banc pour le filet d'intégration (3 modes de boot).
 */
class DaemonTest extends Command {
  #beat: NodeJS.Timeout | null = null;

  override async generate(): Promise<void> {
    // Marqueur de readiness daemon (pas de "Server Listen on").
    this.log("DAEMON MODE OK — running without HTTP server", "INFO");
    // ⚠️ Un daemon CONSOLE n'a pas de socket serveur pour garder l'event loop vivant.
    // Une Promise pending NE garde PAS Node en vie (Node sort dès l'event loop vide).
    // Un vrai daemon tient un handle (consumer, socket, timer). On simule par un timer
    // heartbeat ref'd. (DevCommand/master survivent, eux, via leurs propres handles.)
    this.#beat = setInterval(() => {}, 1 << 30);
    await new Promise<void>(() => {});
  }

  override async onKernelTerminate(): Promise<void> {
    // Graceful shutdown du daemon — fermerait ici les ressources (consumer, sockets…).
    if (this.#beat) clearInterval(this.#beat);
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
