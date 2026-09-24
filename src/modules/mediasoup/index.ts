/**
 * `@nodefony/mediasoup` — module applicatif (banc test ORM).
 *
 * Deux choses, **aucune logique métier ni front** :
 *  1. enregistre le **build Vue 3** auprès du `FrontendService` (page servie, front à implémenter) ;
 *  2. déclare le modèle `nodefony/entity/schema.ts` sur le connecteur Drizzle
 *     `mediasoup` → visible comme **ERD distinct** dans Studio.
 *
 * Le connecteur n'est PAS ouvert ici : il est DÉCLARÉ par l'application
 * (`nodefony/config/drizzle.ts`, `:memory:`, hors production), et c'est
 * `DrizzleService` qui l'ouvre et le ferme. Ouvert dans le code, il restait
 * invisible à tout ce qui lit la configuration sans démarrer — `create
 * entity`, la page « Créer », `orm:migrate`, `nodefony doctor`.
 *
 * Chargé APRÈS `@nodefony/frontend` (ordre `@modules` racine) pour que le service Vite existe.
 */
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import { entities } from "@nodefony/orm-core";
import config from "./nodefony/config/config";
import MediasoupController from "./nodefony/controller/MediasoupController";
import {
  MEDIASOUP_CONNECTOR,
  mediasoupEntities,
} from "./nodefony/entity/schema";

@entities(mediasoupEntities, { connector: MEDIASOUP_CONNECTOR })
@controllers([MediasoupController])
class Mediasoup extends Module {
  /** Module optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  constructor(kernel: Kernel) {
    super("mediasoup", kernel, import.meta.url, config);
  }

  /** Boot : déclare le bundle Vue au superviseur Vite. */
  override async onKernelBoot(): Promise<this> {
    // 1) Frontend Vue (build prêt — pas de code front dans ce module).
    const svc = this.kernel?.container?.get("frontend") as
      FrontendService | undefined;
    if (svc) {
      svc.registerEntry(this, {
        type: "vue3",
        entry: "./frontend/src/main.ts",
        root: "./frontend",
        outDir: "./public/dist",
        name: "mediasoup",
        // Sans ça, fetch("/mediasoup/api/...") tombe sur le SPA-fallback HTML de Vite.
        apiProxyPaths: ["/mediasoup/api"],
      });
    } else {
      this.log(
        "@nodefony/frontend service indisponible — ordre @modules ? (frontend AVANT mediasoup)",
        "ERROR",
      );
    }

    return this;
  }
}

export default Mediasoup;
