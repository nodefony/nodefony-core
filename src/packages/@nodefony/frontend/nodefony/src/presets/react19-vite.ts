import type {
  IFrontPreset,
  IVitePluginSpec,
} from "../../interfaces/IFrontPreset";
import { definePreset } from "./compose";

/** Le plugin React, décrit en données — source unique du build et du serveur de développement. */
function react19Plugins(): ReadonlyArray<IVitePluginSpec> {
  return [
    {
      specifier: "@vitejs/plugin-react",
      exportName: "default",
      options: { jsxRuntime: "automatic" },
    },
  ];
}

/**
 * Preset React 19 + Vite.
 *
 * Charge `@vitejs/plugin-react` paresseusement : aucune dépendance
 * sur le module si aucune entrée React n'est déclarée.
 */
const react19Preset: IFrontPreset = definePreset({
  type: "react19",
  extensions: [".jsx", ".tsx", ".js", ".ts"],
  optimizeDepsInclude: ["react", "react-dom", "react-dom/client"],
  // `@vitejs/plugin-react` ne pose AUCUN dedupe : cette ligne est la seule
  // protection contre deux runtimes React dans une application liée — hooks au
  // dispatcher null au montage (vécu en production).
  dedupe: ["react", "react-dom"],
  vitePlugins: react19Plugins,
});

export default react19Preset;
