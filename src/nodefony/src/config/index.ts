/**
 * Barrel du moteur de configuration `defineConfig` (back-only, D1).
 * Ré-exporté par le barrel node `src/index.ts` → `import { defineConfig } from "nodefony"`.
 */
export { defineConfig, isConfigDescriptor } from "./defineConfig";
export type { AppConfigDescriptor } from "./defineConfig";
export { use } from "./use";
export type { NodefonyModuleConfig, ConfigOf, UseOptions } from "./use";
export {
  defineEnv,
  envString,
  envNumber,
  envBoolean,
  envEnum,
  getEnvCatalog,
} from "./defineEnv";
export type { EnvVarKind, EnvVarMeta, NamedEnvVarMeta } from "./defineEnv";
export { renderEnvExample } from "./envExample";
export { defaultAppConfig } from "./defaults";
export { parseNfEnvOverrides } from "./envOverride";
export type { NfEnvOverride } from "./envOverride";
export {
  computeConfigProvenance,
  extractJsonSchemaDefaults,
} from "./configProvenance";
export type { ConfigOrigin } from "./configProvenance";
export {
  appConfigSchema,
  appConfigJsonSchema,
  validateAppConfig,
} from "./schema";
export type { AppConfig } from "./schema";
export {
  resolveInfra,
  resolveAutoStore,
  readStoreLocation,
  parseDatabaseUrl,
  sqliteFilenameFromUrl,
  AUTO_STORE,
  EMPTY_INFRA,
} from "./infra";
export type {
  IInfra,
  IInfraDatabase,
  IInfraCache,
  IInfraLogs,
  IAutoStoreResolution,
  InfraSqlDialect,
  DatabaseFamily,
  StoreKind,
  InfraEnvSource,
} from "./infra";
export { configReactivity, getConfigReactivity } from "./reactivity";
export type { Reactivity } from "./reactivity";
export type {
  AppConfigInput,
  ResolvedAppConfig,
  ConfigInput,
  ConfigContext,
  KnownModule,
  ModuleEntryInput,
  ModuleManifestInput,
  AppMeta,
  ServersConfig,
  HttpServerConfig,
  HttpsServerConfig,
  LogConfig,
  LogFileConfig,
  LogDestinationConfig,
} from "./types";
