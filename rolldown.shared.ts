/**
 * rolldown.shared.ts — source UNIQUE de la config rolldown des packages Nodefony.
 *
 * Chaque package importe `defineNodefonyRolldownConfig()` depuis ce fichier (même
 * pattern que `vitest.oxc.ts`) au lieu de dupliquer input/external/treeshake/output
 * dans 19 `rolldown.config.ts`.
 *
 * Invariants portés ici (pièges gravés, cf docs/audits/rolldown-migration-plan-2026-07.md §10) :
 * - le NOM PROPRE du paquet est TOUJOURS externe (anti self-import : un paquet qui
 *   s'importe par son nom fait avaler son `dist/` par le bundler) ;
 * - le side-effect de `reflect-metadata` survit au tree-shaking (il patche le global
 *   `Reflect` ; le striper = `Reflect.defineMetadata is not a function` au runtime) ;
 * - `nodefony` est externalisé en EXACT-MATCH seulement : avec `preserveModules`, les
 *   chunks internes sont nommés par chemin relatif (`nodefony/service/…`) et un match
 *   par préfixe les externaliserait à tort.
 *
 * Les décorateurs legacy (`experimentalDecorators` + `emitDecoratorMetadata`) sont lus
 * par rolldown depuis le `tsconfig.json` du package — rien à passer ici. Les `.d.ts`
 * ne sont PAS générés par le bundler : `tsgo --emitDeclarationOnly` (hors bundler).
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "rolldown";
import type { RolldownOptions, RolldownPluginOption } from "rolldown";

export interface INodefonyRolldownOptions {
  /** Liste `external` du package (deps runtime non bundlées). Le nom propre du paquet est ajouté d'office. */
  external?: string[];
  /** Entrées explicites — remplace le glob par défaut (`index.ts` + `nodefony/**∕*.ts`). */
  input?: Record<string, string>;
  /** Patterns glob des sources à préserver en modules (défaut `["nodefony/**∕*.ts"]`). */
  globPatterns?: string[];
  /** Sourcemaps de sortie (défaut `false`). */
  sourcemap?: boolean;
  /** Plugins additionnels (ex : `browserShim` du core). */
  plugins?: RolldownPluginOption[];
  /** Cible de résolution des builtins (défaut `"node"`). */
  platform?: "node" | "browser" | "neutral";
  /** Racine `preserveModulesRoot` (défaut `"."` — chemins relatifs au package). */
  preserveModulesRoot?: string;
  /** Dossier de sortie (défaut `"dist"`). */
  outDir?: string;
}

const IGNORED = [/\.d\.ts$/u, /\.test\.ts$/u, /\.spec\.ts$/u, /(^|\/)tests\//u];

/**
 * Construit la map d'entrées d'un package Nodefony : `index.ts` + toutes les sources
 * `nodefony/**` (hors tests et `.d.ts`), nommées par chemin relatif — la sortie
 * `preserveModules` reproduit l'arborescence source dans `dist/`.
 */
export function nodefonyInput(
  globPatterns: string[] = ["nodefony/**/*.ts"],
): Record<string, string> {
  const files = globPatterns
    .flatMap((pattern) => globSync(pattern))
    .filter((file) => !IGNORED.some((re) => re.test(file)));
  return {
    index: "./index.ts",
    ...Object.fromEntries(
      files.map((file) => [
        path.relative(".", file).replace(/\.ts$/u, ""),
        "./" + file,
      ]),
    ),
  };
}

/**
 * Config rolldown partagée d'un package Nodefony (bundle node ESM, `preserveModules`).
 *
 * @param opts - écarts du package par rapport au défaut (external, entrées, plugins)
 * @returns la config rolldown complète, prête pour `export default`
 */
export function defineNodefonyRolldownConfig(
  opts: INodefonyRolldownOptions = {},
): RolldownOptions {
  const pkg = JSON.parse(
    readFileSync(path.resolve("package.json"), "utf8"),
  ) as { name: string };
  const external = [...new Set([pkg.name, ...(opts.external ?? [])])];

  return defineConfig({
    input: opts.input ?? nodefonyInput(opts.globPatterns),
    platform: opts.platform ?? "node",
    external: (id) =>
      id !== "." &&
      external.some(
        (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
      ),
    treeshake: {
      moduleSideEffects: (id: string, isExternal: boolean): boolean =>
        id.includes("reflect-metadata") ? true : !isExternal,
    },
    output: {
      dir: opts.outDir ?? "dist",
      format: "esm",
      entryFileNames: "[name].js",
      exports: "auto",
      sourcemap: opts.sourcemap ?? false,
      preserveModules: true,
      preserveModulesRoot: opts.preserveModulesRoot ?? ".",
    },
    plugins: opts.plugins,
  });
}
