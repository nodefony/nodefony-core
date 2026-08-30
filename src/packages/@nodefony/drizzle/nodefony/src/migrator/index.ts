/**
 * Applicateur de migrations de schéma du module drizzle.
 *
 * Il **planifie, valide, applique, adopte et répare** — avec sa table
 * d'historique et son verrou natif par dialecte. Les fichiers, eux, sont
 * produits par `npm run generate:migrations` (drizzle-kit) et livrés dans le
 * paquet.
 */
export {
  DrizzleMigrator,
  DEFAULT_LOCK_TIMEOUT_MS,
  type IDrizzleMigratorOptions,
  type IMigrateOptions,
} from "./DrizzleMigrator";
export {
  openMigrationDriver,
  SqliteMigrationDriver,
  PostgresMigrationDriver,
  MysqlMigrationDriver,
  PG_LOCK_KEY,
  MYSQL_LOCK_NAME_SQL,
  MYSQL_LOCK_PREFIX,
  type IMigrationTarget,
} from "./drivers/index";
export {
  ensureHistorySchema,
  readHistory,
  HISTORY_STEPS,
  type IHistoryStep,
} from "./history";
export { migrationHash, normalizeSql } from "./hash";
export {
  checkMigrationName,
  suggestMigrationName,
  MIGRATION_NAME_MAX,
  type MigrationNameCheck,
} from "./name";
export { schemaReader, type ISchemaReader, type SqlQuery } from "./catalog";
export {
  comparisonAgainstDeclared,
  describeDivergence,
  gapAgainstDeclared,
} from "./divergence";
export {
  adoptFromDatabase,
  introspectionUrl,
  readJournal,
  snapshotTables,
  tablesPresentIn,
  uncommentIntrospection,
  type IAdoptedBaseline,
} from "./adopt";
export {
  compareSchema,
  additiveSql,
  hasGap,
  type ISchemaComparison,
  type ISchemaGap,
  type IExpectedTable,
} from "./schemaDiff";
export {
  frameworkMigrationsDir,
  defaultMigrationSources,
  FRAMEWORK_SOURCE,
  APP_SOURCE,
  FRAMEWORK_RANK,
  APP_RANK,
} from "./paths";
export {
  loadSources,
  orderSources,
  splitStatements,
  createdTables,
  SUPPORTED_JOURNAL_VERSIONS,
  type ILoadedSources,
  frameworkTables,
} from "./sources";
export {
  HISTORY_TABLE,
  FORMAT_MARKER,
  STATEMENT_BREAKPOINT,
  MigrationVerdictError,
  type IAppliedMigration,
  type IMigrationAction,
  type IMigrationApplied,
  type IMigrationDrift,
  type IMigrationDriver,
  type IMigrationFile,
  type IMigrationPlan,
  type IMigrationRun,
  type IMigrationSource,
  type IMigrationVerdict,
  type MigrationVerdictCode,
} from "./types";
