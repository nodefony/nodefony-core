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
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import config from "./nodefony/config/config";
import StudioController from "./nodefony/controller/StudioController";
import StudioRealtimeController from "./nodefony/controller/StudioRealtimeController";

@controllers([StudioController, StudioRealtimeController])
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
      // Sans ça, fetch("/nodefony/studio/api/...") depuis l'app servie par Vite
      // tape Vite (qui retourne son SPA-fallback HTML) → erreur JSON. On proxifie
      // UNIQUEMENT le préfixe API : les pages SPA `/nodefony/{page}` restent servies
      // par Vite (prefix-match Vite proxy → ne capte pas la racine `/nodefony`).
      apiProxyPaths: ["/nodefony/studio/api"],
    });
    return this;
  }
}

export default Studio;
