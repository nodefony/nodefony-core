import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";

/**
 * Décor d'un module de DÉVELOPPEMENT qui lie une table au connecteur de
 * l'application — la configuration que les migrations refusent (#687).
 *
 * Ce module porte `policy: "dev"` : il n'est pas chargé en production, alors
 * qu'une migration s'applique partout. La génération (`orm:generate`) et
 * l'adoption d'une base (`orm:migrate:baseline --from-database`) doivent donc
 * REFUSER en nommant le module et la table, plutôt que d'écrire sa table dans
 * une migration de l'application ou de l'en écarter en silence.
 *
 * `NF_DEV_MODULE_FIXTURE=<dialecte>` (`sqlite`, `postgres` ou `mysql`) exporte
 * la table et l'inscrit au registre. Le module doit être CHARGÉ pour que le
 * registre la porte : sous `NODE_ENV=production`, avec `NF_WITH_DEV_MODULES=1`.
 * Sans la variable, le fichier s'importe et n'exporte AUCUNE table — sinon il
 * ferait refuser toute génération lancée depuis le dépôt.
 */
export const DEV_MODULE_FIXTURE_TABLE = "dev_module_probe";

/** Connecteur du décor — celui de l'application, d'où le refus. */
export const DEV_MODULE_FIXTURE_CONNECTOR = "default";

const dialect = (process.env.NF_DEV_MODULE_FIXTURE ?? "").trim();

/** La table du décor — ou `undefined` hors banc. */
export const devModuleFixtureTable: unknown =
  dialect === "sqlite"
    ? sqliteTable(DEV_MODULE_FIXTURE_TABLE, {
        id: sqliteText("id").primaryKey(),
      })
    : dialect === "postgres"
      ? pgTable(DEV_MODULE_FIXTURE_TABLE, { id: pgText("id").primaryKey() })
      : dialect === "mysql"
        ? mysqlTable(DEV_MODULE_FIXTURE_TABLE, {
            id: varchar("id", { length: 36 }).primaryKey(),
          })
        : undefined;

/**
 * Inscrit la table du décor au registre, si un banc l'a demandée.
 *
 * À appeler depuis `onKernelRegister`, avant que l'adaptateur ne se connecte.
 *
 * @returns `true` si la table a été inscrite, `false` hors banc.
 */
export function registerDevModuleFixtureEntity(): boolean {
  if (devModuleFixtureTable === undefined) {
    return false;
  }
  entityRegistry.register({
    connector: DEV_MODULE_FIXTURE_CONNECTOR,
    module: "test",
    name: DEV_MODULE_FIXTURE_TABLE,
    schema: devModuleFixtureTable,
  });
  return true;
}
