import type { IService } from "./IService";
import type { IKernel } from "./IKernel";
import type { JSONObject } from "./globals";

/**
 * Constructeur générique de controller — équivalent au type historique
 * `TypeController<T>` mais exposé via le contract public IModule.
 * Permet aux consommateurs (framework, http, security) de typer leurs
 * controllers sans que le core dépende de @nodefony/framework.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- signature de constructeur générique — `unknown[]` casse l'assignabilité des classes concrètes
export type IControllerConstructor<T = unknown> = new (...args: any[]) => T;

// Déplacé depuis Module.ts — défini ici pour éviter l'import circulaire IModule → Module
export interface PackageJson {
  name: string;
  version: string;
  description?: string;
  main?: string;
  module?: string;
  types?: string;
  scripts?: Record<string, string>;
  repository?: {
    type: string;
    url: string;
  };
  keywords?: string[];
  author?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Contrat public d'un module nodefony.
 * Module.ts implémente cette interface.
 *
 * Types Rollup/RollupWatcher/Controller typés unknown — dépendances externes
 * non disponibles ici sans créer des imports circulaires ou des couplages forts.
 */
export interface IModule extends IService {
  // ─── Identité ──────────────────────────────────────────────────────────────
  path: string;
  isApp: boolean;
  package?: PackageJson;

  // ─── Lifecycle hooks (optionnels, redéfinis par sous-classes) ────────────
  onKernelRegister?(): Promise<this>;
  onKernelBoot?(): Promise<this>;
  onKernelReady?(): Promise<this>;
  // Typé IKernel au lieu de Kernel concret pour éviter l'import circulaire
  init?(kernel?: IKernel): Promise<this>;

  // ─── Services ──────────────────────────────────────────────────────────────
  // ServiceConstructor non importable ici → unknown + cast côté appelant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addService(service: unknown, ...args: any[]): Promise<IService>;
  loadService(service: string, ...args: unknown[]): Promise<IService>;

  getDependencies(): string[];

  // ─── Controllers ───────────────────────────────────────────────────────────
  // Generic <T> : l'appelant type avec `Controller` (de @nodefony/framework) ou
  // toute classe utilisateur. Le core n'a pas de dépendance sur framework.
  //   const Ctor = module.getController<Controller>("MyController");
  //   const ctrl = new Ctor(context);
  getController<T = unknown>(name: string): IControllerConstructor<T>;
  getControllers<T = unknown>(): Record<string, IControllerConstructor<T>>;

  // ─── Services enregistrés par ce module (introspection admin) ────────────
  getServiceNames(): string[];

  // ─── Config — JSON Schema (introspection admin / Studio) ─────────────────
  // JSON Schema (`z.toJSONSchema`) de la config du module, ou null si non migré
  // Zod. Override par le module ; défaut null sur la classe de base.
  configSchema(): unknown | null;

  // ─── Metadata ──────────────────────────────────────────────────────────────
  getPackageJson(cwd?: string): Promise<PackageJson>;
  getModuleName(): string | undefined;
  getModuleVersion(): string | undefined;

  // ─── Installation ──────────────────────────────────────────────────────────
  install(force?: boolean): Promise<number | Error>;
  outdated(): Promise<number | Error>;

  // ─── Utilitaires ───────────────────────────────────────────────────────────
  loadJson(url: string, cwd?: string): Promise<JSONObject>;
}
