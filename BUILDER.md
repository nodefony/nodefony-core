# BUILDER.md — Architecture de build Nodefony (spec finale)

**Auteur** : Christophe CAMENSULI  
**Décisions validées** : 11 mai 2026  
**Statut** : Spec à implémenter — branche `build-refactor`

---

## Objectifs

1. `npm install` installe ET build tout automatiquement.
2. L'exécutable `nodefony` est disponible dans `bin/nodefony` après le build.
3. ESM uniquement — zéro CJS.
4. Build parallèle et incrémental via Turbo (rebuild seulement ce qui a changé).
5. Tests TS lancés directement via tsx — sans pré-compilation Rollup.
6. Package isomorphique : import conditionnel `browser`/`node` dans le core.
7. Zéro `@ts-ignore`, zéro `any` dans les configs de build.

---

## Décisions finales

| Sujet | Décision |
|-------|----------|
| Format de sortie | ESM uniquement — supprimer `dist/node-cjs/` |
| Client bundle | Garder dans le core, format ESM (pas IIFE), exports conditionnel `browser` |
| Tests | `mocha --import tsx` — pas de build Rollup pour les tests |
| Orchestration | **Turbo** — cache incrémental + parallélisation automatique |
| CLI | `src/nodefony/src/bin/nodefony.ts` → `bin/nodefony` via Rollup banner shebang |
| `npm link` | Jamais automatique |
| `preinstall` | Supprimé — workspaces npm gèrent l'install |
| `rollup-sourcemap-path-transform` | Shim `.d.ts` — supprimer les `@ts-ignore` |

---

## Architecture cible

```
nodefony-core/
├── package.json              ← Root : workspaces + prepare → turbo build
├── turbo.json                ← Orchestration : dépendances + cache
├── src/
│   ├── nodefony/             ← @nodefony/core (workspace "nodefony")
│   │   ├── package.json      ← ESM only, exports browser + node, bin: nodefony
│   │   ├── rollup.config.ts  ← 3 outputs : node ESM + binary + client ESM
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── bin/
│   │       │   └── nodefony.ts   ← CLI entry (shebang)
│   │       ├── client/
│   │       │   └── index.ts      ← Entrée bundle browser
│   │       └── types/
│   │           └── vendor.d.ts   ← Shim pour rollup-sourcemap-path-transform
│   └── packages/@nodefony/
│       └── <package>/
│           ├── package.json      ← "nodefony" en peerDependency (pas dependency)
│           └── rollup.config.ts  ← ESM only, même structure
```

---

## Fichiers à créer / modifier

### 1. Root `package.json` — scripts nettoyés

**Supprimer** : `preinstall`, `prebuild`, `rollup` au root, tout ce qui utilise `--prefix`.  
**Ajouter** : `prepare`, `clean`, `analyze`.

```json
{
  "scripts": {
    "prepare":        "turbo run build",
    "build":          "turbo run build",
    "build:core":     "npm run build --workspace=src/nodefony",
    "build:packages": "turbo run build --filter=./src/packages/**",
    "clean":          "turbo run clean",
    "dev":            "turbo run dev --filter=nodefony",
    "test":           "turbo run test",
    "analyze":        "npm run build --workspace=src/nodefony -- --analyze"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  }
}
```

> ⚠️ Conserver `workspaces`, `dependencies`, `devDependencies` existants. Modifier seulement `scripts` et ajouter `turbo` en devDependency.

---

### 2. `turbo.json` — orchestration déclarative

Turbo lit le graphe de dépendances des workspaces (`package.json` de chaque package). `dependsOn: ["^build"]` signifie "builder d'abord toutes les dépendances de ce package".

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "bin/nodefony"],
      "inputs": ["src/**/*.ts", "rollup.config.ts", "tsconfig.json", "package.json"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": [],
      "inputs": ["src/**/*.ts", "src/tests/**/*.ts"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    },
    "lint": {
      "inputs": ["src/**/*.ts"]
    }
  }
}
```

Résultat :
- `turbo run build` → build `nodefony` (core) en premier car les packages en dépendent, puis tous les packages en parallèle.
- Rebuild incrémental : si aucun fichier source n'a changé dans un package, Turbo restaure depuis le cache.

---

### 3. Core `src/nodefony/package.json` — ESM only + exports isomorphique

**Modifications** :
- Supprimer `main` (remplacé par `exports`)
- Supprimer l'entrée `require` dans `exports`
- Ajouter condition `browser`
- Supprimer `prebuild`/`postbuild` (Turbo + rollup s'en chargent)
- `test` passe à tsx

```json
{
  "name": "nodefony",
  "type": "module",
  "exports": {
    ".": {
      "browser": {
        "import": {
          "types": "./dist/client/types/src/client/index.d.ts",
          "default": "./dist/client/index.js"
        }
      },
      "import": {
        "types": "./dist/types/index.d.ts",
        "default": "./dist/node/index.js"
      }
    },
    "./package.json": "./package.json"
  },
  "bin": {
    "nodefony": "bin/nodefony"
  },
  "scripts": {
    "build":     "rollup --config rollup.config.ts --configPlugin typescript",
    "dev":       "rollup --config rollup.config.ts --configPlugin typescript --watch",
    "clean":     "rimraf dist bin/nodefony",
    "test":      "mocha --import tsx --recursive 'src/tests/**/*.test.ts'",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint 'src/**/*.ts'"
  }
}
```

---

### 4. Core `src/nodefony/rollup.config.ts` — 3 outputs, zéro `any`, zéro `@ts-ignore`

**Supprimer** : `createCjsConfig`, `createTestConfig`, `visualizer` dans le build principal, `eslint-disable any` en header, `rollup-plugin-polyfill-node` (inutile en Node.js), `copy` vide.

**Fixer** : type de `commandLineArgs`, imports propres.

```typescript
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─── External deps (ne pas bundler) ──────────────────────────────────────────
const external: string[] = [
  "nodefony",
  "asciify", "cli-color", "cli-table3", "clui", "commander",
  "@inquirer/prompts", "lodash", "lodash-es", "mime-types", "moment",
  "glob", "node-emoji", "node-fetch", "rxjs", "semver", "shelljs",
  "uuid", "twig", "ejs", "pm2", "pug", "rollup", "chokidar",
  "terser", "typedoc", "typedoc-plugin-markdown",
  "@rollup/plugin-typescript", "@rollup/plugin-node-resolve",
  "@rollup/plugin-commonjs", "@rollup/plugin-json", "@rollup/plugin-replace",
  "@rollup/plugin-terser", "@babel/parser", "@babel/traverse",
  "@babel/generator", "tslib",
];

// ─── Shared treeshake ─────────────────────────────────────────────────────────
const treeshake = defineConfig({
  treeshake: {
    moduleSideEffects: "no-external",
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
}).treeshake;

// ─── Warn filter ─────────────────────────────────────────────────────────────
function onwarn(warning: { message: string; code?: string }, warn: (w: typeof warning) => void): void {
  if (warning.message.includes("Circular dependency")) return;
  if (warning.code === "EVAL") return;
  warn(warning);
}

// ─── 1. Node ESM (dist/node/) ─────────────────────────────────────────────────
function createNodeConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    input: "src/index.ts",
    treeshake,
    onwarn,
    output: {
      dir: "./dist",
      entryFileNames: "node/[name].js",
      format: "esm",
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: "src",
      externalLiveBindings: false,
      freeze: false,
    },
    external,
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      typescript({
        tsconfig: path.resolve(__dirname, "tsconfig.json"),
        sourceMap: !isProduction,
        declaration: true,
        declarationDir: "dist/types",
      }),
      commonjs({ extensions: [".js"] }),
      json(),
    ],
  });
}

// ─── 2. Binary CLI (bin/nodefony) ─────────────────────────────────────────────
function createBinaryConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    input: "src/bin/nodefony.ts",
    treeshake,
    onwarn,
    output: {
      file: "./bin/nodefony",
      format: "esm",
      banner: "#!/usr/bin/env node",
      sourcemap: false,
      exports: "default",
    },
    external,
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      typescript({
        tsconfig: path.resolve(__dirname, "src/config/tsconfig.bin.json"),
      }),
      json(),
    ],
  });
}

// ─── 3. Client ESM (dist/client/) — import conditionnel "browser" ────────────
function createClientConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    input: "src/client/index.ts",
    onwarn,
    output: {
      dir: "./dist/client",
      entryFileNames: "[name].js",
      format: "esm",
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: "src",
    },
    plugins: [
      nodeResolve({ browser: true, preferBuiltins: false }),
      typescript({
        tsconfig: path.resolve(__dirname, "tsconfigClient.json"),
        declaration: true,
        declarationDir: "dist/client/types",
      }),
      json(),
    ],
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────
export default (commandLineArgs: Record<string, unknown>): RollupOptions[] => {
  const isProduction = !commandLineArgs["watch"];
  return [
    createNodeConfig(isProduction),
    createBinaryConfig(isProduction),
    createClientConfig(isProduction),
  ];
};
```

---

### 5. Shim `src/nodefony/src/types/vendor.d.ts` — fin des `@ts-ignore`

Créer ce fichier une fois, partagé par le core et le root rollup config via tsconfig.

```typescript
// Types pour les modules sans déclarations officielles
declare module "rollup-sourcemap-path-transform" {
  export function createPathTransform(options: {
    prefixes: Record<string, string>;
  }): (relativePath: string, sourceMapPath: string) => string;
}
```

Ajouter dans `src/nodefony/tsconfig.json` sous `include` :
```json
"include": ["src/**/*", "rollup.config.ts"]
```

Et dans `nodefony-core/tsconfig.json` (root) sous `include` :
```json
"include": ["rollup.config.ts", "nodefony/**/*.ts", "src/nodefony/src/types/vendor.d.ts"]
```

---

### 6. Tests — mocha + tsx (sans build préalable)

Dans `src/nodefony/package.json` :
```json
"test": "mocha --import tsx --recursive 'src/tests/**/*.test.ts'"
```

Dans `src/nodefony/src/tests/.mocharc.cjs` (ou `.mocharc.json`) :
```json
{
  "spec": "src/tests/**/*.test.ts",
  "require": [],
  "import": "tsx",
  "timeout": 10000
}
```

> **Long terme / studio** : mocha expose une API programmatique. Le studio pourra lancer les tests via `new Mocha().addFile(...).run(callback)` sans dépendre de la CLI.

---

### 7. Packages `src/packages/@nodefony/<package>/package.json`

Chaque package doit déclarer `nodefony` en `peerDependencies` (pas `dependencies`) pour que Turbo détecte la dépendance et ordonne le build.

```json
{
  "peerDependencies": {
    "nodefony": "*"
  },
  "scripts": {
    "build": "rimraf dist && rollup --config rollup.config.ts --configPlugin typescript",
    "clean": "rimraf dist",
    "dev":   "rollup --config rollup.config.ts --configPlugin typescript --watch",
    "test":  "mocha --import tsx --recursive 'nodefony/src/tests/**/*.test.ts'"
  }
}
```

> ⚠️ `@nodefony/llm` utilise actuellement `rollup -c ../../../rollup.config.ts` — à corriger : chaque package doit avoir son propre `rollup.config.ts`.

---

### 8. `src/packages/package.json` — à supprimer

Ce fichier fait des builds séquentiels via `--prefix`. Il est entièrement redondant avec `turbo run build`. Le supprimer.

---

## Workflow final

### `npm install`

```
npm install
  └── workspaces : installe node_modules dans chaque workspace
  └── hook prepare → turbo run build
        └── Turbo lit le graphe de dépendances
        └── Build "nodefony" (core) en premier
        └── Build les 14 packages en parallèle
        └── Build les modules
```

### `npm run build` (rebuild)

```
turbo run build
  └── Compare les inputs avec le cache Turbo
  └── Skips les packages non modifiés (cache hit)
  └── Rebuild seulement les packages touchés + leurs dépendants
```

### `npm test`

```
turbo run test
  └── S'assure que les builds sont à jour (dependsOn: ["build"])
  └── mocha --import tsx (pas de compilation préalable)
  └── Résultats en ~5s
```

---

## Checklist d'implémentation (ordre strict)

| # | Tâche | Fichier(s) | Statut |
|---|-------|------------|--------|
| 1 | Créer shim vendor.d.ts | `src/nodefony/src/types/vendor.d.ts` | ⬜ |
| 2 | Supprimer les `@ts-ignore` | `src/nodefony/rollup.config.ts`, `rollup.config.ts` | ⬜ |
| 3 | Refactorer core rollup (3 outputs, no CJS, no tests, no any) | `src/nodefony/rollup.config.ts` | ⬜ |
| 4 | Mettre à jour core package.json (ESM only + exports browser/node) | `src/nodefony/package.json` | ⬜ |
| 5 | Passer les tests à tsx | `src/nodefony/package.json` | ⬜ |
| 6 | Créer `turbo.json` à la racine | `turbo.json` | ⬜ |
| 7 | Modifier root `package.json` (scripts + turbo devDep) | `package.json` | ⬜ |
| 8 | Supprimer `src/packages/package.json` | `src/packages/package.json` | ⬜ |
| 9 | Corriger `@nodefony/llm` (son propre rollup.config.ts) | `src/packages/@nodefony/llm/rollup.config.ts` | ⬜ |
| 10 | Ajouter `peerDependencies: { nodefony: "*" }` dans chaque package | `src/packages/@nodefony/*/package.json` | ⬜ |
| 11 | Valider : `npm install` → build complet sans erreur | — | ⬜ |
| 12 | Valider : `npm test` → tous les tests verts | — | ⬜ |
| 13 | Valider : `bin/nodefony --help` fonctionne | — | ⬜ |
| 14 | Valider : build incrémental (modifier un fichier, rebuild rapide) | — | ⬜ |

---

## Ce qui ne change PAS

- Structure des dossiers — inchangée
- `workspaces` dans root `package.json` — inchangé
- Chaque package garde son `rollup.config.ts` propre
- `preserveModules: true` dans les outputs node — inchangé
- `rollup-sourcemap-path-transform` — conservé, juste typé correctement

---

## Risques et points d'attention

| Risque | Mitigation |
|--------|------------|
| `turbo run build` dans `prepare` ralentit `npm install` | Acceptable — un `npm install` propre fait le build complet une seule fois |
| Suppression CJS casse des utilisateurs existants | C'est une version alpha (10.0.0-alpha) — breaking change acceptable |
| `@nodefony/llm` sans rollup.config.ts propre | À traiter en étape 9 — blocker pour son build |
| `peerDependencies` vs `dependencies` pour le core | Turbo détecte les deux — mais peerDep est sémantiquement correct pour un framework |
