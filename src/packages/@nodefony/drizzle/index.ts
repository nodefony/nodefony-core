/**
 * `@nodefony/drizzle` — module Drizzle ORM (driver `better-sqlite3`) sur
 * `@nodefony/orm-core`.
 *
 * **Module bootable** : enregistré dans `@modules()`, son {@link DrizzleService}
 * connecte au boot un {@link DrizzleOrm} par connecteur configuré (ORM par défaut
 * SQL recommandé). Expose aussi les **classes adapter** (orm-core) pour un usage
 * direct/banc-test. driver concret du socle multi-ORM (avec Mongoose) ; type-safe-first (a figé la forme des opérateurs riches, ADR-0003 #3).
 */
import {
  Kernel,
  Module,
  services,
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
import DrizzleService from "./nodefony/service/DrizzleService";

@services([DrizzleService])
class Drizzle extends Module {
  constructor(kernel: Kernel) {
    super("drizzle", kernel, import.meta.url, config);
  }

  /**
   * Monte le data plane ORM (`/nodefony/orm/api/*`) sur le broker admin.
   * Idempotent + lit les registres GLOBAUX → couvre tous les ORM présents, pas
   * seulement Drizzle. orm-core étant une lib pure, c'est un module driver qui
   * déclenche l'enregistrement (avant le `mountAll` de framework à `onKernelReady`).
   */
  override async onKernelBoot(): Promise<this> {
    const broker = this.kernel?.container?.get("adminBroker") as
      | IAdminRegistry
      | undefined;
    if (broker) {
      registerOrmAdminApi(broker);
    }
    // Branche la santé ORM lean dans le report de sonde cluster (« ORM par worker »).
    // Fonction GLOBALE (itère `ormRegistry`) → couvre tous les ORM, pas seulement Drizzle ;
    // idempotente (dernier gagne). Seam core → 0 dépendance framework→orm-core.
    setOrmHealthProvider(buildOrmLeanHealth);
    // Branche le diagnostic ORM RICHE pour le drill `/nodefony/orm/<pid>` en cluster :
    // `connection/health` (ping/latence/stockage/pool, async) + `flow` (débit/EWMA/slow).
    // Appelé UNIQUEMENT pendant un drill ORM (facette "orm") → 0 ping hors drill. Global
    // (itère `ormRegistry`) → couvre tous les ORM. Seam core (0 dépendance framework→orm-core).
    setOrmRichProvider(async () => ({
      health: await buildConnectionHealth(),
      flow: buildOrmFlow(),
    }));
    return this;
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
