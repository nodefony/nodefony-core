/**
 * @nodefony/test-frontend-angular — module POC consumer du @nodefony/frontend.
 *
 * Valide le preset `angular` (Angular 21 standalone via `@analogjs/vite-plugin-angular`)
 * sous le MÊME superviseur Vite que les bundles React 19 + Vue 3.
 */
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import config from "./nodefony/config/config";
import AngularController from "./nodefony/controller/AngularController";

@controllers([AngularController])
class TestFrontendAngular extends Module {
  /** Module de démo optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  constructor(kernel: Kernel) {
    super("test-frontend-angular", kernel, import.meta.url, config);
  }

  /**
   * Enregistre la déclaration frontend Angular auprès du FrontendService.
   * Module chargé APRÈS `@nodefony/frontend` (ordre @modules racine).
   */
  override async onKernelBoot(): Promise<this> {
    const svc = this.kernel?.container?.get("frontend") as
      FrontendService | undefined;
    if (!svc) {
      this.log(
        "@nodefony/frontend service not registered — is the module loaded before this one?",
        "ERROR",
      );
      return this;
    }
    svc.registerEntry(this, {
      type: "angular",
      entry: "./frontend/src/main.ts",
      root: "./frontend",
      outDir: "./public/dist",
      name: "test-frontend-angular",
      // fetch("/angular/api/data") depuis l'app Angular servie par Vite → proxy backend.
      apiProxyPaths: ["/angular/api"],
    });
    return this;
  }
}

export default TestFrontendAngular;
