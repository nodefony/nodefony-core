import type { IResolvedFrontendEntry } from "./IFrontBuilder";
import type { IViteSupervisorStatus } from "./IViteSupervisor";

/** Résultat d'un `build()` — exploité par la commande CLI (exit code pipeline). */
export interface IFrontendBuildResult {
  /** Bundles effectivement (re)buildés. */
  built: string[];
  /** Bundles ignorés car déjà à jour (manifest plus récent que les sources). */
  skipped: string[];
  /** Bundles en échec (`entryName` + message Vite). */
  failures: { entryName: string; message: string }[];
}

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
  /**
   * Build production — `vite.build()` par entry (manifest.json par bundle).
   * @param opts.force rebuild même si le manifest est plus récent que les sources.
   */
  build(opts?: { force?: boolean }): Promise<IFrontendBuildResult>;
  /** Helper template — retourne les balises `<script>` à injecter dans une page. */
  renderTags(entryName: string): string;
  /**
   * Document HTML complet : `index.html` du module + tags injectés. Pour les
   * controllers qui veulent déléguer toute la coquille (le dev contrôle le
   * `<head>` via son `index.html`).
   */
  renderDocument(entryName: string): string;
  /**
   * Résout l'URL publique d'un asset : préfixe `p` par `assetBaseUrl` (CDN) si
   * configuré, sinon chemin relatif inchangé. URLs absolues renvoyées telles
   * quelles. Helper template `asset('/x')`.
   */
  assetUrl(p: string): string;
}
