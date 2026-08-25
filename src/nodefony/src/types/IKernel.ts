import type { IService } from "./IService";
import type { IModule } from "./IModule";
import type { IBootReport } from "../kernel/bootReport";
import type FileClass from "../FileClass";
import type { EnvironmentType, DebugType } from "./globals";
import type { ICliKernel } from "./ICliKernel";
import type { IInfra, IStoreResolution } from "../config/infra";
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
  /**
   * Répertoire des données runtime PERSISTÉES (`<path>/var`) — base commune des
   * stores fichier (passkeys, TOTP, sessions) et bases SQLite. Gitignoré ; garanti
   * créé au boot (comme `tmpDir`, éphémère). Absent tant que le Kernel n'a pas booté.
   */
  readonly varDir?: FileClass;
  readonly isDev: boolean;
  readonly isProd: boolean;
  /**
   * Infra déclarée (`database`/`cache`/`logs`) résolue depuis l'environnement
   * (URLs `NF_DATABASE_URL`/`NF_REDIS_URL`/…). Mémoïsée — consommée par les
   * briques dont le store vaut `"auto"` (`resolveAutoStore`).
   */
  readonly infra: IInfra;
  /**
   * Résolutions EFFECTIVES des stores de persistance, capturées au boot par
   * chaque brique (`registerStoreResolution`) — la vérité vécue (replis inclus),
   * alimente l'écran Studio « Stores ». Vide tant qu'aucune brique n'a résolu.
   */
  readonly storeResolutions: IStoreResolution[];
  /**
   * Enregistre la résolution effective d'une brique de persistance (idempotent
   * par `brick` — la dernière résolution gagne). La provenance est dérivée de
   * `configured` (`"auto"` → `"infra"`, sinon `"explicit"`). Appelé au boot,
   * après le `log()` de résolution du consommateur.
   */
  registerStoreResolution(
    resolution: Omit<IStoreResolution, "provenance">,
  ): void;
  /**
   * L'environnement FOURNIT-il un vrai terminal ? Résolu une fois au boot
   * (`process.stdout.isTTY`, surchargeable `NF_NO_TTY`). Volet « environnement » qui
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
  /** Supprime les bannières serveurs sous l'écran de boot animé (dev). */
  readonly suppressBootBanners: boolean;

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
  /** `quiet` muselle l'affichage (log « terminate : N ») — jamais le drain. */
  terminate(code?: number, quiet?: boolean): Promise<this>;
  isTrunk(): Promise<TrunkType>;
  isModule(subclass: unknown): boolean;
  addModule(Mod: unknown, ...args: unknown[]): Promise<IModule>;
  loadModule(nameOrPath: string): Promise<IModule>;
  getModule(name: string): IModule;
  getModules(): Record<string, IModule>;
  getNetwork(): KernelNetworkResult;
  checkPath(myPath: string): string | null;
  isCommandComplete(progress: number): boolean;

  // ─── Diagnostic de boot (BootReport + canal de détails par phase) ────────────
  /** Verdict agrégé du dernier boot (modules, serveurs, santé) — vérité unique. */
  getBootReport(): IBootReport;
  /** AJOUTE une ligne de détail à afficher sous une phase de boot (canal neutre). */
  reportBootLine(phase: string, line: string): void;
  /** REMPLACE les lignes de détail d'une phase (producteur idempotent). */
  setBootLines(phase: string, lines: string[]): void;
  /** Lignes de détail déclarées pour une phase de boot. */
  getBootLines(phase: string): string[];
}
