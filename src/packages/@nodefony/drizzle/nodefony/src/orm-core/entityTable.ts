import { Table, getTableName, is } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import { PgTable } from "drizzle-orm/pg-core";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { isPortableSchema } from "../../entity/colKit.shared";
import type { SqlDialect } from "../../interfaces/IDrizzleConfig";

/**
 * La table Drizzle qu'un `entity.schema` désigne pour un dialecte — table native
 * de ce dialecte, ou table PORTABLE (`defineTable`) déclinée pour lui.
 *
 * La seule règle qui décide « ce schéma sert-il ce connecteur ? » : le
 * démarrage, le semis de test et la lecture du contrat utilisateur l'appellent,
 * sans quoi l'un accepterait une entité portable que l'autre refuserait.
 *
 * @param schema - le `schema` de l'entité, tel que déclaré.
 * @param dialect - dialecte du connecteur.
 * @returns la table du dialecte, ou `null` si le schéma n'en est pas une.
 */
export function dialectTableOf(
  schema: unknown,
  dialect: "sqlite",
): SQLiteTable | null;
export function dialectTableOf(
  schema: unknown,
  dialect: "postgres",
): PgTable | null;
export function dialectTableOf(
  schema: unknown,
  dialect: "mysql",
): MySqlTable | null;
export function dialectTableOf(
  schema: unknown,
  dialect: SqlDialect,
): SQLiteTable | PgTable | MySqlTable | null;
export function dialectTableOf(
  schema: unknown,
  dialect: SqlDialect,
): SQLiteTable | PgTable | MySqlTable | null {
  const table: unknown = isPortableSchema(schema)
    ? schema.table(dialect)
    : schema;
  switch (dialect) {
    case "sqlite":
      return is(table, SQLiteTable) ? table : null;
    case "postgres":
      return is(table, PgTable) ? table : null;
    case "mysql":
      return is(table, MySqlTable) ? table : null;
  }
}

/**
 * Nom en base de la table d'un `entity.schema`, natif ou portable — sans
 * connaître le dialecte, qu'une table portable ne fixe pas.
 *
 * @param schema - le `schema` de l'entité.
 * @returns le nom de la table, ou `null` si ce n'est pas une table.
 */
export function schemaTableName(schema: unknown): string | null {
  if (isPortableSchema(schema)) {
    return schema.spec.name;
  }
  return is(schema, Table) ? getTableName(schema) : null;
}
