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
import { Kernel, Module, services, registerErrorAdapter } from "nodefony";
import { wireOrmAdminPlane } from "@nodefony/orm-core";
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
   * Monte le data plane ORM (`/nodefony/orm/api/*` + providers santé/flux) via
   * {@link wireOrmAdminPlane} — branchement GLOBAL et idempotent factorisé en
   * orm-core (C5), identique à Drizzle. Avant la factorisation, ce wiring était
   * déclenché par le seul module Drizzle → une app Mongoose-only avait un Studio
   * ORM muet ; chaque driver l'invoque désormais. En plus, enregistre l'adapter
   * d'erreurs Mongoose (spécifique au driver, hors plan d'administration).
   */
  override async onKernelBoot(): Promise<this> {
    wireOrmAdminPlane(this.kernel);
    // Détection/format des erreurs Mongoose dans `nodefonyError` (core découplé) :
    // s'enregistre sous la clé "mongoose" dans le registre générique d'adapters.
    registerErrorAdapter("mongoose", {
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

// ─── Adapter User Mongoose (contrat @nodefony/user — P5.8) ──────────────────
// Entité (schéma) dans entity/, couche d'accès (repository) dans src/.
export {
  userSchema,
  createUserEntity,
  registerUserEntity,
} from "./nodefony/entity/userEntity";
export type { UserRow } from "./nodefony/entity/userEntity";
export { MongooseUserRepository } from "./nodefony/src/MongooseUserRepository";

// ─── Store de jetons Mongoose (contrat ITokenStore de @nodefony/security, J4b) ─
// Approche B : `@nodefony/security` en `import type` (0 dép runtime). PAS d'auto-
// register — l'app câble `registerTokenStore` + `registerTokenEntities(orm)`.
export {
  accessTokenSchema,
  deniedJtiSchema,
  subjectRevocationSchema,
  createTokenEntities,
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "./nodefony/entity/tokenEntity";
export type {
  DeniedJtiRow,
  SubjectRevocationRow,
} from "./nodefony/entity/tokenEntity";
export { MongooseTokenStore } from "./nodefony/src/MongooseTokenStore";
