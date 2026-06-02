import type { IService } from "./IService";
import type { IModule } from "./IModule";
import type FileClass from "../FileClass";
import type { EnvironmentType, DebugType } from "./globals";
import type { ICliKernel } from "./ICliKernel";
import type { ICommand } from "./ICommand";
import type os from "node:os";

// Redéfinis localement — import circulaire impossible (Kernel.ts → Service.ts → IService.ts → IKernel.ts)
// Miroir de IRunProfile/RunLifetime de Kernel.ts (profil d'exécution : serveurs ? durée de vie ? interactif ?).
type RunLifetime = "oneshot" | "longrunning";
interface IRunProfile {
  servers: boolean;
  lifetime: RunLifetime;
  interactive: boolean;
}
type EventsType = Record<string, number>;
// Redéfini depuis Kernel.ts (trunkType)
type TrunkType = "javascript" | "typescript" | null;

// Résultat de Kernel.getNetwork() — redéfini ici pour éviter l'import circulaire
export interface KernelNetworkResult {
  external: Record<string, os.NetworkInterfaceInfo[]>;
  local: Record<string, os.NetworkInterfaceInfo[]>;
  ipv4: Record<string, os.NetworkInterfaceInfo[]>;
  ipv6: Record<string, os.NetworkInterfaceInfo[]>;
  interfaces: Record<string, os.NetworkInterfaceInfo[]>;
}

/**
 * Contrat public du Kernel nodefony.
 * Utilisé comme type de IService.kernel pour éviter l'import circulaire
 * Kernel.ts → Service.ts → IService.ts → IKernel.ts → Kernel.ts.
 *
 * IModule sera ajouté quand IModule sera défini (getModule/modules typés object pour l'instant).
 * command/commandArgs typés object/unknown[] — ICommand session dédiée.
 */
export interface IKernel extends IService {
  // ─── Identité & environnement ───────────────────────────────────────────────
  runProfile: IRunProfile;
  readonly version: string;
  readonly environment: EnvironmentType;
  readonly debug: DebugType;
  readonly projectName: string;
  readonly path: string;
  readonly isDev: boolean;
  readonly isProd: boolean;
  /**
   * L'environnement FOURNIT-il un vrai terminal ? Résolu une fois au boot
   * (`process.stdout.isTTY`, surchargeable `NO_TTY`). Volet « environnement » qui
   * complète `runProfile.interactive` (besoin déclaré) : un prompt n'a de sens que si
   * `runProfile.interactive && kernel.isTTY`. Cloud-native (pod/CI) → toujours `false`.
   */
  readonly isTTY: boolean;

  // ─── Processus ─────────────────────────────────────────────────────────────
  readonly pid: number;
  readonly platform: NodeJS.Platform;

  // ─── Système de fichiers ─────────────────────────────────────────────────────
  /** Répertoire temporaire du projet (`<cwd>/tmp`), initialisé au boot. */
  tmpDir?: FileClass;

  // ─── Lifecycle flags ───────────────────────────────────────────────────────
  readonly started: boolean;
  readonly booted: boolean;
  readonly ready: boolean;
  readonly postReady: boolean;

  // ─── Events kernel ─────────────────────────────────────────────────────────
  readonly Events: Readonly<EventsType>;
  readonly progress: number;

  // ─── Trunk ─────────────────────────────────────────────────────────────────
  readonly trunk: TrunkType;

  // ─── Commande CLI ──────────────────────────────────────────────────────────
  command: ICommand | null;
  commandArgs: unknown[];

  // ─── Réseau ────────────────────────────────────────────────────────────────
  domain: string;

  // ─── CLI ───────────────────────────────────────────────────────────────────
  cli: ICliKernel | null;

  // ─── Modules ───────────────────────────────────────────────────────────────
  readonly modules: Record<string, IModule>;

  // ─── Méthodes publiques ────────────────────────────────────────────────────
  start(): Promise<this>;
  terminate(code?: number): Promise<this>;
  isTrunk(): Promise<TrunkType>;
  isModule(subclass: unknown): boolean;
  addModule(Mod: unknown, ...args: unknown[]): Promise<IModule>;
  loadModule(nameOrPath: string): Promise<IModule>;
  getModule(name: string): IModule;
  getModules(): Record<string, IModule>;
  getNetwork(): KernelNetworkResult;
  checkPath(myPath: string): string | null;
  isCommandComplete(progress: number): boolean;
}
