/**
 * @nodefony/studio — admin web Nodefony.
 *
 * Successeur du legacy `monitoring-bundle`. Frontend React 19 via @nodefony/frontend.
 *
 * Routing — le namespace `/nodefony` est réservé au framework (jamais une app user, à
 * l'inverse d'un `/studio` qui entrerait en collision). On partitionne DANS `/nodefony` :
 *  - UI SPA Studio (humain)   : `/nodefony` + `/nodefony/{page}` (mono-segment).
 *    Portées par CE module uniquement → disparaissent si Studio n'est pas chargé,
 *    sans casser le boot du framework.
 *  - Data plane admin (machine) : `/nodefony/<module>/api/*` (≥3 segments) — porté par
 *    chaque module, vit indépendamment de Studio. Studio n'en est qu'un consommateur web.
 */
import path from "node:path";
import { Kernel, Module, services } from "nodefony";
import { controllers } from "@nodefony/framework";
import { resolveUiDelivery, PrebuiltUi } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";
import defaultConfig from "./nodefony/config/config";
import {
  defineStudioConfig,
  studioConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";
import type {
  IStudioConfig,
  IStudioConfigInput,
} from "./nodefony/interfaces/IStudioConfig";
import StudioController from "./nodefony/controller/StudioController";
import StudioRealtimeController from "./nodefony/controller/StudioRealtimeController";
import StudioCreateController from "./nodefony/controller/StudioCreateController";
import ScaffoldService from "./nodefony/service/ScaffoldService";

// Le data plane de documentation est désormais porté par le module dédié
// @nodefony/documentation (`/nodefony/documentation/api/*`). L'ancien
// DocumentationController POC du Studio a été retiré (suppression franche) —
// Studio n'en garde que le FRONTEND (page React consommant ce data plane).
// Le service `scaffold` est enregistré en TOUT environnement (le DI n'a pas à connaître
// l'env), mais il se refuse lui-même hors développement — et le controller comme les
// actions temps réel s'appuient sur ce refus. Garder l'enregistrement inconditionnel
// évite un "service introuvable" opaque là où on veut un 403 explicite.
// Augmente le registre de config des modules → `use("@nodefony/studio", { … })`
// propose les clés typées en complétion, et REFUSE une clé inconnue. Sans cette
// déclaration, `use()` retombe sur `Record<string, unknown>` : une clé mal
// orthographiée est retirée par Zod au boot, sans un mot.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/studio": IStudioConfigInput;
  }
}

@services([ScaffoldService])
@controllers([
  StudioController,
  StudioRealtimeController,
  StudioCreateController,
])
class Studio extends Module<IStudioConfig> {
  /** Module optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  /**
   * Livraison statique de l'UI (mode `static`) — `null` en mode `vite`/`none`.
   * Lu par `StudioController.renderStudio` via `kernel.getModule("studio")`.
   */
  ui: PrebuiltUi | null = null;

  constructor(kernel: Kernel) {
    super("studio", kernel, import.meta.url, defaultConfig);
  }

  /** JSON Schema de la config Studio → data plane admin (config riche). */
  override configSchema(): unknown {
    return studioConfigJsonSchema();
  }

  /**
   * Valide la config (défauts + `module.options` de `use("@nodefony/studio", …)`)
   * au boot, AVANT `onKernelBoot` qui lit `this.options.ui`.
   *
   * `this.options` est FLAT : le Kernel deep-merge la config de l'app
   * directement dans les options du module — pas sous une clé `.studio`.
   */
  override async onKernelRegister(): Promise<this> {
    this.options = defineStudioConfig(
      (this.options as IStudioConfigInput) ?? {},
    );
    return this;
  }

  /**
   * Branche la livraison de l'UI selon la molette `ui` (config module) :
   * - `vite`   → `registerEntry` auprès du FrontendService (HMR dev).
   * - `static` → assets pré-buildés `dist/frontend/` (produits au publish,
   *              shippés npm) servis par `PrebuiltUi` (@nodefony/http) —
   *              AUCUNE dépendance à Vite ni à @nodefony/frontend.
   * Doit être fait AVANT `onKernelReady` (le superviseur Vite démarre avec
   * ses entries ; le mount statique doit précéder les premières requêtes).
   */
  override async onKernelBoot(): Promise<this> {
    const resolution = resolveUiDelivery({
      requested: this.options.ui,
      environment: this.kernel?.environment,
      hasFrontendService: !!this.kernel?.container?.get("frontend"),
      sourcesDir: path.join(this.path, "frontend", "src"),
      distIndex: path.join(this.path, "dist", "frontend", "index.html"),
    });
    this.log(
      `studio UI delivery: ${resolution.mode} — ${resolution.reason}`,
      "INFO",
    );

    if (resolution.mode === "static") {
      this.ui = new PrebuiltUi({
        publicPath: "/_assets/studio/",
        distDir: path.join(this.path, "dist", "frontend"),
      });
      if (!this.ui.mount(this.kernel?.container, this.kernel)) {
        this.log(
          "server-static unavailable at boot — static mount deferred to onReady",
          "WARNING",
        );
      }
      return this;
    }
    if (resolution.mode === "none") {
      this.log(`studio UI unavailable: ${resolution.reason}`, "ERROR");
      return this;
    }

    // mode "vite" — HMR dev (repo self-hosted / contrib).
    const svc = this.kernel?.container?.get("frontend") as FrontendService;
    svc.registerEntry(this, {
      type: "react19",
      entry: "./frontend/src/main.tsx",
      root: "./frontend",
      outDir: "./public/dist",
      name: "studio",
      // Sans ça, fetch("/nodefony/<module>/api/...") depuis l'app servie par Vite
      // tape Vite (qui retourne son SPA-fallback HTML) → erreur JSON. On proxifie
      // TOUT le data plane admin `/nodefony/<module>/api/*` (studio + kernel + http
      // + framework + syslog + futurs producteurs) via une **clé RegExp Vite**
      // (`^…` = traité comme RegExp par Vite). Couvre ≥3 segments avec `/api/`
      // donc les pages SPA mono-segment `/nodefony/{page}` et la racine `/nodefony`
      // restent servies par Vite. `ws:true` (déjà posé) garde le WS realtime proxifié.
      apiProxyPaths: ["^/nodefony/[^/]+/api"],
    });
    return this;
  }
}

export default Studio;

// Surface publique de configuration — sans elle, le type d'entrée du registre
// n'est pas joignable depuis une application, et la parade qui charge cette
// augmentation (`/// <reference types="@nodefony/studio" />`) n'a rien à viser.
export { defineStudioConfig, studioConfigJsonSchema };
export {
  studioConfigSchema,
  type StudioConfig,
} from "./nodefony/config/config";
export type {
  IStudioConfig,
  IStudioConfigInput,
} from "./nodefony/interfaces/IStudioConfig";
