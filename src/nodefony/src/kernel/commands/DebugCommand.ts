import CliKernel from "../CliKernel";
import Dev from "./DevCommand";
import type { IDevInspectRequest } from "../../service/dev/devInspector";

/**
 * Commande `nodefony debug` — le mode développement, débogueur prêt en une commande.
 *
 * Même pipeline que `development` (build avec sourcemaps, superviseur, rechargement
 * automatique, `--no-watch`, `--detach`) : c'est une sous-classe, pas une copie.
 * Elle ajoute l'inspecteur ouvert DANS le serveur sur `127.0.0.1:9229` — rouvert à
 * chaque rechargement — et dit comment s'y attacher. `--inspect=<port>` change le
 * port, `--inspect-brk` arrête avant le chargement de l'application.
 *
 * Pas `inspect` : ce nom est déjà pris par l'introspection de l'application
 * (routes, services, config).
 */
class Debug extends Dev {
  constructor(cli: CliKernel) {
    super(cli, "debug", "développement, débogueur ouvert dans le serveur");
  }

  protected override defaultInspect(): IDevInspectRequest {
    return { host: "127.0.0.1", port: 9229, wait: false };
  }

  protected override onInspectorOpened(url: string): void {
    const port = new URL(url).port;
    process.stderr.write(
      `[debug] débogueur prêt sur le port ${port} — chrome://inspect, ou ` +
        `« Attach » dans l'éditeur (VS Code : « Debug: Attach to Node Process »). ` +
        `Les points d'arrêt se posent dans les .ts.\n`,
    );
  }
}

export default Debug;
