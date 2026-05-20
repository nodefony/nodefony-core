/**
 * Déclaration de types locale pour `rollup-sourcemap-path-transform` (paquet
 * sans `.d.ts` publié) — utilisé uniquement par `rollup.config.ts`. Évite TS7016.
 */
declare module "rollup-sourcemap-path-transform" {
  export interface PathTransformOptions {
    /** Map préfixe-source → chemin absolu de remplacement dans les sourcemaps. */
    prefixes: Record<string, string>;
  }
  export function createPathTransform(
    options: PathTransformOptions,
  ): (relativeSourcePath: string, sourcemapPath: string) => string;
}
