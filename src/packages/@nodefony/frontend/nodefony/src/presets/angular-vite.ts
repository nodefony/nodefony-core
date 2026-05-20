import type { IFrontPreset } from "../../interfaces/IFrontPreset";

/**
 * Preset Angular (17+ standalone) + Vite via `@analogjs/vite-plugin-angular`.
 *
 * Charge le plugin paresseusement : aucune dépendance Angular tant qu'aucune
 * entrée `angular` n'est déclarée. Comme React/Vue, aucun preamble HTML n'est
 * requis — `bootstrapApplication(AppComponent)` dans le point d'entrée suffit.
 *
 * ⚠️ Contrairement à `.vue`/`.tsx`, le plugin Angular transforme les `.ts`
 * (extension non dédiée). Le scoping se fait via le `tsconfig` de l'app Angular
 * (passé par `ViteConfigGenerator`) dont le `include` ne couvre que le frontend
 * Angular — les `main.ts` des autres bundles (Vue) restent hors programme.
 */
const angularPreset: IFrontPreset = {
  type: "angular",
  extensions: [".ts", ".html"],
  optimizeDepsInclude: [
    "@angular/core",
    "@angular/common",
    "@angular/platform-browser",
  ],

  async buildPlugins(): Promise<unknown[]> {
    const mod = (await import("@analogjs/vite-plugin-angular")) as {
      default: (opts?: Record<string, unknown>) => unknown;
    };
    return [mod.default()];
  },
};

export default angularPreset;
