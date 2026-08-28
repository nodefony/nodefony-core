import type { SqlDialect } from "../../config/config";

/**
 * Lecture du catalogue du serveur — quelles tables existent, quelles colonnes
 * elles portent —, écrite UNE fois par dialecte et partagée par ses deux
 * porteurs.
 *
 * ## Pourquoi ce fichier existe
 *
 * Deux composants ont besoin de la même réponse, depuis deux connexions
 * différentes : le pilote de l'applicateur de migrations, qui tient sa propre
 * connexion, et l'ORM, qui compare son schéma déclaré à la base **sur la
 * connexion qu'il a déjà**. Recopier les trois requêtes chez le second les
 * ferait diverger en silence — chacune passant ses propres tests — et la
 * divergence ne se verrait qu'à travers un verdict FAUX rendu à un exploitant.
 *
 * ## Pourquoi l'ORM n'ouvre pas simplement un pilote de migration
 *
 * Parce qu'une seconde connexion sur `:memory:` désigne une base **différente
 * et vide**. Le diff y annoncerait toutes les tables manquantes et un
 * rattrapage y écrirait dans une base que personne ne lit. Le lecteur est donc
 * paramétré par l'exécuteur de requêtes de son porteur, jamais par une
 * connexion à lui.
 */

/**
 * Exécute une requête paramétrée et rend ses lignes.
 *
 * Les paramètres s'écrivent `?` dans tous les dialectes ; c'est au porteur de
 * traduire s'il le faut (PostgreSQL attend `$1`).
 */
export type SqlQuery = <T extends Record<string, unknown>>(
  sql: string,
  params?: readonly unknown[],
) => Promise<T[]>;

/** Ce dont la comparaison de schéma a besoin, et rien de plus. */
export interface ISchemaReader {
  /** La table existe-t-elle dans le schéma courant de la connexion ? */
  tableExists(table: string): Promise<boolean>;
  /** Colonnes de la table, telles que la base les déclare. */
  columnsOf(table: string): Promise<string[]>;
}

/**
 * Compose un lecteur de catalogue au-dessus d'un exécuteur de requêtes.
 *
 * @param dialect - dialecte du serveur interrogé.
 * @param query - exécuteur du porteur (pilote de migration, ou ORM connecté).
 * @returns le lecteur, sans état ni connexion propre.
 */
export function schemaReader(
  dialect: SqlDialect,
  query: SqlQuery,
): ISchemaReader {
  return {
    async tableExists(table: string): Promise<boolean> {
      switch (dialect) {
        case "sqlite": {
          const rows = await query<{ name: string }>(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
            [table],
          );
          return rows.length > 0;
        }
        case "postgres": {
          // `to_regclass` suit le `search_path` de la connexion — c'est la même
          // résolution que celle des tables d'entités, et c'est ce qui rend
          // l'isolation par schéma possible.
          const rows = await query<{ found: boolean }>(
            `SELECT to_regclass(?::text) IS NOT NULL AS found`,
            [table],
          );
          return rows[0]?.found === true;
        }
        case "mysql": {
          const rows = await query<{ n: number }>(
            `SELECT COUNT(*) AS n FROM information_schema.tables ` +
              `WHERE table_schema = DATABASE() AND table_name = ?`,
            [table],
          );
          return Number(rows[0]?.n ?? 0) > 0;
        }
      }
    },

    async columnsOf(table: string): Promise<string[]> {
      switch (dialect) {
        case "sqlite": {
          if (!(await this.tableExists(table))) {
            return [];
          }
          // `PRAGMA` n'accepte pas de paramètre lié ; le nom vient du schéma
          // déclaré par le code, jamais d'une entrée utilisateur — il est
          // échappé quand même, la règle ne souffre pas d'exception.
          const rows = await query<{ name: string }>(
            `PRAGMA table_info("${table.replace(/"/g, '""')}")`,
          );
          return rows.map((row) => row.name);
        }
        case "postgres": {
          const rows = await query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns ` +
              `WHERE table_name = ? AND table_schema = ANY(current_schemas(false))`,
            [table],
          );
          return rows.map((row) => row.column_name);
        }
        case "mysql": {
          // `AS name` : MySQL rend `COLUMN_NAME` et MariaDB `column_name` selon
          // la version — un alias explicite évite de dépendre de la casse rendue.
          const rows = await query<{ name: string }>(
            `SELECT column_name AS name FROM information_schema.columns ` +
              `WHERE table_schema = DATABASE() AND table_name = ?`,
            [table],
          );
          return rows.map((row) => String(row.name));
        }
      }
    },
  };
}

/**
 * Traduit les paramètres `?` du dialecte commun en `$n` PostgreSQL.
 *
 * L'applicateur écrit ses requêtes une seule fois, avec la forme la plus
 * répandue ; chaque pilote l'adapte. Aucune des requêtes de l'applicateur ne
 * contient de littéral `?` — les valeurs, elles, sont bindées, jamais
 * concaténées.
 *
 * @param sql - requête écrite avec des `?`.
 * @returns la même requête, paramètres numérotés.
 */
export function toDollarParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}
