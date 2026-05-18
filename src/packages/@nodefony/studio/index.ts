/**
 * @nodefony/studio — admin web Nodefony.
 *
 * Successeur du legacy `monitoring-bundle`. Frontend React 19 via @nodefony/frontend.
 * Route racine : `/studio` (la route `/nodefony` reste réservée pour les API admin
 * exposées par chaque module via `IAdminApi`).
 */
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import config from "./nodefony/config/config";
import StudioController from "./nodefony/controller/StudioController";

@controllers([StudioController])
class Studio extends Module {
  constructor(kernel: Kernel) {
    super("studio", kernel, import.meta.url, config);
  }

  /**
   * Enregistre la déclaration frontend auprès du FrontendService.
   * Doit être fait AVANT `onKernelReady` pour que le superviseur Vite démarre
   * avec cette entry.
   */
  override async onKernelBoot(): Promise<this> {
    const svc = this.kernel?.container?.get("frontend") as
      | FrontendService
      | undefined;
    if (!svc) {
      this.log(
        "@nodefony/frontend service not registered — is the module loaded before this one?",
        "ERROR",
      );
      return this;
    }
    svc.registerEntry(this, {
      type: "react19",
      entry: "./frontend/src/main.tsx",
      root: "./frontend",
      outDir: "./public/dist",
      name: "studio",
      // Sans ça, fetch("/studio/api/...") depuis l'app servie par Vite tape
      // Vite (qui retourne son SPA-fallback HTML) → erreur JSON dans le browser.
      apiProxyPaths: ["/nodefony/api"],
    });
    return this;
  }
}

export default Studio;
