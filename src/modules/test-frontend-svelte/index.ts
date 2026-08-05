/**
 * @nodefony/test-frontend-svelte — module POC consumer du @nodefony/frontend.
 *
 * Valide le multi-framework Vite : un bundle Svelte 5 cohabite avec les bundles
 * React 19 et Vue 3 sous le MÊME superviseur Vite (famille `default`, extensions
 * `.svelte` disjointes). Aucune logique métier — uniquement la validation du
 * preset `svelte5`.
 */
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import config from "./nodefony/config/config";
import SvelteController from "./nodefony/controller/SvelteController";

@controllers([SvelteController])
class TestFrontendSvelte extends Module {
  /** Module de démo optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  constructor(kernel: Kernel) {
    super("test-frontend-svelte", kernel, import.meta.url, config);
  }

  /**
   * Enregistre la déclaration frontend Svelte auprès du FrontendService.
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
      type: "svelte5",
      entry: "./frontend/src/main.ts",
      root: "./frontend",
      outDir: "./public/dist",
      name: "test-frontend-svelte",
      // Sans ça, fetch("/svelte/api/data") depuis l'app servie par Vite tape
      // Vite (SPA-fallback HTML) → erreur JSON dans le browser.
      apiProxyPaths: ["/svelte/api"],
    });
    return this;
  }
}

export default TestFrontendSvelte;
