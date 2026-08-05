import path from "node:path";
import type {
  IFrontBuilder,
  IResolvedFrontendEntry,
} from "../../interfaces/IFrontBuilder";
import type { IFrontPreset } from "../../interfaces/IFrontPreset";
import { FrontendPresetUnknownError } from "../errors/FrontendError";
import react19Preset from "../presets/react19-vite";
import vue3Preset from "../presets/vue3-vite";
import angularPreset from "../presets/angular-vite";
import vanillaPreset from "../presets/vanilla-vite";
import svelte5Preset from "../presets/svelte5-vite";

/**
 * Construit la config Vite finale à partir des entrées résolues et des presets.
 *
 * Le builder ne lance JAMAIS Vite — il fournit uniquement la config. Le
 * démarrage est délégué au superviseur (child_process ou in-proc).
 */
export class ViteBuilder implements IFrontBuilder {
  private readonly presets: Map<IFrontPreset["type"], IFrontPreset> = new Map();

  constructor() {
    this.registerPreset(react19Preset);
    this.registerPreset(vue3Preset);
    this.registerPreset(angularPreset);
    this.registerPreset(vanillaPreset);
    this.registerPreset(svelte5Preset);
  }

  listPresets(): ReadonlyArray<IFrontPreset> {
    return Array.from(this.presets.values());
  }

  getPreset(type: IFrontPreset["type"]): IFrontPreset | undefined {
    return this.presets.get(type);
  }

  registerPreset(preset: IFrontPreset): void {
    this.presets.set(preset.type, preset);
  }

  async buildViteConfig(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    mode: "development" | "production",
    assetBaseUrl: string = "",
  ): Promise<Record<string, unknown>> {
    if (entries.length === 0) {
      return { mode };
    }

    const usedPresets = new Set<IFrontPreset["type"]>();
    for (const e of entries) usedPresets.add(e.type);

    const plugins: unknown[] = [];
    const optimizeInclude: string[] = [];
    for (const type of usedPresets) {
      const preset = this.presets.get(type);
      if (!preset) throw new FrontendPresetUnknownError(type);
      plugins.push(...(await preset.buildPlugins()));
      optimizeInclude.push(...preset.optimizeDepsInclude);
    }

    // Multi-entry — Rollup-style input map. Pour le POC initial avec
    // 1 seule entrée, on garde le format objet (compatible Vite).
    const input: Record<string, string> = {};
    for (const e of entries) {
      input[e.entryName] = path.resolve(e.root, e.entryFile);
    }

    // Premier root utilisé comme racine Vite (contient index.html).
    // Si plusieurs roots → cas multi-bundle à traiter Phase ultérieure.
    const root = entries[0]!.root;
    const outDir = entries[0]!.outDir;

    // Prod : `base` = (assetBaseUrl +) publicPath → Vite préfixe les imports/assets
    // internes avec le même chemin que celui servi par `Statics`, éventuellement
    // précédé du CDN (`assetBaseUrl`). Dev : base par défaut "/" (le port Vite est
    // l'origine). Multi-entry partage le base de la 1ʳᵉ entrée. `assetBaseUrl` est
    // déjà normalisé sans slash final ; `publicPath` a ses `/` → pas de `//`.
    const base =
      mode === "production" ? assetBaseUrl + entries[0]!.publicPath : undefined;

    // MÊME règle que le fichier dev généré (ViteConfigGenerator) : dans une app
    // liée (`--link`), un import `react` émis par la façade `nodefony/react`
    // (réelpathée HORS de l'app, dans le checkout) se résout dans le
    // node_modules du framework pendant qu'`App.tsx` résout celui de l'app →
    // DEUX runtimes React dans le bundle prod, hooks au dispatcher null
    // (« Cannot read properties of null (reading 'useContext') » au mount —
    // vécu ; le dev ne le voyait pas : le prébundle unifie). `resolve.dedupe`
    // force une seule résolution, celle du root Vite.
    const dedupe: string[] = [];
    if (usedPresets.has("react19")) dedupe.push("react", "react-dom");
    if (usedPresets.has("vue3")) dedupe.push("vue");
    if (usedPresets.has("angular"))
      dedupe.push(
        "@angular/core",
        "@angular/common",
        "@angular/platform-browser",
      );

    return {
      mode,
      ...(base ? { base } : {}),
      root,
      plugins,
      ...(dedupe.length ? { resolve: { dedupe } } : {}),
      optimizeDeps: { include: optimizeInclude },
      build: {
        outDir,
        manifest: true,
        rollupOptions: { input },
        emptyOutDir: true,
      },
      server: {
        // Le port réel est piloté par le superviseur (config DEFAULT).
        strictPort: false,
        // CORS ON — le navigateur charge `http://127.0.0.1:5173/src/main.tsx`
        // depuis l'origine `http://127.0.0.1:5151` (Nodefony).
        cors: true,
      },
    };
  }
}

export default ViteBuilder;
