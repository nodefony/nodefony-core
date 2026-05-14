import type { Command as CommanderCommand } from "commander";
import type { EnvironmentType, DebugType } from "./globals";

// Redéfinis localement — import circulaire impossible (IKernel → ICliKernel → CliKernel → Kernel → Service → IService → IKernel)
type KernelType = "console" | "server" | "CONSOLE" | "SERVER";

export interface ICliKernel {
  commander: CommanderCommand | null;
  environment: EnvironmentType;
  type: KernelType;
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
