import path from "node:path";
import { buildReportDevtools } from "nodefony";
import type {
  IFrontBuilder,
  IResolvedFrontendEntry,
} from "../../interfaces/IFrontBuilder";
import type { IFrontPreset } from "../../interfaces/IFrontPreset";
import { builtinPresets } from "../presets";
import { composePresets, loadVitePlugins } from "../presets/compose";

/**
 * Construit la config Vite finale à partir des entrées résolues et des presets.
 *
 * Le builder ne lance JAMAIS Vite — il fournit uniquement la config. Le
 * démarrage est délégué au superviseur (child_process ou in-proc).
 */
export class ViteBuilder implements IFrontBuilder {
  private readonly presets: Map<IFrontPreset["type"], IFrontPreset> = new Map();

  constructor() {
    for (const preset of builtinPresets) this.registerPreset(preset);
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
    const [first] = entries;
    if (first === undefined) {
      return { mode };
    }

    // MÊME composition que le fichier du serveur de développement
    // (`ViteConfigGenerator`) : plugins, `optimizeDeps` et `resolve.dedupe`
    // viennent des presets, en données — aucune décision n'est recopiée ici.
    const composed = composePresets(entries, (type) => this.presets.get(type));
    const plugins = await loadVitePlugins(composed.plugins);
    for (const preset of composed.undescribed) {
      // Preset qui ne décrit pas ses plugins : seule voie encore possible.
      // oxlint-disable-next-line typescript/no-deprecated
      plugins.push(...(await preset.buildPlugins()));
    }

    // Multi-entry — Rollup-style input map. Pour le POC initial avec
    // 1 seule entrée, on garde le format objet (compatible Vite).
    const input: Record<string, string> = {};
    for (const e of entries) {
      input[e.entryName] = path.resolve(e.root, e.entryFile);
    }

    // Premier root utilisé comme racine Vite (contient index.html).
    // Si plusieurs roots → cas multi-bundle à traiter Phase ultérieure.
    const root = first.root;
    const outDir = first.outDir;

    // Prod : `base` = (assetBaseUrl +) publicPath → Vite préfixe les imports/assets
    // internes avec le même chemin que celui servi par `Statics`, éventuellement
    // précédé du CDN (`assetBaseUrl`). Dev : base par défaut "/" (le port Vite est
    // l'origine). Multi-entry partage le base de la 1ʳᵉ entrée. `assetBaseUrl` est
    // déjà normalisé sans slash final ; `publicPath` a ses `/` → pas de `//`.
    const base =
      mode === "production" ? assetBaseUrl + first.publicPath : undefined;

    // `resolve.dedupe` : dans une application liée (`--link`), un import `react`
    // émis par la façade `nodefony/react` (réelpathée hors de l'application) se
    // résolvait dans le `node_modules` du framework pendant qu'`App.tsx`
    // résolvait celui de l'application → DEUX runtimes React dans le bundle de
    // production, hooks au dispatcher null au montage (vécu ; le développement
    // ne le voyait pas, le prébundle unifie). La liste force une seule
    // résolution, celle de la racine Vite.
    const dedupe = [...composed.dedupe];

    return {
      mode,
      ...(base ? { base } : {}),
      root,
      plugins,
      ...(dedupe.length ? { resolve: { dedupe } } : {}),
      optimizeDeps: { include: [...composed.optimizeDepsInclude] },
      build: {
        outDir,
        manifest: true,
        // `rolldownOptions` : le nom de Vite 8 (`rollupOptions` n'en est plus
        // qu'un alias). Le rapport de build n'est écrit que par `vite.build` —
        // le serveur de développement l'ignore (cf buildReportDevtools).
        rolldownOptions: { input, devtools: buildReportDevtools() },
        emptyOutDir: true,
      },
      server: {
        // Le port réel est piloté par le superviseur (config DEFAULT).
        strictPort: false,
        // Bloc inerte en développement : le serveur Vite y lit la config écrite
        // par `ViteConfigGenerator`, pas celle-ci (cf `FrontendService`). Le
        // navigateur n'atteint d'ailleurs jamais Vite en direct — relais
        // `/_vite/<famille>/` sur l'origine de la page.
        cors: true,
      },
    };
  }
}

export default ViteBuilder;
