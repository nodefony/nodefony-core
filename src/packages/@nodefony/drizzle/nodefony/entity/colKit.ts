import type { MySqlTable } from "drizzle-orm/mysql-core";
import type { PgTable } from "drizzle-orm/pg-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import { buildMySqlTable } from "./colKit.mysql";
import { buildPgTable } from "./colKit.pg";
import { guardIntegerKeys } from "./colKit.shared";
import { assertTableSpec } from "./colKit.spec";
import type { ITableSpec } from "./colKit.spec";
import { buildSqliteTable } from "./colKit.sqlite";
import type { MySqlTableOf, PgTableOf, SqliteTableOf } from "./colKit.types";

export * from "./colKit.spec";
export { isPortableTable } from "./colKit.shared";

/**
 * colKit — l'ADAPTATEUR Drizzle du kit de colonnes portable : une entité décrit ses colonnes UNE fois,
 * en types logiques, et le kit fabrique la table Drizzle du dialecte du
 * connecteur (`sqliteTable`, `pgTable`, `mysqlTable`).
 *
 * **Pourquoi** : une table Drizzle appartient à un seul dialecte. Sans kit, une
 * entité écrite pour SQLite refuse de se charger sur PostgreSQL ou MySQL, et
 * changer de base revient à réécrire le schéma. Le kit ne réécrit pas Drizzle :
 * il CHOISIT la colonne Drizzle de chaque moteur pour chaque type logique ;
 * Drizzle fait le SQL, les requêtes et les migrations.
 *
 * **Règles portées par construction** :
 * - mêmes **NOMS** de colonnes sur tous les dialectes, et même valeur
 *   JavaScript relue (le type de ligne {@link RowOf} est unique) ;
 * - ce qu'un moteur ne vérifie pas, une contrainte le fait refuser par le
 *   SERVEUR comme ailleurs : longueur d'un `string(n)` en SQLite, longueur
 *   exacte d'un `char(n)` partout, valeurs d'un `enum` partout (`CHECK`) ;
 * - ce qu'un moteur range différemment est rendu CANONIQUE à l'écriture
 *   (`decimal` au nombre de décimales de l'échelle, `uuid` en minuscules, jour
 *   `YYYY-MM-DD` validé) — la valeur relue est celle que PostgreSQL rendrait ;
 * - un type sans équivalent fidèle n'est JAMAIS approximé : `vector` est refusé
 *   hors PostgreSQL, au type (`never`) ET à la fabrication, en le nommant ;
 * - défaut calculé en `defaultFn`/`onUpdateFn` (JavaScript) : le DDL dérivé
 *   n'émet pas de `DEFAULT` SQL ; un défaut LITTÉRAL (`default`) est posé aux
 *   deux endroits — `DEFAULT` SQL dans la migration, même valeur côté JS ;
 * - nom en base distinct de la propriété par `column` (`created_at`).
 *
 * Correspondance type logique → colonne de chaque moteur : `docs/index.md`
 * du module, section « Des entités qui suivent la base ».
 */

/**
 * Vue LARGE d'une table portable — ce qu'une référence (`ref`) accepte pour
 * cible, et ce qu'un consommateur qui ne connaît pas la spec manipule.
 *
 * Elle ne nomme que les classes de table Drizzle : la vue précise
 * (`SqliteTableOf<ITableSpec>`) figerait `notNull: false` sur toute colonne et
 * aucune table réelle ne lui serait assignable — la spec raterait alors sa
 * contrainte et tout se dégraderait en cascade. Le type précis de la cible est
 * retrouvé par `infer` sur `spec`.
 */
export interface IPortableTableBase {
  readonly spec: ITableSpec;
  readonly table: ITableFactoryBase;
}

/** Fabrique de table par dialecte, vue LARGE. */
export interface ITableFactoryBase {
  (dialect: "sqlite"): SQLiteTable;
  (dialect: "postgres"): PgTable;
  (dialect: "mysql"): MySqlTable;
  (dialect: SqlDialect): SQLiteTable | PgTable | MySqlTable;
}

/** Fabrique de table par dialecte, typée par la spec. */
export interface ITableFactory<S extends ITableSpec> {
  (dialect: "sqlite"): SqliteTableOf<S>;
  (dialect: "postgres"): PgTableOf<S>;
  (dialect: "mysql"): MySqlTableOf<S>;
  (dialect: SqlDialect): SqliteTableOf<S> | PgTableOf<S> | MySqlTableOf<S>;
}

/** Ce que rend {@link defineTable} : la spec et la fabrique par dialecte. */
export interface IPortableTable<
  S extends ITableSpec,
> extends IPortableTableBase {
  readonly spec: S;
  readonly table: ITableFactory<S>;
}

type AnyTable = SQLiteTable | PgTable | MySqlTable;

/**
 * Déclare une table PORTABLE : une spec logique, une table Drizzle par
 * dialecte, construite au premier usage puis mémoïsée (le DDL, le registre
 * d'entités et les stores voient le même objet).
 *
 * La spec est un littéral d'objet inféré en `const` : les types de la table
 * (`$inferSelect`, `$inferInsert`, colonnes pour `eq()`/`asc()`) sont exacts sur
 * chaque dialecte et égaux à {@link RowOf}/{@link InsertOf}.
 *
 * @example
 * ```ts
 * export const article = defineTable({
 *   name: "article",
 *   columns: {
 *     id: { kind: "uuid", primaryKey: true, defaultFn: () => randomUUID() },
 *     title: { kind: "string", length: 120, notNull: true },
 *     status: { kind: "enum", values: ["draft", "live"], notNull: true },
 *   },
 * });
 * const table = article.table("postgres"); // PgTableWithColumns<…>
 * ```
 *
 * @param spec - spec logique de la table.
 * @returns la spec et sa fabrique par dialecte.
 * @throws Quand la spec est invalide ({@link assertTableSpec}).
 */
export function defineTable<const S extends ITableSpec>(
  spec: S,
): IPortableTable<S> {
  assertTableSpec(spec);
  let sqlite: SQLiteTable | null = null;
  let postgres: PgTable | null = null;
  let mysql: MySqlTable | null = null;

  function table(dialect: "sqlite"): SqliteTableOf<S>;
  function table(dialect: "postgres"): PgTableOf<S>;
  function table(dialect: "mysql"): MySqlTableOf<S>;
  function table(
    dialect: SqlDialect,
  ): SqliteTableOf<S> | PgTableOf<S> | MySqlTableOf<S>;
  function table(dialect: SqlDialect): AnyTable {
    switch (dialect) {
      case "sqlite":
        if (sqlite === null) {
          sqlite = buildSqliteTable(spec, () => {
            if (sqlite === null) {
              throw new Error(
                `[@nodefony/drizzle] colKit "${spec.name}": self-reference resolved too early.`,
              );
            }
            return sqlite;
          });
          guardIntegerKeys(sqlite, spec);
        }
        return sqlite;
      case "postgres":
        if (postgres === null) {
          postgres = buildPgTable(spec, () => {
            if (postgres === null) {
              throw new Error(
                `[@nodefony/drizzle] colKit "${spec.name}": self-reference resolved too early.`,
              );
            }
            return postgres;
          });
          guardIntegerKeys(postgres, spec);
        }
        return postgres;
      case "mysql":
        if (mysql === null) {
          mysql = buildMySqlTable(spec, () => {
            if (mysql === null) {
              throw new Error(
                `[@nodefony/drizzle] colKit "${spec.name}": self-reference resolved too early.`,
              );
            }
            return mysql;
          });
          guardIntegerKeys(mysql, spec);
        }
        return mysql;
    }
  }

  return { spec, table };
}
