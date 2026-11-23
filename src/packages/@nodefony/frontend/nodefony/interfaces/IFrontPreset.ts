import type { IResolvedFrontendEntry } from "./IFrontBuilder";

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

/**
 * Une valeur d'option de plugin Vite exprimable en DONNÉES : ce que JSON sait
 * porter, et rien d'autre.
 *
 * Le type interdit une fonction, une expression régulière ou une instance : la
 * même description est écrite dans le fichier de configuration du serveur de
 * développement et peut traverser un canal entre process — une valeur qui ne se
 * sérialise pas y serait perdue en silence.
 */
export type VitePluginOption =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<VitePluginOption>
  | { readonly [key: string]: VitePluginOption };

/**
 * Un plugin Vite décrit par des données : d'où l'importer, quel export appeler,
 * avec quelles options.
 *
 * C'est la SEULE expression d'un plugin. Le build en processus la charge
 * (`loadVitePlugins`), le générateur du serveur de développement l'écrit
 * (`ViteConfigGenerator.toMjs`) : les deux chemins lisent la même source, et ne
 * peuvent donc plus diverger.
 */
export interface IVitePluginSpec {
  /** Spécificateur du paquet du plugin, tel qu'un `import` l'écrirait (ex. `@vitejs/plugin-react`). */
  readonly specifier: string;
  /** Export à appeler : `"default"` pour l'export par défaut, sinon son nom (ex. `svelte`). */
  readonly exportName: string;
  /** Options passées à la fabrique du plugin ; absentes = appel sans argument. */
  readonly options?: { readonly [key: string]: VitePluginOption } | undefined;
}

export interface IFrontPreset {
  /** Identifiant unique du preset (ex: "react19"). */
  readonly type: FrontPresetType;
  /** Extensions sources reconnues (".tsx", ".vue", ".svelte"…). */
  readonly extensions: ReadonlyArray<string>;
  /** Dépendances à pré-scanner via `optimizeDeps.include`. */
  readonly optimizeDepsInclude: ReadonlyArray<string>;
  /**
   * Paquets à dédupliquer (`resolve.dedupe`) : une seule résolution, celle de
   * la racine Vite. Une application liée (`--link`) a deux `node_modules`, et
   * sans cette liste deux runtimes du même framework finissent dans la page.
   * Absent = rien à dédupliquer.
   */
  readonly dedupe?: ReadonlyArray<string> | undefined;
  /**
   * Décrit les plugins Vite du preset, en données (cf {@link IVitePluginSpec}).
   *
   * Appelée avec les entrées de CE preset (jamais vide quand le builder ou le
   * générateur l'appellent), pour les options qui en dépendent — le `tsconfig`
   * d'Angular. Doit être pure : même entrées, même description.
   *
   * Un preset qui ne la fournit pas reste utilisable au build (par
   * {@link IFrontPreset.buildPlugins}), mais le serveur de développement le
   * refuse : ses plugins ne s'écrivent pas dans un fichier.
   */
  vitePlugins?(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
  ): ReadonlyArray<IVitePluginSpec>;
  /**
   * Construit la liste des plugins Vite à injecter.
   * Retour `unknown[]` pour éviter une dépendance dure sur les types Vite —
   * les plugins sont résolus dynamiquement par le builder.
   *
   * @deprecated Décrire les plugins par {@link IFrontPreset.vitePlugins} : le
   * builder ne l'appelle plus que pour un preset qui ne les décrit pas, et le
   * serveur de développement ne l'a jamais appelée. Retrait à la majeure
   * suivante.
   */
  buildPlugins(): Promise<unknown[]>;
}
