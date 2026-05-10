import type { IService } from "./IService";
import type { EnvironmentType, DebugType } from "./globals";

// Redéfinis localement pour éviter l'import circulaire vers Kernel.ts
type KernelType = "CONSOLE" | "HTTP" | "HTTPS" | "HTTP2";
type EventsType = Record<string, number>;

/**
 * Contrat public du Kernel nodefony.
 * Utilisé comme type de `IService.kernel` pour éviter l'import circulaire
 * Kernel.ts → Service.ts → IService.ts → IKernel.ts → Kernel.ts.
 *
 * IModule sera ajouté quand IModule sera défini.
 */
export interface IKernel extends IService {
  // ─── Identité & environnement ───────────────────────────────────────────────
  readonly type: KernelType;
  readonly version: string;
  readonly environment: EnvironmentType;
  readonly debug: DebugType;
  readonly projectName: string;
  readonly path: string;
  readonly isDev: boolean;
  readonly isProd: boolean;

  // ─── Processus ─────────────────────────────────────────────────────────────
  readonly pid: number;
  readonly platform: NodeJS.Platform;

  // ─── Lifecycle flags ───────────────────────────────────────────────────────
  readonly started: boolean;
  readonly booted: boolean;
  readonly ready: boolean;
  readonly postReady: boolean;

  // ─── Events kernel ─────────────────────────────────────────────────────────
  readonly Events: Readonly<EventsType>;
  readonly progress: number;

  // ─── Modules (typés loosely jusqu'à la création de IModule) ───────────────
  readonly modules: Record<string, object>;

  // ─── Méthodes publiques ────────────────────────────────────────────────────
  start(): Promise<this>;
  getModule(name: string): object;
  getModules(): Record<string, object>;
  isCommandComplete(progress: number): boolean;
}
