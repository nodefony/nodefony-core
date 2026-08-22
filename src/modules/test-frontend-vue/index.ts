/**
 * @nodefony/test-frontend-vue — module POC consumer du @nodefony/frontend.
 *
 * Valide le multi-framework Vite : un bundle Vue 3 cohabite avec les bundles
 * React 19 sous le MÊME superviseur Vite (process séparé). Aucune logique
 * métier — uniquement la validation du preset `vue3`.
 */
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import config from "./nodefony/config/config";
import VueController from "./nodefony/controller/VueController";

@controllers([VueController])
class TestFrontendVue extends Module {
  /** Module de démo optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  constructor(kernel: Kernel) {
    super("test-frontend-vue", kernel, import.meta.url, config);
  }

  /**
   * Enregistre la déclaration frontend Vue auprès du FrontendService.
   * Doit être fait AVANT `onKernelReady` pour que le superviseur Vite démarre
   * avec cette entry. Module chargé APRÈS `@nodefony/frontend` (ordre @modules).
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
      type: "vue3",
      entry: "./frontend/src/main.ts",
      root: "./frontend",
      outDir: "./public/dist",
      name: "test-frontend-vue",
      // Sans ça, fetch("/vue/api/data") depuis l'app servie par Vite tape
      // Vite (SPA-fallback HTML) → erreur JSON dans le browser.
      apiProxyPaths: ["/vue/api"],
    });
    return this;
  }
}

export default TestFrontendVue;
