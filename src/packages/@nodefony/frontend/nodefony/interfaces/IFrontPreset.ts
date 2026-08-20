/**
 * Preset descriptor — applique une stack frontend (React, Vue, Angular, Svelte, vanilla).
 *
 * Un preset enrichit la config Vite avec les plugins, les extensions de fichiers
 * et les dépendances pré-bundlées propres au framework cible.
 *
 * Cette union ne liste QUE les presets réellement enregistrés par le builder
 * (`ViteBuilder`). Une valeur annoncée ici sans preset correspondant serait
 * acceptée par le compilateur puis rejetée au démarrage
 * (`FrontendPresetUnknownError`) — un refus qui doit tomber à la compilation.
 */
export type FrontPresetType =
  "react19" | "vue3" | "angular" | "svelte5" | "vanilla";

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
