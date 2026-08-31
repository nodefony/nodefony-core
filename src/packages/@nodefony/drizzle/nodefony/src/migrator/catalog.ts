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
  /**
   * Deux noms de COLONNE désignent-ils la même, pour ce moteur ?
   *
   * 🔴 **La sémantique est celle du MOTEUR** : si le serveur sait résoudre ce
   * nom dans un `SELECT`, la colonne existe pour l'application ; sinon la
   * requête du code échouerait vraiment, et l'annoncer manquante est JUSTE.
   *
   * - **SQLite** — sans distinction de casse, comme sa résolution de noms.
   * - **MySQL** — sans distinction de casse, sur **toutes** les plateformes :
   *   contrairement aux tables, les noms de colonnes ne dépendent pas de
   *   `lower_case_table_names`.
   * - **PostgreSQL** — EXACT : les identifiants sont cités (Drizzle cite tout),
   *   donc `SELECT "createdAt"` sur une colonne `createdat` échoue pour de bon.
   *
   * ⚠️ **Il n'y a délibérément PAS d'équivalent synchrone pour les TABLES.**
   * Leur sensibilité à la casse dépend de la MACHINE — `lower_case_table_names`
   * vaut `0` sur Linux (sensible, constaté sur MySQL 8.4) et `1` ou `2`
   * ailleurs. Une règle déduite du seul dialecte serait donc fausse une fois
   * sur deux, sans que rien ne le dise. Elle se **CONSTATE** par
   * {@link ISchemaReader.tableExists}, qui interroge le catalogue du serveur et
   * hérite de sa collation — jamais elle ne se déduit.
   *
   * @param declared - nom tel que le code le déclare.
   * @param actual - nom tel que la base le rend.
   * @returns `true` si le moteur les résoudrait vers la même colonne.
   */
  sameColumnName(declared: string, actual: string): boolean;
  /** La table existe-t-elle dans le schéma courant de la connexion ? */
  tableExists(table: string): Promise<boolean>;
  /** Colonnes de la table, telles que la base les déclare. */
  columnsOf(table: string): Promise<string[]>;
}

/**
 * Les moteurs dont la résolution des noms de COLONNES ignore la casse.
 *
 * PostgreSQL n'y est pas, et ce n'est pas un oubli : il stocke la casse d'un
 * identifiant cité et la compare exactement.
 */
const COLONNES_INSENSIBLES: ReadonlySet<SqlDialect> = new Set<SqlDialect>([
  "sqlite",
  "mysql",
]);

/**
 * Compare deux noms de COLONNE selon la résolution du moteur.
 *
 * Exportée parce qu'elle porte une RÈGLE : la recopier ailleurs la ferait
 * diverger, et une divergence de casse ne se voit que sur une base adoptée,
 * c'est-à-dire chez l'utilisateur.
 *
 * Elle ne vaut PAS pour les tables — voir {@link ISchemaReader.sameColumnName},
 * qui dit pourquoi leur sensibilité se constate au lieu de se déduire.
 *
 * @param dialect - moteur qui résoudrait le nom.
 * @param declared - nom tel que le code le déclare.
 * @param actual - nom tel que la base le rend.
 * @returns `true` si le moteur les résoudrait vers la même colonne.
 */
export function sameColumnName(
  dialect: SqlDialect,
  declared: string,
  actual: string,
): boolean {
  return COLONNES_INSENSIBLES.has(dialect)
    ? declared.toLowerCase() === actual.toLowerCase()
    : declared === actual;
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
    sameColumnName(declared: string, actual: string): boolean {
      return sameColumnName(dialect, declared, actual);
    },

    async tableExists(table: string): Promise<boolean> {
      switch (dialect) {
        case "sqlite": {
          // 🔴 `COLLATE NOCASE`, et ce n'est pas une tolérance : `sqlite_master`
          // compare en BINAIRE alors que le moteur, lui, résout les noms de
          // tables SANS distinction de casse. Sans cette clause, une base
          // adoptée portant `users` face à un code qui déclare `Users` était
          // déclarée ABSENTE — alors qu'un `SELECT … FROM "Users"` y répond. Le
          // verdict retenait la mise en service du pod pour un écart que le
          // moteur ne voit même pas.
          const rows = await query<{ name: string }>(
            `SELECT name FROM sqlite_master ` +
              `WHERE type = 'table' AND name = ? COLLATE NOCASE`,
            [table],
          );
          return rows.length > 0;
        }
        case "postgres": {
          // 🔴 JAMAIS `to_regclass(nom)` : PostgreSQL y voit un IDENTIFIANT, et
          // plie en minuscules tout identifiant non cité. `to_regclass('User')`
          // cherche donc `user`, rend NULL, et le lecteur déclare absente une
          // table qui existe — sur TOUTE base PostgreSQL, puisque `User` est une
          // table du framework. Le verdict `divergent` tombait alors en
          // permanence, et avec lui la sonde de disponibilité en mode `fail`.
          //
          // Le catalogue compare des CHAÎNES, pas des identifiants : la casse y
          // est celle de la table, sans pliage. C'est aussi, exactement, la
          // résolution de `columnsOf` juste en dessous — les deux moitiés d'un
          // même lecteur doivent voir la même base, sinon elles divergent en
          // silence, ce qui est précisément ce qui est arrivé ici.
          // `current_schemas(false)` suit le `search_path` de la connexion, donc
          // l'isolation par schéma reste possible.
          const rows = await query<{ found: number }>(
            `SELECT 1 AS found FROM information_schema.tables ` +
              `WHERE table_name = ? AND table_schema = ANY(current_schemas(false))`,
            [table],
          );
          return rows.length > 0;
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
