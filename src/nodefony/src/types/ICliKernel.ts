import type { Command as CommanderCommand } from "commander";
import type { EnvironmentType, DebugType } from "./globals";

// Redéfinis localement — import circulaire impossible (IKernel → ICliKernel → CliKernel → Kernel → Service → IService → IKernel)
// Miroir de IRunProfile/RunLifetime de Kernel.ts.
type RunLifetime = "oneshot" | "longrunning";
interface IRunProfile {
  servers: boolean;
  lifetime: RunLifetime;
  interactive: boolean;
}

export interface ICliKernel {
  commander: CommanderCommand | null;
  environment: EnvironmentType;
  runProfile: IRunProfile;
  /** Boot silencieux d'une commande CLI utilitaire (cf CliKernel.quietBoot). */
  quietBoot?: boolean;
  debug: DebugType;
  pid: number | null;
  setProcessTitle(name?: string): void;
  showBanner(): void;
  blankLine(): void;
  clear(): void;
  showAsciify(name: string | null): Promise<unknown>;
  parseCommandAsync(argv?: string[]): Promise<CommanderCommand>;
  runCommandAsync(cmd: string, args?: string[]): Promise<CommanderCommand>;
  setPackageManager(manager?: string): unknown;
  setCommandVersion(version: string): CommanderCommand;
  initSyslog(env?: EnvironmentType, debug?: DebugType): void | null;
}
