/**
 * nodefony/bundler — config rolldown partagée des packages ET des applications Nodefony.
 *
 * Source UNIQUE du socle de build, consommée PARTOUT via le subpath publié
 * `import { defineNodefonyRolldownConfig } from "nodefony/bundler"` — les 19 configs
 * du repo comme une application générée par `create app` (qui ne dépend JAMAIS d'un
 * fichier interne du repo). `rolldown` reste une devDependency du consommateur
 * (peerDependency optionnelle de `nodefony`). SEUL le core importe ce fichier en
 * relatif (`./src/bundler/index`) : il ne peut pas consommer son propre dist avant
 * de l'avoir buildé. Prérequis des autres : core buildé (ordre turbo standard).
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
  /**
   * Externalise automatiquement toutes les `dependencies` + `peerDependencies` du
   * `package.json` courant (défaut `false`). Mode recommandé pour une APPLICATION :
   * son runtime vient de `node_modules`, rien à bundler. Les packages du framework
   * gardent leur liste `external` explicite (auditée par `nodefony-check-externals`).
   */
  externalDeps?: boolean;
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

interface IPackageManifest {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Matcher `external` des packages Nodefony : exact-match ou préfixe `<nom>/`,
 * SAUF pour `nodefony` (exact-match seulement — cf invariant en tête de fichier).
 */
export function nodefonyExternalMatcher(
  external: string[],
): (id: string) => boolean {
  return (id: string) =>
    id !== "." &&
    external.some(
      (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
    );
}

/**
 * Treeshake commun : les externes sont sans effet de bord (équivalent
 * `no-external`) SAUF `reflect-metadata`, dont le side-effect doit survivre.
 */
export const nodefonyTreeshake = {
  moduleSideEffects: (id: string, isExternal: boolean): boolean =>
    id.includes("reflect-metadata") ? true : !isExternal,
};

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
 * Config rolldown partagée d'un package ou d'une application Nodefony
 * (bundle node ESM, `preserveModules`).
 *
 * @param opts - écarts par rapport au défaut (external, entrées, plugins)
 * @returns la config rolldown complète, prête pour `export default`
 */
export function defineNodefonyRolldownConfig(
  opts: INodefonyRolldownOptions = {},
): RolldownOptions {
  const pkg = JSON.parse(
    readFileSync(path.resolve("package.json"), "utf8"),
  ) as IPackageManifest;
  const external = [
    ...new Set([
      pkg.name,
      ...(opts.external ?? []),
      ...(opts.externalDeps
        ? [
            ...Object.keys(pkg.dependencies ?? {}),
            ...Object.keys(pkg.peerDependencies ?? {}),
          ]
        : []),
    ]),
  ];

  return defineConfig({
    input: opts.input ?? nodefonyInput(opts.globPatterns),
    platform: opts.platform ?? "node",
    external: nodefonyExternalMatcher(external),
    treeshake: nodefonyTreeshake,
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
