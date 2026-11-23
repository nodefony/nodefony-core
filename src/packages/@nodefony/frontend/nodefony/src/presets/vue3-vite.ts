import type {
  IFrontPreset,
  IVitePluginSpec,
} from "../../interfaces/IFrontPreset";
import { definePreset } from "./compose";

/** Le plugin Vue, décrit en données — source unique du build et du serveur de développement. */
function vue3Plugins(): ReadonlyArray<IVitePluginSpec> {
  return [{ specifier: "@vitejs/plugin-vue", exportName: "default" }];
}

/**
 * Preset Vue 3 + Vite.
 *
 * Charge `@vitejs/plugin-vue` paresseusement : aucune dépendance
 * sur le module tant qu'aucune entrée Vue n'est déclarée. Contrairement
 * à React, Vue ne nécessite aucun preamble HMR injecté côté serveur —
 * `createApp(App).mount(...)` dans le point d'entrée suffit.
 */
const vue3Preset: IFrontPreset = definePreset({
  type: "vue3",
  extensions: [".vue", ".ts", ".js"],
  optimizeDepsInclude: ["vue"],
  // `@vitejs/plugin-vue` pose déjà `resolve.dedupe: ["vue"]` : défense en
  // profondeur, qui nous rend indépendants d'un détail du plugin tiers.
  dedupe: ["vue"],
  vitePlugins: vue3Plugins,
});

export default vue3Preset;
