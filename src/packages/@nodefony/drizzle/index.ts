/**
 * `@nodefony/drizzle` — adapter Drizzle ORM (driver `better-sqlite3`) sur
 * `@nodefony/orm-core`.
 *
 * 3ᵉ driver concret du banc multi-ORM (après `@nodefony/sequelize` et
 * `@nodefony/mongoose`). Type-safe-first : a servi à figer la forme des
 * opérateurs riches du critère portable (ADR-0003 risque #3). Lib adapter : les
 * classes s'enregistrent dans le `OrmRegistry` à l'instanciation (`extends Orm`).
 */
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
