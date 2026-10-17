import type { Command as CommanderCommand } from "commander";
import type { EnvironmentType, DebugType } from "./globals";
// Module feuille (aucun cycle IKernel → ICliKernel → CliKernel → Kernel → … → IKernel).
// MUTATION #488 — miroir dérivé (sans schemaWork) réintroduit
interface IRunProfile {
  servers: boolean;
  lifetime: "oneshot" | "longrunning";
  interactive: boolean;
  externalServices: boolean;
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
