/**
 * @nodefony/test-frontend-react — module POC consumer du @nodefony/frontend.
 *
 * Branche `poc/frontend-child` : valide la performance backend pendant
 * que Vite compile dans un process séparé.
 */
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import config from "./nodefony/config/config";
import PocController from "./nodefony/controller/PocController";

@controllers([PocController])
class TestFrontendReact extends Module {
  /** Module de démo optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  constructor(kernel: Kernel) {
    super("test-frontend-react", kernel, import.meta.url, config);
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
      name: "test-frontend-react",
      // Sans ça, fetch("/react/api/data") depuis l'app servie par Vite tape
      // Vite (qui retourne son SPA-fallback HTML) → erreur JSON dans le browser.
      apiProxyPaths: ["/react/api"],
    });
    return this;
  }
}

export default TestFrontendReact;
