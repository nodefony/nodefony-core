import type { IFrontPreset } from "../../interfaces/IFrontPreset";

/**
 * Preset vanilla — TS/JS sans framework.
 *
 * Aucun plugin Vite, utile pour les modules qui n'ont besoin
 * que de bundling ESM + HMR de base.
 */
const vanillaPreset: IFrontPreset = {
  type: "vanilla",
  extensions: [".ts", ".js"],
  optimizeDepsInclude: [],
  async buildPlugins(): Promise<unknown[]> {
    return [];
  },
};

export default vanillaPreset;
