import type { IFrontPreset } from "../../interfaces/IFrontPreset";

/**
 * Preset React 19 + Vite.
 *
 * Charge `@vitejs/plugin-react` paresseusement : aucune dépendance
 * sur le module si aucune entrée React n'est déclarée.
 */
const react19Preset: IFrontPreset = {
  type: "react19",
  extensions: [".jsx", ".tsx", ".js", ".ts"],
  optimizeDepsInclude: ["react", "react-dom", "react-dom/client"],

  async buildPlugins(): Promise<unknown[]> {
    const mod = (await import("@vitejs/plugin-react")) as {
      default: (opts?: Record<string, unknown>) => unknown;
    };
    return [mod.default({ jsxRuntime: "automatic" })];
  },
};

export default react19Preset;
