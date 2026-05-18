/**
 * Preset descriptor — applique une stack frontend (React, Vue, Svelte, Solid, vanilla).
 *
 * Un preset enrichit la config Vite avec les plugins, les extensions de fichiers
 * et les dépendances pré-bundlées propres au framework cible.
 */
export type FrontPresetType =
  | "react19"
  | "vue3"
  | "svelte5"
  | "solid"
  | "vanilla";

export interface IFrontPreset {
  /** Identifiant unique du preset (ex: "react19"). */
  readonly type: FrontPresetType;
  /** Extensions sources reconnues (".tsx", ".vue", ".svelte"…). */
  readonly extensions: ReadonlyArray<string>;
  /** Dépendances à pré-scanner via `optimizeDeps.include`. */
  readonly optimizeDepsInclude: ReadonlyArray<string>;
  /**
   * Construit la liste des plugins Vite à injecter.
   * Retour `unknown[]` pour éviter une dépendance dure sur les types Vite —
   * les plugins sont résolus dynamiquement par le builder.
   */
  buildPlugins(): Promise<unknown[]>;
}
