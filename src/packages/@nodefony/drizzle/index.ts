/**
 * `@nodefony/drizzle` — module Drizzle ORM (driver `better-sqlite3`) sur
 * `@nodefony/orm-core`.
 *
 * **Module bootable** : enregistré dans `@modules()`, son {@link DrizzleService}
 * connecte au boot un {@link DrizzleOrm} par connecteur configuré (ORM par défaut
 * SQL recommandé). Expose aussi les **classes adapter** (orm-core) pour un usage
 * direct/banc-test. driver concret du socle multi-ORM (avec Mongoose) ; type-safe-first (a figé la forme des opérateurs riches, ADR-0003 #3).
 */
import { Kernel, Module, services } from "nodefony";
import { wireOrmAdminPlane } from "@nodefony/orm-core";
import { registerUserStore } from "@nodefony/user";
import config from "./nodefony/config/config";
import {
  defineDrizzleConfig,
  drizzleConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";
import DrizzleService from "./nodefony/service/DrizzleService";
import {
  registerDrizzleFrameworkStores,
  FRAMEWORK_ORM,
} from "./nodefony/registerStores";
import type {
  IDrizzleConfig,
  IDrizzleConfigInput,
} from "./nodefony/interfaces/IDrizzleConfig";

// Augmente le registre du core (declaration merging) → `use("@nodefony/drizzle", …)` typé.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/drizzle": IDrizzleConfigInput;
  }
}

@services([DrizzleService])
class Drizzle extends Module<IDrizzleConfig> {
  constructor(kernel: Kernel) {
    super("drizzle", kernel, import.meta.url, config);
  }

  /** JSON Schema de la config drizzle → data plane admin (config riche Studio). */
  override configSchema(): unknown {
    return drizzleConfigJsonSchema();
  }

  /**
   * Valide la config (défauts + `module.options` + surcharge env) au boot via
   * `defineDrizzleConfig`, et l'expose au container sous `drizzleConfig` pour que
   * le `DrizzleService` la consomme. Plante propre si la config est invalide
   * (convention Zod, alignée sur `@nodefony/mongoose` — audit config ORM 2026-06).
   */
  override async onKernelRegister(): Promise<this> {
    let validated: IDrizzleConfig;
    try {
      validated = defineDrizzleConfig(
        (this.options ?? {}) as IDrizzleConfigInput,
      );
    } catch (e) {
      const issues =
        e instanceof Error && "issues" in e && Array.isArray(e.issues)
          ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join(" · ")
          : (e as Error).message;
      throw new Error(`[@nodefony/drizzle] Invalid config: ${issues}`);
    }
    // Config validée exposée via this.options → `this.config` (accès uniforme
    // typé). Le DrizzleService la lit sur son module (`this.module.config`).
    this.options = validated;

    // Déclare "drizzle" comme backend de persistance user DISPONIBLE (DrizzleUserRepository)
    // → l'écran Studio « Stores » liste le user comme les autres briques. Toujours (l'app
    // le SÉLECTIONNE via NF_USER_STORE), indépendant de `frameworkEntities`.
    registerUserStore("drizzle");

    // AUTO-REGISTER du schéma framework (tokens/audit/webauthn/webhooks/
    // idempotence) sur le connecteur `default` + fabriques de stores dans les
    // registres security/framework — AVANT le connect de `onBoot` (tables créées
    // à la connexion). L'app n'écrit plus aucun `registerXStore` ; elle garde la
    // main via les guards (entité/fabrique déjà posées = respectées) ou coupe
    // tout avec `frameworkEntities: false` (module data-only).
    if (validated.frameworkEntities !== false) {
      const dialect = validated.connectors?.default?.dialect ?? "sqlite";
      const report = registerDrizzleFrameworkStores(dialect);
      if (report.unported.length) {
        this.log(
          `schéma framework : entités non portées sur "${dialect}" → stores ` +
            `drizzle indisponibles pour [${report.unported.join(", ")}] ` +
            `(chantier multi-dialecte Ph.2.1)`,
          "WARNING",
        );
      }
      if (report.appOwned.length) {
        this.log(
          `schéma framework : entités déjà enregistrées par l'app ` +
            `[${report.appOwned.join(", ")}] — auto-register respecte l'app`,
          "DEBUG",
        );
      }
      if (report.registered.length) {
        this.log(
          `schéma framework déclaré sur "${FRAMEWORK_ORM}" (${dialect}) : ` +
            `[${report.registered.join(", ")}]`,
          "DEBUG",
        );
      }
    }
    return this;
  }

  /**
   * Monte le data plane ORM (`/nodefony/orm/api/*` + providers santé/flux pour la
   * sonde cluster et le drill Studio) via {@link wireOrmAdminPlane}. Branchement
   * GLOBAL (couvre tous les ORM) et idempotent — factorisé en orm-core (C5), chaque
   * driver l'invoque à l'identique. orm-core étant une lib pure, c'est un module
   * driver qui le déclenche (avant le `mountAll` de framework à `onKernelReady`).
   */
  override async onKernelBoot(): Promise<this> {
    wireOrmAdminPlane(this.kernel);
    return this;
  }
}

export default Drizzle;
export { DrizzleService };
export { defineDrizzleConfig, drizzleConfigJsonSchema };
export {
  drizzleConfigSchema,
  type DrizzleConfig,
} from "./nodefony/config/config";
export type {
  IDrizzleConfig,
  IDrizzleConfigInput,
  IDrizzleConnectorConfig,
} from "./nodefony/interfaces/IDrizzleConfig";

// ─── Stockage de session Drizzle (consommé par @nodefony/http) ──────────────
// AUTO-REGISTER (onKernelRegister) : entité déclarée selon le dialecte du
// connecteur `default` (sqlite|postgres — S1 multi-dialecte) ; le storage
// s'enregistre dans le registre http à l'import. Sélection = `session.store:
// "drizzle"`, zéro câblage app.
export { default as SessionStorage } from "./nodefony/src/SessionStorage";
export {
  sessionTable,
  createSessionTable,
  createSessionEntity,
  registerSessionEntity,
  SESSION_ORM,
  SESSION_ENTITY_NAME,
} from "./nodefony/entity/sessionEntity";
export type { SessionRow } from "./nodefony/entity/sessionEntity";

// ─── Classes adapter orm-core (usage direct / banc-test) ────────────────────
export {
  DrizzleOrm,
  DrizzleRepository,
  DrizzleTransaction,
} from "./nodefony/src/orm-core/index";
export type {
  DrizzleOrmOptions,
  DrizzleDb,
  DrizzleResolvedRelation,
} from "./nodefony/src/orm-core/index";

// ─── Adapter User Drizzle (contrat @nodefony/user — ORM SQL par défaut, P5.9) ─
// Entité (table) dans entity/, couche d'accès (repository) dans src/.
export {
  userTable,
  createUserTable,
  createUserEntity,
  registerUserEntity,
} from "./nodefony/entity/userTable";
export type { UserRow } from "./nodefony/entity/userTable";
export { DrizzleUserRepository } from "./nodefony/src/DrizzleUserRepository";

// ─── Store de jetons Drizzle (contrat ITokenStore de @nodefony/security, J4b) ─
// AUTO-REGISTER (onKernelRegister) : entité + fabrique "drizzle" déclarées par le
// module — sélectionnable via `tokenStore.store: "drizzle"`, zéro câblage app.
// Exports conservés pour usage direct/banc-test (les guards laissent la main à l'app).
export {
  accessTokenTable,
  deniedJtiTable,
  subjectRevocationTable,
  createAccessTokenTable,
  createDeniedJtiTable,
  createSubjectRevocationTable,
  createTokenEntities,
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "./nodefony/entity/tokenEntity";
export type {
  DeniedJtiRow,
  SubjectRevocationRow,
} from "./nodefony/entity/tokenEntity";
export { DrizzleTokenStore } from "./nodefony/src/DrizzleTokenStore";

// ─── Journal d'audit Drizzle (contrat IAuditStore de @nodefony/security, P6.14) ─
// AUTO-REGISTER (onKernelRegister) : sélectionnable via `audit.store: "drizzle"`.
// Append-only + pagination curseur exacte (ts, id), query builder dialect-agnostique.
export {
  auditEventTable,
  createAuditEntities,
  registerAuditEntities,
  AUDIT_ENTITY_NAMES,
} from "./nodefony/entity/auditEventEntity";
export type { AuditEventRow } from "./nodefony/entity/auditEventEntity";
export { DrizzleAuditStore } from "./nodefony/src/DrizzleAuditStore";

// ─── Store de credentials WebAuthn Drizzle (IWebAuthnCredentialStore, J9) ─────
// AUTO-REGISTER (onKernelRegister) : sélectionnable via `passkeys.store: "drizzle"`.
export {
  webAuthnCredentialTable,
  createWebAuthnCredentialTable,
  createWebAuthnCredentialEntity,
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "./nodefony/entity/webAuthnCredentialEntity";
export type { WebAuthnCredentialRow } from "./nodefony/entity/webAuthnCredentialEntity";
export { DrizzleWebAuthnCredentialStore } from "./nodefony/src/DrizzleWebAuthnCredentialStore";

// ─── Store de secrets TOTP Drizzle (ITotpSecretStore, 2FA persistant) ─────────
// AUTO-REGISTER (onKernelRegister) : sélectionnable via `totp.store: "drizzle"`.
export {
  totpSecretTable,
  createTotpSecretTable,
  createTotpSecretEntity,
  registerTotpSecretEntity,
  TOTP_SECRET_ENTITY,
} from "./nodefony/entity/totpSecretEntity";
export type { TotpSecretRow } from "./nodefony/entity/totpSecretEntity";
export { DrizzleTotpSecretStore } from "./nodefony/src/DrizzleTotpSecretStore";

// ─── Store d'idempotence Drizzle (IIdempotencyStore au CORE — multi-pod sans Redis) ─
// AUTO-REGISTER (onKernelRegister) : sélectionnable via `NF_IDEMPOTENCY_STORE=drizzle`
// — porté sqlite ET postgres (Slice 0). Réservation atomique = INSERT … ON CONFLICT
// DO UPDATE … WHERE expiré (le `SET NX PX` SQL). GC applicatif (pas de TTL natif).
export {
  idempotencyKeyTable,
  createIdempotencyTable,
  createIdempotencyEntities,
  registerIdempotencyEntities,
  IDEMPOTENCY_ENTITY_NAME,
} from "./nodefony/entity/idempotencyEntity";
export type { IdempotencyKeyRow } from "./nodefony/entity/idempotencyEntity";
export { DrizzleIdempotencyStore } from "./nodefony/src/DrizzleIdempotencyStore";
export type { SqlDialect } from "./nodefony/config/config";

// ─── Store d'endpoints webhook Drizzle (IWebhookStore de @nodefony/security, P6.13) ─
// AUTO-REGISTER (onKernelRegister) : sélectionnable via `NF_WEBHOOK_STORE=drizzle`.
// Registre DURABLE des endpoints (survit au redémarrage, ≠ MemoryWebhookStore).
export {
  webhookEndpointTable,
  createWebhookEndpointEntity,
  registerWebhookEndpointEntity,
  WEBHOOK_ENDPOINT_ENTITY,
} from "./nodefony/entity/webhookEndpointEntity";
export type { WebhookEndpointRow } from "./nodefony/entity/webhookEndpointEntity";
export { DrizzleWebhookStore } from "./nodefony/src/DrizzleWebhookStore";

// ─── Auto-register du schéma framework (appelé par onKernelRegister) ─────────
// Exporté pour les tests et les apps avancées (rejouable : guards idempotents).
export {
  registerDrizzleFrameworkStores,
  FRAMEWORK_ORM,
} from "./nodefony/registerStores";
export type { IFrameworkStoresReport } from "./nodefony/registerStores";
