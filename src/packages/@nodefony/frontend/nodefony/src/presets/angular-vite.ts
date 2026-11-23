import path from "node:path";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder";
import type {
  IFrontPreset,
  IVitePluginSpec,
} from "../../interfaces/IFrontPreset";
import { definePreset, toPortablePath } from "./compose";

/**
 * Le plugin Angular, décrit en données — source unique du build ET du serveur
 * de développement.
 *
 * - `tsconfig` : celui de l'application Angular (scoping du compilateur),
 *   résolu en ABSOLU depuis la racine de la première entrée angular — le
 *   process Vite tourne depuis la racine de la PREMIÈRE entrée du lot, qui
 *   n'est pas celle d'Angular en multi-bundle.
 * - `disableTypeChecking: false` : analogjs coupe le contrôle des templates par
 *   défaut (`disableTypeChecking ?? true`) ; sans ce drapeau, `strictTemplates`
 *   et `strictUnclaimedEventNames` du `tsconfig.app.json` ne mordent jamais, et
 *   une faute de template passe le build.
 * - `liveReload: true` : remplacement à chaud des composants (défaut `false`
 *   chez analogjs) — sans lui, toute modification RECHARGE la page entière et
 *   l'état de l'application est perdu. Sans effet au build ; le plugin le
 *   coupe lui-même sous Angular < 19.
 *
 * @param entries - les entrées angular du lot ; vide = sans `tsconfig`
 */
function angularPlugins(
  entries: ReadonlyArray<IResolvedFrontendEntry>,
): ReadonlyArray<IVitePluginSpec> {
  const [first] = entries;
  return [
    {
      specifier: "@analogjs/vite-plugin-angular",
      exportName: "default",
      options: {
        disableTypeChecking: false,
        liveReload: true,
        ...(first === undefined
          ? {}
          : {
              tsconfig: toPortablePath(
                path.resolve(first.root, "tsconfig.app.json"),
              ),
            }),
      },
    },
  ];
}

/**
 * Preset Angular (17+ standalone) + Vite via `@analogjs/vite-plugin-angular`.
 *
 * Charge le plugin paresseusement : aucune dépendance Angular tant qu'aucune
 * entrée `angular` n'est déclarée. Comme React/Vue, aucun preamble HTML n'est
 * requis — `bootstrapApplication(AppComponent)` dans le point d'entrée suffit.
 *
 * ⚠️ Contrairement à `.vue`/`.tsx`, le plugin Angular transforme les `.ts`
 * (extension non dédiée). Le scoping se fait via le `tsconfig` de l'app Angular
 * (cf `angularPlugins`) dont le `include` ne couvre que le frontend
 * Angular — les `main.ts` des autres bundles (Vue) restent hors programme.
 */
const angularPreset: IFrontPreset = definePreset({
  type: "angular",
  extensions: [".ts", ".html"],
  optimizeDepsInclude: [
    "@angular/core",
    "@angular/common",
    "@angular/platform-browser",
  ],
  // `@analogjs/vite-plugin-angular` ne pose aucun dedupe.
  dedupe: ["@angular/core", "@angular/common", "@angular/platform-browser"],
  vitePlugins: angularPlugins,
});

export default angularPreset;
