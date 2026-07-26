/**
 * Configuration for scripts/generate-symbols.ts
 *
 * Globs relative to the repo root.
 * Two outputs:
 *  - stable  : .ai/symbols.json  → committed, lightweight, agent-readable
 *  - verbose : dist/symbols.json → generated, full detail, gitignored
 */

export interface GenerateSymbolsConfig {
  /** TS files to parse (positive globs). */
  include: string[];
  /** TS files to exclude (negative globs). */
  exclude: string[];
  /** Output paths, relative to repo root. */
  output: {
    stable: string;
    verbose: string;
  };
  /** Optional: tsconfig used to resolve types. Defaults to repo root tsconfig.json. */
  tsConfigFilePath?: string;
}

const config: GenerateSymbolsConfig = {
  include: [
    // Core workspace
    "src/nodefony/src/**/*.ts",
    "src/nodefony/index.ts",
    // Packages — entry + source
    "src/packages/@nodefony/*/index.ts",
    "src/packages/@nodefony/*/nodefony/**/*.ts",
    "src/packages/@nodefony/*/src/**/*.ts",
    // Test app modules
    "src/modules/*/index.ts",
    "src/modules/*/nodefony/**/*.ts",
  ],
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/tests/**",
    "**/types/**/*.d.ts",
    "**/*.config.ts",
    "**/rollup.config.ts",
    // Fixtures LOCALES non versionnées (cf `.gitignore`). Un artefact COMMITÉ ne
    // doit décrire que des fichiers présents dans un clone : sinon il diverge
    // d'une machine à l'autre au moindre `generate-symbols`, et publie ici le
    // schéma dérivé qu'on avait justement tenu hors du dépôt.
    "src/modules/test/nodefony/entity/dolibarr/**",
  ],
  output: {
    stable: ".ai/symbols.json",
    verbose: "dist/symbols.json",
  },
  tsConfigFilePath: "tsconfig.json",
};

export default config;
