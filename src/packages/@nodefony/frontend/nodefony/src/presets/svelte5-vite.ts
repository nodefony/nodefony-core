import type {
  IFrontPreset,
  IVitePluginSpec,
} from "../../interfaces/IFrontPreset";
import { definePreset } from "./compose";

/**
 * Le plugin Svelte, décrit en données — source unique du build et du serveur
 * de développement. Export NOMMÉ (`svelte`) : seul plugin fourni sans export
 * par défaut. Le paquet n'est pas installé dans le dépôt du framework :
 * l'application le porte, et le chargeur le résout depuis elle au besoin
 * (`loadVitePlugins`).
 */
function svelte5Plugins(): ReadonlyArray<IVitePluginSpec> {
  return [{ specifier: "@sveltejs/vite-plugin-svelte", exportName: "svelte" }];
}

/**
 * Preset Svelte 5 + Vite.
 *
 * Charge `@sveltejs/vite-plugin-svelte` paresseusement : aucune dépendance sur
 * le module tant qu'aucune entrée Svelte n'est déclarée — c'est l'application
 * qui porte `svelte` et le plugin en devDependencies. Comme Vue, Svelte n'exige
 * aucun preamble HMR injecté côté serveur (`mount(App, { target })` suffit) ;
 * il cohabite donc dans la famille d'isolation `default` (extensions `.svelte`
 * disjointes de `.tsx`/`.vue`).
 */
const svelte5Preset: IFrontPreset = definePreset({
  type: "svelte5",
  extensions: [".svelte", ".ts", ".js"],
  optimizeDepsInclude: ["svelte"],
  // `@sveltejs/vite-plugin-svelte` pose déjà `SVELTE_DEDUPED_IMPORTS` (svelte
  // et ses sous-chemins) : défense en profondeur. Mesuré sur une application
  // liée avec deux `node_modules/svelte` : bundle identique avec ou sans.
  dedupe: ["svelte"],
  vitePlugins: svelte5Plugins,
});

export default svelte5Preset;
