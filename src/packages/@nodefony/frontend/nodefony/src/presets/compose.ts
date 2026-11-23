import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder";
import type {
  FrontPresetType,
  IFrontPreset,
  IVitePluginSpec,
} from "../../interfaces/IFrontPreset";
import {
  FrontendPluginExportError,
  FrontendPresetUnknownError,
} from "../errors/FrontendError";

/**
 * Normalise un chemin en séparateurs `/`.
 *
 * Pour tout chemin qui VOYAGE — écrit dans le fichier `.mjs` généré, porté par
 * une option de plugin : un antislash (produit par `path.resolve` sous Windows)
 * y ouvrirait une séquence d'échappement de chaîne, et Windows accepte `/`
 * comme séparateur à l'ouverture.
 *
 * @param p - chemin natif
 * @returns le même chemin, séparé par `/`
 */
export function toPortablePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Ce que les presets d'un lot d'entrées apportent à une configuration Vite,
 * en données. Source UNIQUE du build en processus (`ViteBuilder`) et du
 * fichier du serveur de développement (`ViteConfigGenerator`).
 */
export interface IComposedPresets {
  /** Plugins décrits, dans l'ordre d'apparition des presets dans les entrées. */
  readonly plugins: ReadonlyArray<IVitePluginSpec>;
  /** Presets qui ne décrivent pas leurs plugins (`vitePlugins` absent). */
  readonly undescribed: ReadonlyArray<IFrontPreset>;
  /** `optimizeDeps.include` cumulé. */
  readonly optimizeDepsInclude: ReadonlyArray<string>;
  /** `resolve.dedupe` cumulé. */
  readonly dedupe: ReadonlyArray<string>;
}

/**
 * Compose les presets employés par un lot d'entrées : plugins, dépendances à
 * pré-empaqueter et paquets à dédupliquer.
 *
 * L'ordre est celui de la PREMIÈRE apparition de chaque preset dans les
 * entrées, pour les trois listes — les deux chemins qui consomment ce résultat
 * produisent donc la même configuration, octet pour octet dans le fichier
 * généré. Chaque preset reçoit ses propres entrées.
 *
 * @param entries - entrées résolues d'une même configuration Vite
 * @param getPreset - registre des presets (`ViteBuilder.getPreset`, ou les presets fournis)
 * @returns la composition, en données
 * @throws FrontendPresetUnknownError Quand une entrée nomme un preset non enregistré
 */
export function composePresets(
  entries: ReadonlyArray<IResolvedFrontendEntry>,
  getPreset: (type: FrontPresetType) => IFrontPreset | undefined,
): IComposedPresets {
  const byType = new Map<FrontPresetType, IResolvedFrontendEntry[]>();
  for (const entry of entries) {
    const own = byType.get(entry.type);
    if (own === undefined) byType.set(entry.type, [entry]);
    else own.push(entry);
  }

  const plugins: IVitePluginSpec[] = [];
  const undescribed: IFrontPreset[] = [];
  const optimizeDepsInclude: string[] = [];
  const dedupe: string[] = [];
  for (const [type, own] of byType) {
    const preset = getPreset(type);
    if (preset === undefined) throw new FrontendPresetUnknownError(type);
    if (preset.vitePlugins === undefined) undescribed.push(preset);
    else plugins.push(...preset.vitePlugins(own));
    optimizeDepsInclude.push(...preset.optimizeDepsInclude);
    if (preset.dedupe !== undefined) dedupe.push(...preset.dedupe);
  }
  return { plugins, undescribed, optimizeDepsInclude, dedupe };
}

/**
 * Importe le module d'un plugin : depuis ce paquet d'abord, depuis
 * l'application ensuite.
 *
 * Dans une application liée (`--link`), ce fichier vit dans le CHECKOUT du
 * framework et le plugin dans les `node_modules` de l'APPLICATION : la
 * résolution relative à l'importeur ne le voit pas. On résout alors depuis le
 * dossier courant (l'application). `import()` prend une URL, jamais un chemin
 * — `D:\…` serait lu comme un protocole. Seul un module INTROUVABLE déclenche
 * ce repli : une erreur levée par le plugin lui-même remonte telle quelle.
 */
async function importPluginModule(specifier: string): Promise<unknown> {
  try {
    const mod: unknown = await import(specifier);
    return mod;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_MODULE_NOT_FOUND"
    ) {
      throw error;
    }
    const [{ createRequire }, { pathToFileURL }, path] = await Promise.all([
      import("node:module"),
      import("node:url"),
      import("node:path"),
    ]);
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const mod: unknown = await import(
      pathToFileURL(req.resolve(specifier)).href
    );
    return mod;
  }
}

/** Une fabrique de plugin : tout export appelable. */
function isPluginFactory(
  value: unknown,
): value is (...args: ReadonlyArray<unknown>) => unknown {
  return typeof value === "function";
}

/**
 * Charge les plugins Vite décrits : importe chaque paquet PARESSEUSEMENT et
 * appelle l'export désigné avec ses options.
 *
 * Aucun paquet n'est chargé tant qu'aucune entrée ne réclame son preset :
 * l'application porte les plugins en `devDependencies`, ce module n'en déclare
 * aucun.
 *
 * @param specs - descriptions issues de {@link composePresets}
 * @returns les instances de plugin, dans l'ordre des descriptions
 * @throws FrontendPluginExportError Quand l'export désigné n'est pas une fonction
 */
export async function loadVitePlugins(
  specs: ReadonlyArray<IVitePluginSpec>,
): Promise<unknown[]> {
  const plugins: unknown[] = [];
  for (const spec of specs) {
    const mod = await importPluginModule(spec.specifier);
    const factory: unknown =
      typeof mod === "object" && mod !== null
        ? Reflect.get(mod, spec.exportName)
        : undefined;
    if (!isPluginFactory(factory)) {
      throw new FrontendPluginExportError(spec.specifier, spec.exportName);
    }
    const plugin: unknown =
      spec.options === undefined ? factory() : factory(spec.options);
    plugins.push(plugin);
  }
  return plugins;
}

/** Un preset qui décrit ses plugins en données — la forme de tous les presets fournis. */
export type IDescribedPreset = Omit<IFrontPreset, "buildPlugins"> &
  Required<Pick<IFrontPreset, "vitePlugins">>;

/**
 * Complète un preset décrit par la méthode `buildPlugins()`, dépréciée, que le
 * contrat exige encore : elle charge la même description, sans entrées.
 *
 * Seul endroit qui l'implémente — son retrait, à la majeure suivante, tient
 * dans cette fonction.
 *
 * @param preset - le preset, plugins décrits
 * @returns le preset complet
 */
export function definePreset(preset: IDescribedPreset): IFrontPreset {
  return {
    ...preset,
    // oxlint-disable-next-line typescript/no-deprecated -- contrat encore exigé jusqu'à la majeure suivante
    buildPlugins: () => loadVitePlugins(preset.vitePlugins([])),
  };
}
