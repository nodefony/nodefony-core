import type { IService } from "./IService";
import type { IKernel } from "./IKernel";
import type { JSONObject } from "./globals";

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
  initialize?(kernel?: IKernel): Promise<this>;

  // ─── Services ──────────────────────────────────────────────────────────────
  // ServiceConstructor non importable ici → unknown + cast côté appelant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addService(service: unknown, ...args: any[]): Promise<IService>;
  loadService(service: string, ...args: unknown[]): Promise<IService>;

  // ─── Build ─────────────────────────────────────────────────────────────────
  // RollupOutput non importable ici → unknown
  build(): Promise<unknown>;
  getDependencies(): string[];

  // ─── Controllers (typés unknown — dépendance @nodefony/framework) ─────────
  getController(name: string): unknown;
  getControllers(): Record<string, unknown>;

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
