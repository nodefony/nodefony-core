import type { IFrontPreset } from "../../interfaces/IFrontPreset";

/**
 * Preset Vue 3 + Vite.
 *
 * Charge `@vitejs/plugin-vue` paresseusement : aucune dépendance
 * sur le module tant qu'aucune entrée Vue n'est déclarée. Contrairement
 * à React, Vue ne nécessite aucun preamble HMR injecté côté serveur —
 * `createApp(App).mount(...)` dans le point d'entrée suffit.
 */
const vue3Preset: IFrontPreset = {
  type: "vue3",
  extensions: [".vue", ".ts", ".js"],
  optimizeDepsInclude: ["vue"],

  async buildPlugins(): Promise<unknown[]> {
    const mod = (await import("@vitejs/plugin-vue")) as {
      default: (opts?: Record<string, unknown>) => unknown;
    };
    return [mod.default()];
  },
};

export default vue3Preset;
