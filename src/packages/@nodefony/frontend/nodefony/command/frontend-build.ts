import {
  OptionsCommandInterface,
  CliKernel,
  Command,
} from "nodefony";
import type FrontendService from "../service/FrontendService";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onReady",
};

/**
 * `nodefony frontend:build` — build production de tous les frontends
 * déclarés par les modules.
 *
 * Lit le manifest généré dans `outDir`, à exposer ensuite par `server-static`.
 */
class FrontendBuild extends Command {
  constructor(cli: CliKernel) {
    super("frontend:build", "Build production frontends (Vite)", cli, options);
  }

  override async generate(): Promise<this> {
    const container = this.kernel?.container;
    if (!container) {
      this.log("kernel container unavailable", "ERROR");
      return this;
    }
    const svc = container.get("frontend") as FrontendService | undefined;
    if (!svc) {
      this.log(
        "service `frontend` not registered — is @nodefony/frontend loaded?",
        "ERROR",
      );
      return this;
    }
    if (svc.listEntries().length === 0) {
      this.log("no frontend entries declared", "WARNING");
      return this;
    }
    this.log(`building ${svc.listEntries().length} entry(ies)…`, "INFO");
    await svc.build();
    this.log("done", "INFO");
    return this;
  }
}

export default FrontendBuild;
