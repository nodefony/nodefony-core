import { ormRegistry } from "@nodefony/orm-core";
import {
  DrizzleIdempotencyStore,
  createIdempotencyTable,
  idempotencyKeyTable,
  registerIdempotencyEntities,
} from "@nodefony/drizzle";
import type { DrizzleDb, DrizzleOrm } from "@nodefony/drizzle";
import { registerIdempotencyStore } from "@nodefony/framework";
import { env } from "../../env";

/**
 * Câblage de l'idempotence des mutations sur **Drizzle** (store distribué cross-pod
 * sans Redis, P6.8), activé par `NF_IDEMPOTENCY_STORE=drizzle`.
 *
 * **Approche B** (comme le token store) : l'application câble l'entité ET la
 * fabrique ; le module `@nodefony/drizzle` n'auto-enregistre rien. Importé **au
 * top-level** depuis `index.ts` → l'entité est dans le `entityRegistry` AVANT le
 * connect du `DrizzleService` (table créée au boot), et la fabrique est dans le
 * registre `@nodefony/framework` avant que le framework la résolve (`onKernelBoot`).
 *
 * ⚠️ **Ordre de boot (vérifié au boot)** : le framework résout le store à
 * `onKernelBoot`, AVANT que le `DrizzleService` ait connecté l'ORM (`onBoot`) → à
 * cet instant l'ORM "default" n'est PAS encore dans le registre. La fabrique ne
 * doit donc JAMAIS résoudre l'ORM à la construction : elle bâtit un store dont le
 * handle est résolu **lazy** (à chaque usage), `null` tant que l'ORM n'est pas
 * connecté → dégradation gracieuse (begin = fresh sans dédup) sur la fenêtre de boot.
 *
 * **Dialecte** : l'app dev persiste en SQLite (connecteur `"default"`). Le multi-pod
 * RÉEL = Postgres (chantier multi-dialecte) ; ce câblage est borné à SQLite et
 * **échoue FRANC** si l'ORM est d'un autre dialecte (jamais une table sqlite sur un
 * ORM postgres).
 */
const ORM = "default";
const APP_DIALECT = "sqlite" as const;

if (env.NF_IDEMPOTENCY_STORE === "drizzle") {
  // 1) Entité (avant connect) — table `idempotency_key` matérialisée au boot.
  registerIdempotencyEntities(ORM, APP_DIALECT);

  // 2) Fabrique (registre framework) — résolution LAZY de l'ORM (cf TSDoc : ordre de boot).
  registerIdempotencyStore("drizzle", () => {
    const resolveDb = (): DrizzleDb | null => {
      let orm: DrizzleOrm | undefined;
      try {
        orm = ormRegistry.get(ORM) as DrizzleOrm;
      } catch {
        return null; // ORM pas encore enregistré (boot) ou déjà retiré (shutdown).
      }
      if (!orm.isConnected()) {
        return null;
      }
      if (orm.dialect !== APP_DIALECT) {
        // Garde-fou : l'entité est câblée en `APP_DIALECT` ; un autre dialecte = misconfig.
        throw new Error(
          `idempotency.store=drizzle : ORM "${ORM}" en "${orm.dialect}", attendu ` +
            `"${APP_DIALECT}" (alignement dialecte = chantier multi-dialecte).`,
        );
      }
      return orm.getNativeConnection<DrizzleDb>();
    };
    return new DrizzleIdempotencyStore(
      resolveDb,
      undefined,
      undefined,
      undefined,
      createIdempotencyTable(APP_DIALECT) as typeof idempotencyKeyTable,
    );
  });
}
