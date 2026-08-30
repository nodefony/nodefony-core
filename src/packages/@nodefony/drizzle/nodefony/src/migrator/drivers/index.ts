import type { SqlDialect } from "../../../config/config";
import type { IMigrationDriver } from "../types";
import { MysqlMigrationDriver } from "./mysqlDriver";
import { PostgresMigrationDriver } from "./postgresDriver";
import { SqliteMigrationDriver } from "./sqliteDriver";

export { SqliteMigrationDriver } from "./sqliteDriver";
export { PostgresMigrationDriver, PG_LOCK_KEY } from "./postgresDriver";
export {
  MysqlMigrationDriver,
  MYSQL_LOCK_NAME_SQL,
  MYSQL_LOCK_PREFIX,
} from "./mysqlDriver";

/** Cible de connexion de l'applicateur. */
export interface IMigrationTarget {
  /** Dialecte du connecteur. */
  dialect: SqlDialect;
  /** Fichier SQLite (dialecte `sqlite`). */
  filename?: string;
  /** URL de connexion DIRECTE (dialectes `postgres` et `mysql`). */
  url?: string;
}

/**
 * Ouvre le pilote à connexion unique du dialecte demandé.
 *
 * L'URL doit être une connexion **directe** au serveur : un répartiteur de
 * connexions en mode transaction casse les verrous consultatifs de session, et
 * le verrou de l'applicateur en est un.
 *
 * @param target - dialecte et coordonnées de la base.
 * @returns le pilote, déjà connecté.
 * @throws Error si les coordonnées manquent pour ce dialecte.
 */
export async function openMigrationDriver(
  target: IMigrationTarget,
): Promise<IMigrationDriver> {
  switch (target.dialect) {
    case "sqlite": {
      // 🔴 Aucun défaut ici. Une cible sqlite sans fichier retombait sur une
      // base EN MÉMOIRE : la commande migrait une base jetable, puis rendait
      // le code du SUCCÈS — le pire résultat possible, et le seul que le
      // module documente comme tel. Les deux autres moteurs refusaient déjà
      // une cible sans coordonnées ; celui-ci acceptait tout. La garde vivait
      // chez UN appelant, alors que cette fonction est publiée : un
      // consommateur qui construit mal sa cible n'en bénéficiait pas.
      if (!target.filename) {
        throw new Error(
          "Migrations : le dialecte sqlite exige un `filename`. Une base en " +
            "mémoire ne survivrait pas à la commande, et migrer une base " +
            "jetable en rendant le code du succès est le pire des verdicts. " +
            "Pour une base éphémère, passer explicitement « :memory: ».",
        );
      }
      return new SqliteMigrationDriver(target.filename);
    }
    case "postgres": {
      if (!target.url) {
        throw new Error(
          "Migrations : le dialecte postgres exige une `url` de connexion directe.",
        );
      }
      const driver = new PostgresMigrationDriver(target.url);
      await driver.connect();
      return driver;
    }
    case "mysql": {
      if (!target.url) {
        throw new Error(
          "Migrations : le dialecte mysql exige une `url` de connexion directe.",
        );
      }
      const driver = new MysqlMigrationDriver(target.url);
      await driver.connect();
      return driver;
    }
  }
}
