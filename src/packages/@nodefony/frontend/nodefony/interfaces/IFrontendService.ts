import type { IResolvedFrontendEntry } from "./IFrontBuilder";
import type { IViteSupervisorStatus } from "./IViteSupervisor";

/**
 * API publique du `FrontendService` injectable.
 *
 * Cycle de vie :
 *  1. `onKernelReady` → scan modules → collecte entries
 *  2. dev/start → délègue au superviseur Vite
 *  3. prod/build → appelle le builder Vite (compile, manifest.json)
 *  4. `onTerminate` → stop superviseur
 */
export interface IFrontendService {
  /** Entrées front résolues (snapshot lecture). */
  listEntries(): ReadonlyArray<IResolvedFrontendEntry>;
  /**
   * État de l'instance Vite primaire (`default`), pour compat. En multi-instance,
   * préférer `statusAll()` pour voir chaque famille.
   */
  status(): IViteSupervisorStatus;
  /**
   * État de **chaque** instance Vite, étiqueté par famille d'isolation
   * (`default`, `angular`, …). Vide tant qu'aucune instance n'est démarrée.
   */
  statusAll(): ReadonlyArray<{ family: string; status: IViteSupervisorStatus }>;
  /** Lance le dev server (idempotent — premier appel boot). */
  startDev(): Promise<void>;
  /** Stoppe proprement le superviseur. */
  stopDev(): Promise<void>;
  /** Build production — appelle Vite en mode build, écrit manifest.json. */
  build(): Promise<void>;
  /** Helper template — retourne les balises `<script>` à injecter dans une page. */
  renderTags(entryName: string): string;
}
