/**
 * `@nodefony/mongoose` — module Mongoose ORM (driver NoSQL) sur `@nodefony/orm-core`.
 *
 * **Module bootable** : enregistré dans le manifeste `modules`, son
 * {@link MongooseService} connecte au boot un {@link MongooseOrm} par connecteur
 * configuré. Refonte 2026-06-08 (Ph.2 virage ORM) : ne dérive plus de l'`Orm`
 * legacy du core — le service `extends Service` et orchestre des adapters
 * orm-core autonomes (modèle `DrizzleService`). Le core ne connaît plus l'ORM.
 */
import mongoose from "mongoose";
import {
  Kernel,
  Module,
  services,
  registerMongooseAdapter,
  setOrmHealthProvider,
  setOrmRichProvider,
} from "nodefony";
import type { IAdminRegistry } from "nodefony";
import {
  registerOrmAdminApi,
  buildOrmLeanHealth,
  buildConnectionHealth,
  buildOrmFlow,
} from "@nodefony/orm-core";
import config from "./nodefony/config/config";
import MongooseService from "./nodefony/service/MongooseService";

@services([MongooseService])
class Mongoose extends Module {
  constructor(kernel: Kernel) {
    super("mongoose", kernel, import.meta.url, config);
  }

  /**
   * Monte le data plane ORM (`/nodefony/orm/api/*`) + branche les providers de
   * santé/diagnostic et l'adapter d'erreurs Mongoose dans le core.
   *
   * Idempotent + lit les registres GLOBAUX → couvre tous les ORM présents (pas
   * seulement Mongoose) ; un app Mongoose-only n'a donc plus un Studio ORM muet
   * (le wiring était jusqu'ici déclenché par le seul module Drizzle — dette C5).
   * La factorisation en `wireOrmAdminPlane(kernel)` reste prévue en Ph.4.
   */
  override async onKernelBoot(): Promise<this> {
    const broker = this.kernel?.container?.get("adminBroker") as
      | IAdminRegistry
      | undefined;
    if (broker) {
      registerOrmAdminApi(broker);
    }
    // Santé ORM lean (report sonde cluster) + diagnostic riche (drill ORM).
    // Fonctions GLOBALES (itèrent `ormRegistry`) → couvrent tous les ORM ;
    // idempotentes. Seams core → 0 dépendance framework→orm-core.
    setOrmHealthProvider(buildOrmLeanHealth);
    setOrmRichProvider(async () => ({
      health: await buildConnectionHealth(),
      flow: buildOrmFlow(),
    }));
    // Détection/format des erreurs Mongoose dans `nodefonyError` (core découplé) :
    // jusqu'ici dormant (aucun appelant) → activé par la refonte.
    registerMongooseAdapter({
      isError: (e: Error): boolean => e instanceof mongoose.Error,
      errorToString: (e: unknown): string => String((e as Error)?.message ?? e),
    });
    return this;
  }
}

export default Mongoose;
export { mongoose, MongooseService };
export type {
  MongooseConnectorConfig,
  MongooseModuleConfig,
} from "./nodefony/config/config";

// ─── Stockage de session Mongoose (consommé par @nodefony/http) ─────────────
// L'import de l'entité exécute son décorateur `@entity` → modèle compilé au boot.
export { default as SessionStorage } from "./nodefony/src/SessionStorage";
export {
  default as SessionEntity,
  sessionSchema,
  SESSION_ORM,
} from "./nodefony/entity/sessionEntity";
export type { SessionRow } from "./nodefony/entity/sessionEntity";

// ─── Classes adapter orm-core (usage direct / banc-test) ────────────────────
export {
  MongooseOrm,
  MongooseRepository,
  MongooseTransaction,
} from "./nodefony/src/orm-core/index";
