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
import config from "./nodefony/config/config";
import {
  defineDrizzleConfig,
  drizzleConfigJsonSchema,
} from "./nodefony/config/defineDrizzleConfig";
import DrizzleService from "./nodefony/service/DrizzleService";
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
class Drizzle extends Module {
  constructor(kernel: Kernel) {
    super("drizzle", kernel, import.meta.url, config);
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
    this.set("drizzleConfig", validated);
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
} from "./nodefony/config/schema";
export type {
  IDrizzleConfig,
  IDrizzleConfigInput,
  IDrizzleConnectorConfig,
} from "./nodefony/interfaces/IDrizzleConfig";

// ─── Stockage de session Drizzle (consommé par @nodefony/http) ──────────────
// L'import de l'entité exécute son décorateur `@entity` → table créée au boot.
export { default as SessionStorage } from "./nodefony/src/SessionStorage";
export {
  default as SessionEntity,
  sessionTable,
  SESSION_ORM,
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
  createUserEntity,
  registerUserEntity,
} from "./nodefony/entity/userTable";
export type { UserRow } from "./nodefony/entity/userTable";
export { DrizzleUserRepository } from "./nodefony/src/DrizzleUserRepository";

// ─── Store de jetons Drizzle (contrat ITokenStore de @nodefony/security, J4b) ─
// Approche B : `@nodefony/security` n'est consommé qu'en `import type` (0 dép
// runtime). PAS d'auto-register — l'application câble `registerTokenStore` +
// `registerTokenEntities(orm)` (l'ORM choisi par l'app héberge les tables).
export {
  accessTokenTable,
  deniedJtiTable,
  subjectRevocationTable,
  createTokenEntities,
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "./nodefony/entity/tokenEntity";
export type {
  DeniedJtiRow,
  SubjectRevocationRow,
} from "./nodefony/entity/tokenEntity";
export { DrizzleTokenStore } from "./nodefony/src/DrizzleTokenStore";

// ─── Store de credentials WebAuthn Drizzle (IWebAuthnCredentialStore, J9) ─────
// Approche B (idem token) : `import type` seul, PAS d'auto-register. L'app câble
// `registerWebAuthnStore("drizzle", …)` + `registerWebAuthnCredentialEntity(orm)`.
export {
  webAuthnCredentialTable,
  createWebAuthnCredentialEntity,
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "./nodefony/entity/webAuthnCredentialEntity";
export type { WebAuthnCredentialRow } from "./nodefony/entity/webAuthnCredentialEntity";
export { DrizzleWebAuthnCredentialStore } from "./nodefony/src/DrizzleWebAuthnCredentialStore";
