/**
 * `@nodefony/mediasoup` — module applicatif (banc test ORM).
 *
 * Deux choses, **aucune logique métier ni front** :
 *  1. enregistre le **build Vue 3** auprès du `FrontendService` (page servie, front à implémenter) ;
 *  2. monte un **connecteur Drizzle dédié `mediasoup`** (`:memory:`) avec le modèle
 *     `nodefony/entity/schema.ts` → visible comme **ERD distinct** dans Studio.
 *
 * Chargé APRÈS `@nodefony/frontend` (ordre `@modules` racine) pour que le service Vite existe.
 */
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import { DrizzleOrm } from "@nodefony/drizzle";
import config from "./nodefony/config/config";
import MediasoupController from "./nodefony/controller/MediasoupController";
import { registerMediasoupEntities } from "./nodefony/entity/schema";

/** Nom du connecteur Drizzle propre au module (clé `ormRegistry`). */
const ORM = "mediasoup";

@controllers([MediasoupController])
class Mediasoup extends Module {
  /** Module optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  /** Connecteur Drizzle dédié, fermé à `onTerminate`. */
  #orm: DrizzleOrm | null = null;

  constructor(kernel: Kernel) {
    super("mediasoup", kernel, import.meta.url, config);
  }

  /**
   * Boot : (1) déclare le bundle Vue au superviseur Vite ; (2) enregistre les
   * entités puis ouvre le connecteur Drizzle `mediasoup`. La fermeture est câblée
   * sur `onTerminate` du kernel (pas de hook `onKernelTerminate` côté Module).
   */
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

    // 2) Connecteur Drizzle dédié : entités AVANT connect (résolution des relations au connect).
    registerMediasoupEntities(ORM);
    const orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    this.#orm = orm;
    this.log(
      `Drizzle ORM "${ORM}" connecté (banc mediasoup, :memory:)`,
      "INFO",
    );

    this.kernel?.once("onTerminate", async () => {
      await this.#orm?.disconnect().catch(() => undefined);
      this.#orm = null;
    });
    return this;
  }
}

export default Mediasoup;
