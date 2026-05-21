/**
 * `@nodefony/drizzle` — module Drizzle ORM (driver `better-sqlite3`) sur
 * `@nodefony/orm-core`.
 *
 * **Module bootable** : enregistré dans `@modules()`, son {@link DrizzleService}
 * connecte au boot un {@link DrizzleOrm} par connecteur configuré (ORM par défaut
 * SQL recommandé). Expose aussi les **classes adapter** (orm-core) pour un usage
 * direct/banc-test. 3ᵉ driver concret du socle multi-ORM (après Sequelize +
 * Mongoose) ; type-safe-first (a figé la forme des opérateurs riches, ADR-0003 #3).
 */
import { Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import DrizzleService from "./nodefony/service/DrizzleService";

@services([DrizzleService])
class Drizzle extends Module {
  constructor(kernel: Kernel) {
    super("drizzle", kernel, import.meta.url, config);
  }
}

export default Drizzle;
export { DrizzleService };
export type {
  DrizzleConnectorConfig,
  DrizzleModuleConfig,
} from "./nodefony/config/config";

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
export {
  userTable,
  createUserEntity,
  registerUserEntity,
  DrizzleUserRepository,
} from "./nodefony/src/user/index";
export type { UserRow } from "./nodefony/src/user/index";
