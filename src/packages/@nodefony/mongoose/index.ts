/**
 * `@nodefony/mongoose` — module Mongoose ORM (driver NoSQL) sur `@nodefony/orm-core`.
 *
 * **Module bootable** : enregistré dans le manifeste `modules`, son
 * {@link MongooseService} connecte au boot un {@link MongooseOrm} par connecteur
 * configuré. Refonte 2026-06-08 (Ph.2 virage ORM) : ne dérive plus de l'`Orm`
 * legacy du core — le service `extends Service` et orchestre des adapters
 * orm-core autonomes (modèle `DrizzleService`). Le core ne connaît plus l'ORM.
 *
 * Config = source de vérité Zod (`nodefony/config/schema.ts`), validée au boot
 * via {@link defineMongooseConfig} (style `@nodefony/redis`/`@nodefony/realtime`).
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
import {
  defineMongooseConfig,
  mongooseConfigJsonSchema,
} from "./nodefony/config/defineMongooseConfig";
import MongooseService from "./nodefony/service/MongooseService";
import type {
  IMongooseConfig,
  IMongooseConfigInput,
} from "./nodefony/interfaces/IMongooseConfig";

// Augmente le registre du core (declaration merging) pour que
// `use("@nodefony/mongoose", …)` auto-complète les clés typées du module.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/mongoose": IMongooseConfigInput;
  }
}

@services([MongooseService])
class Mongoose extends Module {
  /**
   * Module **optionnel** (driver NoSQL externe, opt-in) : un échec de son boot
   * (Mongo injoignable) ne tue jamais le process — le store de session dégrade
   * gracieusement (`#repo()` → null). Résilience cloud-native (l'orchestrateur
   * relèvera Mongo). Convention-frère `@nodefony/redis`.
   */
  static override critical = false;

  constructor(kernel: Kernel) {
    super("mongoose", kernel, import.meta.url, config);
  }

  /**
   * Valide la config (défauts + `module.options` + surcharge env) au boot via
   * `defineMongooseConfig`, et l'expose au container sous `mongooseConfig` pour
   * que le `MongooseService` la consomme sans redupliquer la validation. Plante
   * propre avec messages clairs si la config est invalide (convention Zod).
   */
  override async onKernelRegister(): Promise<this> {
    let validated: IMongooseConfig;
    try {
      validated = defineMongooseConfig(
        (this.options ?? {}) as IMongooseConfigInput,
      );
    } catch (e) {
      const issues =
        e instanceof Error && "issues" in e && Array.isArray(e.issues)
          ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join(" · ")
          : (e as Error).message;
      throw new Error(`[@nodefony/mongoose] Invalid config: ${issues}`);
    }
    this.set("mongooseConfig", validated);
    return this;
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
export { defineMongooseConfig, mongooseConfigJsonSchema };
export {
  mongooseConfigSchema,
  type MongooseConfig,
} from "./nodefony/config/schema";
export type {
  IMongooseConfig,
  IMongooseConfigInput,
  IMongooseConnectorConfig,
} from "./nodefony/interfaces/IMongooseConfig";

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
