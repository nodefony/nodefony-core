/**
 * Adapter Drizzle (driver `better-sqlite3`) sur `@nodefony/orm-core` (P7.4).
 *
 * 3ᵉ adapter du banc multi-ORM (après Sequelize + Mongoose) ; valide le contrat
 * sur un ORM type-safe-first et la forme finale des opérateurs riches (ADR-0003).
 */
export { DrizzleOrm } from "./DrizzleOrm";
export type { DrizzleOrmOptions } from "./DrizzleOrm";
export { DrizzleRepository } from "./DrizzleRepository";
export type {
  DrizzleDb,
  DrizzleResolvedRelation,
} from "./DrizzleRepository";
export { DrizzleTransaction } from "./DrizzleTransaction";
