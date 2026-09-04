import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import type FrontendService from "../service/FrontendService";

const options: OptionsCommandInterface = {
  helpGroup: "FRONT ET RÉSEAU",
  showBanner: false,
  kernelEvent: "onReady",
};

/**
 * `nodefony frontend:status` — lit l'état du superviseur Vite.
 *
 * Utilisé par Vision (Phase 10) pour afficher l'état du builder dans
 * son tableau de bord admin.
 */
class FrontendStatus extends Command {
  constructor(cli: CliKernel) {
    super("frontend:status", "l'état du superviseur des fronts", cli, options);
    this.addOption("-j, --json", "output as JSON");
  }

  override async generate(
    _arg: string,
    opts: { json: boolean },
  ): Promise<this> {
    const svc = this.kernel?.container?.get("frontend") as
      FrontendService | undefined;
    if (!svc) {
      this.log("service `frontend` not registered", "ERROR");
      return this;
    }
    const st = svc.status();
    if (opts.json) {
      process.stdout.write(JSON.stringify(st, null, 2) + "\n");
    } else {
      console.log(`state    : ${st.state}`);
      console.log(`endpoint : ${st.host}:${st.port}`);
      // Origine PUBLIQUE (P14.17) — celle que le navigateur utilise. Affichée
      // seulement quand elle diffère de l'endpoint d'écoute (dev déporté).
      if (st.origin && !st.origin.endsWith(`://${st.host}:${st.port}`)) {
        console.log(`public   : ${st.origin}`);
      }
      console.log(`pid      : ${st.pid ?? "-"}`);
      console.log(`entries  : ${st.entries.length}`);
      for (const e of st.entries) {
        console.log(`  · ${e.entryName} [${e.type}] ${e.entryFile}`);
      }
      if (st.lastError) console.log(`error    : ${st.lastError}`);
    }
    return this;
  }
}

export default FrontendStatus;
