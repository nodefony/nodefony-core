import type { IResolvedFrontendEntry } from "./IFrontBuilder";

/**
 * État courant du superviseur Vite — exposé pour observabilité (Vision, CLI).
 */
export type ViteSupervisorState =
  | "idle"
  | "starting"
  | "ready"
  | "compiling"
  | "restarting"
  | "crashed"
  | "stopping"
  | "stopped"
  | "errored";

/**
 * Snapshot lisible du superviseur, lu par TemplateHelper pour injecter
 * les bons scripts (URL `host:port` Vite côté navigateur).
 */
export interface IViteSupervisorStatus {
  readonly state: ViteSupervisorState;
  readonly host: string;
  readonly port: number | null;
  readonly pid: number | null;
  readonly lastError: string | null;
  readonly entries: ReadonlyArray<IResolvedFrontendEntry>;
  /** Vite sert-il en HTTPS ? Utilisé par TemplateHelper pour préfixer les `<script>`. */
  readonly https: boolean;
  /** Nombre de redémarrages auto effectués depuis le premier `start()`. */
  readonly restartCount: number;
  /** Nombre d'échecs consécutifs du health check (reset à chaque succès). */
  readonly healthFailures: number;
}

/**
 * Contrat du superviseur Vite — implémenté différemment selon la branche POC :
 *  - `poc/frontend-child` : ViteProcessSupervisor (child_process.spawn)
 *  - `poc/frontend-single` : ViteInProcSupervisor (vite.createServer() in-proc)
 *
 * L'API publique est la même, c'est le seul point d'isolement.
 */
export interface IViteSupervisor {
  start(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    viteConfig: Record<string, unknown>,
  ): Promise<void>;
  stop(): Promise<void>;
  status(): IViteSupervisorStatus;
}
