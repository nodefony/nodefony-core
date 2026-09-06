import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import type FrontendService from "../service/FrontendService";

const options: OptionsCommandInterface = {
  helpGroup: "FRONT ET RÉSEAU",
  showBanner: false,
  kernelEvent: "onReady",
};

/**
 * `nodefony frontend:dev` — démarre manuellement le superviseur Vite.
 *
 * Utile quand `autoStartInDevelopment: false` dans la config, ou pour
 * relancer le superviseur Vite manuellement.
 */
class FrontendDev extends Command {
  constructor(cli: CliKernel) {
    super("frontend:dev", "démarre le serveur Vite à la main", cli, options);
  }

  override async generate(): Promise<this> {
    const svc = this.kernel?.container?.get("frontend") as
      FrontendService | undefined;
    if (!svc) {
      this.log("service `frontend` not registered", "ERROR");
      return this;
    }
    await svc.startDev();
    const st = svc.status();
    this.log(`vite dev server: ${st.host}:${st.port} [${st.state}]`, "INFO");
    return this;
  }
}

export default FrontendDev;
