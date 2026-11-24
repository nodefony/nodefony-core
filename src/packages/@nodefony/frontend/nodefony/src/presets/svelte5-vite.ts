import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder";
import type {
  IFrontPreset,
  IVitePluginSpec,
} from "../../interfaces/IFrontPreset";
import { FrontendSvelteConfigConflictError } from "../errors/FrontendError";
import { definePreset, toPortablePath } from "./compose";

/**
 * Les noms de configuration que le plugin cherche à sa racine, dans SON ordre
 * (`@sveltejs/vite-plugin-svelte`, `knownSvelteConfigNames`) : le premier
 * trouvé gagne, ici comme chez lui.
 */
const SVELTE_CONFIG_NAMES = [
  "svelte.config.js",
  "svelte.config.ts",
  "svelte.config.mjs",
  "svelte.config.mts",
] as const;

/**
 * La configuration Svelte posée à la racine d'une entrée, ou `null`.
 *
 * @param root - racine front de l'entrée
 * @returns le chemin absolu du fichier trouvé, ou `null`
 */
function findSvelteConfig(root: string): string | null {
  for (const name of SVELTE_CONFIG_NAMES) {
    const file = path.join(root, name);
    if (existsSync(file)) return file;
  }
  return null;
}

/**
 * La configuration Svelte que le plugin doit lire pour un lot d'entrées.
 *
 * En développement, une famille partage UNE instance Vite dont la racine est
 * celle de sa première entrée (`ViteConfigGenerator.ts#viteDevRoot`) : le
 * plugin, laissé à lui-même, y cherche `svelte.config.*` — dans le dossier
 * d'un AUTRE module dès que l'entrée Svelte n'est pas la première, et ignore
 * celui du module sans un mot. On lui désigne donc le fichier :
 *
 * - aucune configuration → `null`, le plugin garde son comportement ;
 * - une seule, ou plusieurs au texte identique → la première ;
 * - des textes différents → {@link FrontendSvelteConfigConflictError}, qui
 *   nomme les deux fichiers : un plugin n'en lit qu'une, choisir en silence
 *   compilerait un module avec le préprocesseur d'un autre.
 *
 * Lectures synchrones : la composition est synchrone (`composePresets`), elle
 * tourne à chaque génération de configuration — démarrage ou entrée modifiée,
 * jamais par requête — et le plugin fait le même `existsSync` à chacun de ses
 * démarrages. Les fichiers ne sont lus que s'il y en a au moins deux.
 *
 * @param entries - les entrées svelte5 du lot
 * @returns le fichier à passer au plugin, ou `null`
 * @throws FrontendSvelteConfigConflictError Quand deux configurations diffèrent
 */
export function svelteConfigFile(
  entries: ReadonlyArray<IResolvedFrontendEntry>,
): string | null {
  let chosen: string | null = null;
  let chosenText: string | null = null;
  for (const entry of entries) {
    const file = findSvelteConfig(entry.root);
    if (file === null || file === chosen) continue;
    if (chosen === null) {
      chosen = file;
      continue;
    }
    chosenText ??= readFileSync(chosen, "utf8");
    if (readFileSync(file, "utf8") !== chosenText)
      throw new FrontendSvelteConfigConflictError(chosen, file);
  }
  return chosen;
}

/**
 * Le plugin Svelte, décrit en données — source unique du build et du serveur
 * de développement. Export NOMMÉ (`svelte`) : seul plugin fourni sans export
 * par défaut. Le paquet n'est pas installé dans le dépôt du framework :
 * l'application le porte, et le chargeur le résout depuis elle au besoin
 * (`loadVitePlugins`).
 *
 * `configFile` : la configuration du module ({@link svelteConfigFile}), en
 * ABSOLU — jamais posée quand il n'y en a pas, le plugin échouerait sur un
 * fichier absent. Au build, chaque entrée a sa propre racine : c'est le
 * fichier que le plugin y aurait trouvé seul.
 *
 * @param entries - les entrées svelte5 du lot ; vide = sans `configFile`
 */
function svelte5Plugins(
  entries: ReadonlyArray<IResolvedFrontendEntry>,
): ReadonlyArray<IVitePluginSpec> {
  const configFile = svelteConfigFile(entries);
  return [
    {
      specifier: "@sveltejs/vite-plugin-svelte",
      exportName: "svelte",
      ...(configFile === null
        ? {}
        : { options: { configFile: toPortablePath(configFile) } }),
    },
  ];
}

/**
 * Preset Svelte 5 + Vite.
 *
 * Charge `@sveltejs/vite-plugin-svelte` paresseusement : aucune dépendance sur
 * le module tant qu'aucune entrée Svelte n'est déclarée — c'est l'application
 * qui porte `svelte` et le plugin en devDependencies. Comme Vue, Svelte n'exige
 * aucun preamble HMR injecté côté serveur (`mount(App, { target })` suffit) ;
 * il cohabite donc dans la famille d'isolation `default` (extensions `.svelte`
 * disjointes de `.tsx`/`.vue`).
 */
const svelte5Preset: IFrontPreset = definePreset({
  type: "svelte5",
  extensions: [".svelte", ".ts", ".js"],
  optimizeDepsInclude: ["svelte"],
  // `@sveltejs/vite-plugin-svelte` pose déjà `SVELTE_DEDUPED_IMPORTS` (svelte
  // et ses sous-chemins) : défense en profondeur. Mesuré sur une application
  // liée avec deux `node_modules/svelte` : bundle identique avec ou sans.
  dedupe: ["svelte"],
  vitePlugins: svelte5Plugins,
});

export default svelte5Preset;
