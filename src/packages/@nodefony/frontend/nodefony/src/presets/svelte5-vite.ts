import type { IFrontPreset } from "../../interfaces/IFrontPreset";

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
const svelte5Preset: IFrontPreset = {
  type: "svelte5",
  extensions: [".svelte", ".ts", ".js"],
  optimizeDepsInclude: ["svelte"],

  async buildPlugins(): Promise<unknown[]> {
    // Spécificateur par VARIABLE (≠ presets react/vue/angular, installés au
    // root de CE dépôt) : le plugin svelte n'y est pas — un import littéral
    // ferait échouer le typecheck du framework pour un paquet que seule
    // l'application déclare. La résolution reste 100 % runtime (lazy).
    const pkg = "@sveltejs/vite-plugin-svelte";
    type SveltePlugin = {
      svelte: (opts?: Record<string, unknown>) => unknown;
    };
    let mod: SveltePlugin;
    try {
      mod = (await import(pkg)) as SveltePlugin;
    } catch {
      // App `--link` : ce preset vit dans le CHECKOUT du framework, le plugin
      // dans les node_modules de l'APP — l'import relatif à l'importeur ne le
      // voit pas (react/vue/angular n'y échappent que parce que le repo les
      // porte en devDeps). On résout donc depuis l'app (cwd), et l'`import()`
      // prend une URL, jamais un chemin (`D:\…` serait lu comme un protocole).
      const [{ createRequire }, { pathToFileURL }, path] = await Promise.all([
        import("node:module"),
        import("node:url"),
        import("node:path"),
      ]);
      const req = createRequire(path.join(process.cwd(), "package.json"));
      mod = (await import(
        pathToFileURL(req.resolve(pkg)).href
      )) as SveltePlugin;
    }
    return [mod.svelte()];
  },
};

export default svelte5Preset;
