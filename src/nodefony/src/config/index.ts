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
} from "./defineEnv";
export { defaultAppConfig } from "./defaults";
export { appConfigSchema, validateAppConfig } from "./schema";
export type { AppConfig } from "./schema";
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
