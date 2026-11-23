import type {
  IFrontPreset,
  IVitePluginSpec,
} from "../../interfaces/IFrontPreset";
import { definePreset } from "./compose";

/** Aucun plugin : le bundling ESM et le HMR de base suffisent. */
function vanillaPlugins(): ReadonlyArray<IVitePluginSpec> {
  return [];
}

/**
 * Preset vanilla — TS/JS sans framework.
 *
 * Aucun plugin Vite, utile pour les modules qui n'ont besoin
 * que de bundling ESM + HMR de base.
 */
const vanillaPreset: IFrontPreset = definePreset({
  type: "vanilla",
  extensions: [".ts", ".js"],
  optimizeDepsInclude: [],
  dedupe: [],
  vitePlugins: vanillaPlugins,
});

export default vanillaPreset;
