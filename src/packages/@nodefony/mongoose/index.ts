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
import {
  registerMongooseFrameworkStores,
  FRAMEWORK_ORM,
} from "./nodefony/registerStores";
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

  /** JSON Schema de la config mongoose → data plane admin (config riche Studio). */
  override configSchema(): unknown {
    return mongooseConfigJsonSchema();
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

    // AUTO-REGISTER du schéma framework (tokens/webauthn/webhooks) sur le
    // connecteur `nodefony` + fabriques "mongoose" dans les registres security —
    // AVANT le connect de `onBoot`. Zéro câblage app ; guards = l'app garde la
    // main ; `frameworkEntities: false` = module data-only. Couverture partielle
    // assumée (pas d'audit/idempotence mongoose — sélection = échec franc).
    if (validated.frameworkEntities !== false) {
      const report = registerMongooseFrameworkStores();
      if (report.appOwned.length) {
        this.log(
          `schéma framework : entités déjà enregistrées par l'app ` +
            `[${report.appOwned.join(", ")}] — auto-register respecte l'app`,
          "DEBUG",
        );
      }
      if (report.registered.length) {
        this.log(
          `schéma framework déclaré sur "${FRAMEWORK_ORM}" : ` +
            `[${report.registered.join(", ")}]`,
          "DEBUG",
        );
      }
    }
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
// AUTO-REGISTER (onKernelRegister) : entité + fabrique "mongoose" déclarées par le
// module — sélectionnable via `tokenStore.driver: "mongoose"`, zéro câblage app.
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

// ─── Store de credentials WebAuthn Mongoose (IWebAuthnCredentialStore, J9) ────
// AUTO-REGISTER (onKernelRegister) : sélectionnable via `passkeys.store: "mongoose"`.
export {
  webAuthnCredentialSchema,
  createWebAuthnCredentialEntity,
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "./nodefony/entity/webAuthnCredentialEntity";
export type { WebAuthnCredentialRow } from "./nodefony/entity/webAuthnCredentialEntity";
export { MongooseWebAuthnCredentialStore } from "./nodefony/src/MongooseWebAuthnCredentialStore";

// ─── Store d'endpoints webhook Mongoose (IWebhookStore de @nodefony/security, P6.13) ─
// AUTO-REGISTER (onKernelRegister) : sélectionnable via `webhooks.store: "mongoose"`.
export {
  webhookEndpointSchema,
  createWebhookEndpointEntity,
  registerWebhookEndpointEntity,
  WEBHOOK_ENDPOINT_ENTITY,
} from "./nodefony/entity/webhookEndpointEntity";
export type { WebhookEndpointRow } from "./nodefony/entity/webhookEndpointEntity";
export { MongooseWebhookStore } from "./nodefony/src/MongooseWebhookStore";

// ─── Auto-register du schéma framework (appelé par onKernelRegister) ─────────
// Exporté pour les tests et les apps avancées (rejouable : guards idempotents).
export {
  registerMongooseFrameworkStores,
  FRAMEWORK_ORM,
} from "./nodefony/registerStores";
export type { IFrameworkStoresReport } from "./nodefony/registerStores";
