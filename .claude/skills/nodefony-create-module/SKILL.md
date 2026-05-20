---
name: nodefony-create-module
description: >
  Scaffold complet d'un nouveau module Nodefony — package, tsconfig, rollup, structure
  nodefony/{interfaces,service,command,src,config}/, index.ts (Module class + @services + exports),
  CLAUDE.md, MEMORY.md, README.md. Détecte automatiquement le pattern (package @nodefony/* dans
  src/packages/ vs module applicatif dans src/modules/), pré-configure les peerDeps, gère les
  options (commands CLI, controllers, frontend). Met à jour @modules() de index.ts racine. Évite
  les pièges connus (TS2565 options field redeclared, declarationDir sans declaration, ANSI codes).
  Déclencheurs : "crée un module", "scaffold module", "nouveau module nodefony", "génère un module",
  "create module", "new module", "bootstrap module", "init module", "module @nodefony/...".
---

# nodefony-create-module

Génère un module Nodefony complet — backend uniquement par défaut, optionnellement avec
controllers HTTP, commands CLI, ou frontend Vite — en suivant les conventions figées
dans `CLAUDE.md` racine et observées sur les modules existants (`@nodefony/http`,
`@nodefony/llm`, `@nodefony/frontend`).

## Quand l'utiliser

Dès que l'user dit :
- "crée un module X", "nouveau module nodefony X"
- "scaffold @nodefony/Y"
- "bootstrap un module Z"
- "génère @nodefony/...", "init module..."

**Ne pas utiliser** pour ajouter un controller, service ou fichier isolé à un module
existant — utiliser Edit/Write direct.

## Questions à poser à l'user AVANT de générer (AskUserQuestion)

Pose-les en UN SEUL `AskUserQuestion` (1-4 questions max). Pas obligatoire de toutes
poser — si l'user a déjà donné le nom dans son prompt, skip cette question.

### Q1 — Nom du module (obligatoire)

Si pas déjà fourni :

> "Quel est le nom du module ? (ex: `@nodefony/foo` ou juste `foo`)"

Si l'user tape `@nodefony/foo` ou `foo` → package dans `src/packages/@nodefony/foo/`.
Si l'user tape un nom sans `@` ET sans préfixe particulier ET dit "applicatif" → `src/modules/foo/`.
En cas de doute : assumer **package @nodefony/** (le cas le plus fréquent).

### Q2 — Catégorie (si ambigu)

| Option | Emplacement | Quand |
| ------ | ----------- | ----- |
| Package framework `@nodefony/*` | `src/packages/@nodefony/{name}/` | Composant réutilisable, faisant partie du framework |
| Module applicatif | `src/modules/{name}/` | Module d'app, démo, test, non publié séparément |

### Q3 — Options à activer (multiSelect)

- `Commands CLI` (ex: `nodefony foo:start`) — ajoute `nodefony/command/` + addCommand
- `Controllers HTTP` (ex: `@controller("/foo")`) — ajoute `nodefony/controller/` + `@controllers([...])` + peer `@nodefony/framework` et `@nodefony/http`
- `Service injectable principal` (recommandé par défaut) — ajoute `nodefony/service/FooService.ts` + `@services([FooService])`
- `Entities ORM` — ajoute `nodefony/entity/` + peer `@nodefony/sequelize` (ou mongoose selon config)
- `Frontend Vite` — ajoute `frontend/`, peer `@nodefony/frontend`, déclaration `registerEntry` dans `onKernelBoot`

### Q4 — Ajouter au `@modules([...])` racine ?

> "Activer le module dans index.ts racine maintenant ? (oui = ajouté tout de suite et utilisable au prochain build)"

Si oui : éditer `/Users/cci/repository/nodefony-core/index.ts` pour ajouter le nom du module dans le décorateur `@modules([...])` (ordre important : packages framework AVANT modules applicatifs ; un consumer DOIT être après le module qu'il consomme).

## Étapes d'exécution

### 1. Vérifications préalables

- Vérifier que le chemin cible n'existe pas déjà : `ls src/packages/@nodefony/{name}/` doit faillir.
- Si le module existe → ne PAS l'écraser, demander à l'user (overwrite ? nom différent ?).

### 2. Création arborescence

```bash
# Package framework
mkdir -p src/packages/@nodefony/{name}/nodefony/{config,interfaces,service,src/errors}

# Avec commands CLI
mkdir -p src/packages/@nodefony/{name}/nodefony/command

# Avec controllers
mkdir -p src/packages/@nodefony/{name}/nodefony/controller

# Avec entities
mkdir -p src/packages/@nodefony/{name}/nodefony/entity

# Avec frontend
mkdir -p src/packages/@nodefony/{name}/frontend/src
```

### 3. Génération des fichiers (utiliser Write tool — templates ci-dessous)

Variables à remplacer dans tous les templates :
- `{{name}}` → nom court (ex: `foo`)
- `{{NameClass}}` → PascalCase (ex: `Foo`)
- `{{NAME_UPPER}}` → upper (ex: `FOO`) — utilisé seulement dans error codes
- `{{description}}` → 1 ligne fournie par l'user (fallback : `"Nodefony {{name}} module"`)
- `{{path_dir}}` → `src/packages/@nodefony/{{name}}` ou `src/modules/{{name}}`
- `{{peer_deps}}` → JSON object selon options activées
- `{{peer_dev_types}}` → liste @types/* devDependencies selon options

### 4. Build du module

```bash
npm run build --workspace={{path_dir}} 2>&1 | tail -5
```

Vérifier qu'il n'y a PAS de `error TS[0-9]+` (les warnings TS7016 sur `rollup-sourcemap-path-transform` sont attendus et acceptables).

### 5. Optionnel — activation dans @modules racine

Si l'user a dit oui à Q4 :

```typescript
// index.ts racine — éditer la liste @modules([...])
@modules([
  "@nodefony/sequelize",
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/security",
  "@nodefony/test",
  "@nodefony/{{name}}",  // ← ajouté ici
])
```

Re-build : `npm run build 2>&1 | tail -5`. Si OK, mentionner à l'user que le module est utilisable au prochain `npx nodefony development`.

### 6. Reporter à l'user

Format court :
```
Module @nodefony/{{name}} créé.
  - {{path_dir}}/
  - Build OK (X.Xs)
  - Activé dans @modules racine : oui/non
  - Services : [...], Commands : [...], Controllers : [...]
```

---

## Templates des fichiers à générer

> ⚠️ Tous les templates suivent les conventions figées dans `CLAUDE.md` racine du projet
> (TypeScript strict, ESM-only, named exports, `node:` prefix, interfaces préfixées `I`,
> emitDecoratorMetadata + experimentalDecorators, declarationDir = `./dist/types`).

### `package.json`

```json
{
  "name": "@nodefony/{{name}}",
  "version": "10.0.0-alpha.1",
  "description": "{{description}}",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "rimraf dist && npm run rollup",
    "rollup": "npx rollup --config ./rollup.config.ts --configPlugin typescript",
    "dev": "rimraf dist && npm run rollup -- --watch",
    "clean": "rimraf dist",
    "test": "mocha",
    "coverage": "mcr -c mcr.config.js npm run test",
    "lint": "tsc --noEmit"
  },
  "keywords": ["nodefony", "typescript"],
  "peerDependencies": {{peer_deps}},
  "devDependencies": {
    "@rollup/plugin-json": "6.1.0",
    "@rollup/plugin-node-resolve": "16.0.3",
    "@rollup/plugin-typescript": "12.3.0",
    "@types/mocha": "10.0.10",
    "@types/node": "25.8.0",
    "chai": "6.2.2",
    "mocha": "11.7.5",
    "monocart-coverage-reports": "2.12.11",
    "rimraf": "6.1.3",
    "rollup": "4.60.4",
    "rollup-sourcemap-path-transform": "1.2.0",
    "ts-node": "10.9.2",
    "tslib": "2.8.1",
    "typescript": "6.0.3"
  },
  "private": true,
  "license": "CECILL-B"
}
```

**peer_deps selon options activées** :
```json
{
  "nodefony": "*",
  // si controllers :
  "@nodefony/http": "*",
  "@nodefony/framework": "*",
  // si entities :
  "@nodefony/sequelize": "*",
  // si frontend :
  "@nodefony/frontend": "*"
}
```

### `mcr.config.js` (coverage — convention universelle)

Tout module embarque un coverage `monocart-coverage-reports` (= core ; **jamais c8**, KO en ESM/Node récent). Lancé par `npm run coverage`. Remplacer `<module>` par le nom du package (`@nodefony/<x>` ou `modules/<x>`).

```js
// Couverture du module — `npm run coverage` (mcr wrappe la suite unit in-process).
// ⚠️ Les tests d'INTÉGRATION (test:integration) tapent un serveur dans un process
// SÉPARÉ → non couverts par le wrapping mocha. Seule la suite unit est mesurée.
// ⚠️ ts-node mappe mal le V8 coverage (monocart ne résout qu'une partie des
// sourcemaps) → pour un % FIABLE, faire tourner les unit tests sous `tsx`
// (comme le core src/nodefony), pas ts-node. Voir mémoire feedback_coverage_modules.
const inModule = (url) =>
  typeof url === "string" &&
  url.includes("/<module>/") &&
  !url.includes("/node_modules/") &&
  !url.includes("/dist/");

export default {
  name: "<module>",
  reports: ["console-summary", "v8", "lcov"],
  outputDir: ".coverage",
  entryFilter: (e) => inModule(e && e.url ? e.url : String(e)),
  sourceFilter: (p) =>
    typeof p === "string" && p.endsWith(".ts") &&
    p.includes("/<module>/") &&
    !p.includes("/node_modules/") && !p.includes("/tests/") && !p.includes("/dist/"),
};
```

> `.coverage/` doit être gitignored (rapport HTML/lcov généré).

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "rootDir": "./",
    "outDir": "./dist",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "target": "ES2022",
    "module": "ESNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "stripInternal": true,
    "declaration": true,
    "declarationDir": "./dist/types",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["node"]
  },
  "include": ["index.ts", "rollup.config.ts", "nodefony/**/*.ts"],
  "exclude": ["node_modules", "dist", "nodefony/tests"]
}
```

⚠️ **Piège TS7060** : si tu ajoutes `"jsx": "preserve"` dans `compilerOptions` (cas frontend),
NE PAS retirer `"declaration": true` — sinon Rollup râle avec TS5069 sur `declarationDir`.

⚠️ **Piège TS2565** : NE JAMAIS redéclarer `options: FooConfig;` comme propriété de classe
dans un Service custom — le parent l'initialise déjà. Stocker la config typée dans un
field séparé `cfg: FooConfig` (voir template Service).

### `rollup.config.ts`

```typescript
import path, { resolve } from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import { createPathTransform } from "rollup-sourcemap-path-transform";
import { globSync } from "glob";

const sourcemapPathTransform = createPathTransform({
  prefixes: {
    "*src/": `${resolve(".", "nodefony", "src")}/`,
    "*service/": `${resolve(".", "nodefony", "service")}/`,
    "*command/": `${resolve(".", "nodefony", "command")}/`,
    "*controller/": `${resolve(".", "nodefony", "controller")}/`,
    "*entity/": `${resolve(".", "nodefony", "entity")}/`,
    "*interfaces/": `${resolve(".", "nodefony", "interfaces")}/`,
    "*config/": `${resolve(".", "nodefony", "config")}/`,
  },
});

const external: string[] = [
  "nodefony",
  // Ajouter selon peer_deps :
  // "@nodefony/http",
  // "@nodefony/framework",
  // "@nodefony/sequelize",
  // "@nodefony/frontend",
  "tslib",
];

const nodefonyFiles = globSync("nodefony/**/*.ts", {
  ignore: ["**/*.d.ts", "**/*.spec.ts", "**/*.test.ts", "**/tests/**"],
});

const input = {
  index: "./index.ts",
  ...Object.fromEntries(
    nodefonyFiles.map((file) => [
      path.relative(".", file).replace(/\.ts$/, ""),
      "./" + file,
    ]),
  ),
};

const sharedNodeOptions = defineConfig({
  treeshake: {
    moduleSideEffects: "no-external",
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
  output: {
    dir: resolve(".", "dist"),
    entryFileNames: `[name].js`,
    exports: "auto",
    format: "es",
  },
  onwarn(warning, warn) {
    if (warning.message.includes("Circular dependency")) return;
    if (warning.message.includes("TS5055")) return;
    warn(warning);
  },
});

function createNodePlugins(
  _isProduction: boolean,
  sourceMap: boolean,
  declarationDir: string | false,
): Plugin[] {
  return [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve("tsconfig.json"),
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined,
    }),
    json(),
  ];
}

function createNodeConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    input,
    ...sharedNodeOptions,
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: ".",
      sourcemapPathTransform,
    },
    external: (id) =>
      id !== "." &&
      external.some(
        (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
      ),
    plugins: [...createNodePlugins(isProduction, !isProduction, "dist/types")],
  });
}

export default (commandLineArgs: Record<string, unknown>): RollupOptions => {
  const isDev = Boolean(commandLineArgs.watch);
  return createNodeConfig(!isDev);
};
```

⚠️ **External exact-match obligatoire** : la fonction `external` doit utiliser
`id === e || (e !== "nodefony" && id.startsWith(e + "/"))` — sinon `"nodefony"` matche
TOUS les chunks `nodefony/foo/bar.js` produits par `preserveModules`.

### `index.ts` — Module class

```typescript
/**
 * @nodefony/{{name}} — {{description}}
 *
 * Voir `CLAUDE.md` du module pour les décisions d'archi figées
 * et `MEMORY.md` pour les internals IA.
 */
import { Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import {{NameClass}}Service from "./nodefony/service/{{NameClass}}Service";
// ↓ si commands :
// import {{NameClass}}Command from "./nodefony/command/{{name}}-command";
// ↓ si controllers :
// import { controllers } from "@nodefony/framework";
// import {{NameClass}}Controller from "./nodefony/controller/{{NameClass}}Controller";

@services([{{NameClass}}Service])
// ↓ si controllers :
// @controllers([{{NameClass}}Controller])
class {{NameClass}} extends Module {
  constructor(kernel: Kernel) {
    super("{{name}}", kernel, import.meta.url, config);
    // ↓ si commands :
    // this.addCommand({{NameClass}}Command);
  }

  override async onKernelReady(): Promise<this> {
    return this;
  }
}

export default {{NameClass}};
export { {{NameClass}} };

// Service injectable.
export { {{NameClass}}Service };

// Interfaces publiques.
export type { I{{NameClass}}Service } from "./nodefony/interfaces/I{{NameClass}}Service";
export type { {{NameClass}}Config } from "./nodefony/config/config";

// Erreurs.
export {
  {{NameClass}}Error,
} from "./nodefony/src/errors/{{NameClass}}Error";
```

### `nodefony/config/config.ts`

```typescript
/**
 * NODEFONY FRAMEWORK — Configuration DEFAULT de `@nodefony/{{name}}`.
 *
 * Toutes les valeurs ici sont des DEFAULTS. Pour surcharger côté app, utiliser
 * la clé `module-{{name}}` dans le `config.ts` racine, ou la prop `module.options`
 * du module consumer dans son propre `config.ts`.
 *
 * Documente chaque option en français avec valeur défaut + reco prod + exemple
 * de surcharge (voir `@nodefony/http/nodefony/config/config.ts` comme référence).
 */
const config = {
  /**
   * Active le service principal au boot.
   * Recommandation prod : `true`.
   */
  enabled: true,
};

export default config;
export type {{NameClass}}Config = typeof config;
```

### `nodefony/interfaces/I{{NameClass}}Service.ts`

```typescript
/**
 * API publique du service `{{NameClass}}Service` (injectable, name="{{name}}").
 */
export interface I{{NameClass}}Service {
  /** Snapshot lecture — état courant du service. */
  status(): { ready: boolean };
}
```

### `nodefony/interfaces/index.ts`

```typescript
export type { I{{NameClass}}Service } from "./I{{NameClass}}Service";
```

### `nodefony/service/{{NameClass}}Service.ts`

```typescript
import {
  Service,
  Module,
  Container,
  Event,
  extend,
  injectable,
} from "nodefony";
import type { I{{NameClass}}Service } from "../interfaces/I{{NameClass}}Service";
import defaultConfig, { type {{NameClass}}Config } from "../config/config";

/**
 * Service injectable principal du module `@nodefony/{{name}}`.
 *
 * Pattern :
 *  1. constructor : merge defaults + module.options
 *  2. initialize : enregistre les listeners kernel (onReady, onTerminate, etc.)
 *  3. méthodes métier
 *
 * ⚠️ NE JAMAIS redéclarer `options: {{NameClass}}Config;` comme propriété — le parent
 * Service l'assigne déjà via le 4ème argument du super(). Utiliser `cfg` pour
 * l'accès typé sans TS2565 (`used before assigned`).
 */
@injectable()
class {{NameClass}}Service extends Service implements I{{NameClass}}Service {
  module: Module;
  private readonly cfg: {{NameClass}}Config;

  constructor(module: Module) {
    const merged = extend(
      true,
      {},
      defaultConfig,
      module.options ?? {},
    ) as {{NameClass}}Config;
    super(
      "{{name}}",
      module.container as Container,
      module.notificationsCenter as Event,
      merged,
    );
    this.module = module;
    this.cfg = merged;
  }

  async initialize(): Promise<this> {
    this.log(`{{name}} service init`, "DEBUG");
    this.kernel?.once("onReady", async () => {
      if (this.cfg.enabled) {
        this.log("{{name}} ready", "INFO");
      }
    });
    return this;
  }

  status(): { ready: boolean } {
    return { ready: this.cfg.enabled };
  }
}

export default {{NameClass}}Service;
```

### `nodefony/src/errors/{{NameClass}}Error.ts`

```typescript
/**
 * Erreur de base pour @nodefony/{{name}}.
 *
 * - `code` : identifiant machine, consommé par Vision et l'audit-logger.
 * - `context` : payload structuré pour le PDU syslog.
 */
export class {{NameClass}}Error extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "{{NameClass}}Error";
  }
}
```

### `nodefony/command/{{name}}-command.ts` (si Commands CLI)

```typescript
import {
  OptionsCommandInterface,
  CliKernel,
  Command,
} from "nodefony";
import type {{NameClass}}Service from "../service/{{NameClass}}Service";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onReady",
};

/**
 * `nodefony {{name}}:status` — exemple de commande CLI.
 */
class {{NameClass}}Command extends Command {
  constructor(cli: CliKernel) {
    super("{{name}}:status", "Show {{name}} service status", cli, options);
    this.addOption("-j, --json", "output as JSON");
  }

  override async generate(
    _arg: string,
    opts: { json: boolean },
  ): Promise<this> {
    const svc = this.kernel?.container?.get("{{name}}") as
      | {{NameClass}}Service
      | undefined;
    if (!svc) {
      this.log("service `{{name}}` not registered", "ERROR");
      return this;
    }
    const st = svc.status();
    if (opts.json) {
      process.stdout.write(JSON.stringify(st, null, 2) + "\n");
    } else {
      console.log(`{{name}} service status:`, st);
    }
    return this;
  }
}

export default {{NameClass}}Command;
```

### `nodefony/controller/{{NameClass}}Controller.ts` (si Controllers HTTP)

```typescript
/// <reference types="node" />
import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";

/**
 * Controller {{NameClass}} — préfixe `/nodefony/{{name}}/*` (conv. Vision Phase 10).
 */
@controller("/nodefony/{{name}}")
class {{NameClass}}Controller extends Controller {
  constructor(context: Context) {
    super("{{NameClass}}Controller", context);
  }

  @route("{{name}}-index", { path: "" })
  index(): unknown {
    return this.renderJson({ module: "{{name}}", ok: true });
  }

  // Endpoint Vision (Phase 10) — état du module pour l'API admin.
  @route("{{name}}-api-status", { path: "/api/status" })
  apiStatus(): unknown {
    return this.renderJson({ module: "{{name}}", ts: Date.now() });
  }
}

export default {{NameClass}}Controller;
```

### `CLAUDE.md`

```markdown
# CLAUDE.md — @nodefony/{{name}}

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (gotchas, config, internals)
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet

## Rôle du module

{{description}}

## Structure des fichiers

\`\`\`
src/packages/@nodefony/{{name}}/
├── index.ts                            ← class {{NameClass}} (Module) + exports publics
├── package.json
├── rollup.config.ts                    ← bundler — NE PAS MODIFIER sans accord
├── tsconfig.json                       ← NE PAS MODIFIER sans accord
├── CLAUDE.md / MEMORY.md / README.md
└── nodefony/
    ├── config/config.ts                ← config DEFAULT (commentée en français)
    ├── interfaces/I{{NameClass}}Service.ts
    ├── service/{{NameClass}}Service.ts ← @injectable, name="{{name}}"
    ├── (command/ / controller/ / entity/ selon options)
    └── src/errors/{{NameClass}}Error.ts
\`\`\`

## Décisions techniques figées

| Sujet              | Décision                                       |
| ------------------ | ---------------------------------------------- |
| Service name DI    | `"{{name}}"` (container.get("{{name}}"))       |
| Errors             | extends `{{NameClass}}Error` (code + context)  |
| Config             | typée via `{{NameClass}}Config` (cfg field)    |
| Logs               | via `this.log(msg, "INFO|DEBUG|WARNING|ERROR|CRITIC")` |

## Pipeline (cycle de vie)

\`\`\`
constructor(module)
  └─ extend(defaults, module.options) → cfg
  └─ super("{{name}}", container, event, merged)

initialize()
  └─ kernel.once("onReady", ...) → setup listeners

onKernelTerminate
  └─ cleanup (close handles, kill children, etc.)
\`\`\`

## Gotchas

- **NE JAMAIS** redéclarer `options: {{NameClass}}Config;` dans la classe — utiliser le field `cfg` (sinon TS2565)
- `container.get("{{name}}")` utilise le name passé à `super()`, PAS le className
- `Service.options` typage parent = `any` → cast à l'usage OU utiliser `cfg`
- Tout nouveau fichier test `.ts` doit avoir `/// <reference types="node" />` en première ligne

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` ou `tsconfig.json`
- Ajouter `dependencies` directes (préférer `peerDependencies`)
- Importer `@nodefony/framework` depuis un module qui peut être consommé par framework (cycle)

## Roadmap

| Étape | Statut | Description |
| ----- | ------ | ----------- |
| MVP   | ⏳     | Squelette + service basique + erreurs typées |
| ...   | ⏳     | À compléter |
```

### `MEMORY.md`

```markdown
# MEMORY.md — @nodefony/{{name}}

Purpose: {{description}}

## Core Components

- `{{NameClass}}` (Module class) — declared services: [{{NameClass}}Service].
- `{{NameClass}}Service` — @injectable, name="{{name}}". `container.get("{{name}}")`.
- `{{NameClass}}Error` — base error (code + context).

## Config DEFAULTS

\`\`\`ts
{
  enabled: true,
}
\`\`\`

## Pipeline

1. constructor : merge defaults + module.options → cfg
2. initialize : `kernel.once("onReady", ...)`
3. (méthodes métier)
4. onTerminate : cleanup

## Behaviors

- `this.cfg` est typé `{{NameClass}}Config`, `this.options` est la même chose côté parent (any).
- Service name DI : `"{{name}}"` — utilisé par `container.get()`.

## Gotchas

- Redéclaration `options: Config` interdite (TS2565). Stocker dans `cfg`.
- `declarationDir` requiert `declaration: true` (TS5069).
- ANSI codes dans logs externes : strip via `/\x1b\[[0-9;]*m/g`.

## API Vision (route /nodefony/{{name}}/* — Phase 10)

- GET /nodefony/{{name}}/api/status → JSON status
- (à étendre)
```

### `README.md`

```markdown
# @nodefony/{{name}}

{{description}}

## Installation

Workspace npm — déjà inclus dans nodefony-core. Ajouter au `@modules([])` de
votre `index.ts` racine pour l'activer :

\`\`\`typescript
@modules([
  // ...
  "@nodefony/{{name}}",
])
\`\`\`

## Usage

\`\`\`typescript
import { Nodefony } from "nodefony";
import type { {{NameClass}}Service } from "@nodefony/{{name}}";

const svc = Nodefony.getKernel().container.get("{{name}}") as {{NameClass}}Service;
console.log(svc.status());
\`\`\`

## Configuration

Surcharger les defaults via la clé `module-{{name}}` dans le config racine :

\`\`\`typescript
const config = {
  // ...
  "module-{{name}}": {
    enabled: true,
  },
};
\`\`\`

## API

| Méthode | Description |
| ------- | ----------- |
| `status()` | Snapshot lecture — état du service |

## License

CECILL-B
```

---

## Validation finale

Après génération :

1. **Build du module** : `npm run build --workspace={{path_dir}}`
2. **Vérifier 0 erreur TS** (warnings TS7016 rollup-sourcemap acceptables)
3. **Si activé dans @modules racine** : `npm run build` full + check qu'aucun workspace ne casse
4. **Reporter à l'user** le statut + chemins créés

## Pièges connus à éviter

| Piège | Symptôme | Fix |
| ----- | -------- | --- |
| `options: Config` redéclaré dans Service | TS2565 "Property 'options' is used before being assigned" | Utiliser `private readonly cfg: Config` field |
| `declarationDir` sans `declaration` | TS5069 | Soit garder les 2, soit retirer les 2 |
| `external: ["nodefony"]` non exact-match | "nodefony" matche tous chunks `nodefony/...` | `id === e \|\| (e !== "nodefony" && id.startsWith(e + "/"))` |
| Service `name` ≠ className | `container.get("ClassName")` retourne undefined | Utiliser le name passé à super() |
| ANSI dans stdout child | regex match foire | strip via `/\x1b\[[0-9;]*m/g` |
| `npx command &` meurt SIGHUP | process detached die | spawn `detached: true` + `child.unref()` |
| `path.resolve(root, "./frontend/src/main.tsx")` quand root déjà absolu | `frontend/frontend/...` doublé | Stocker entryFile relatif au root (`path.relative(root, abs)`) |
| Activation `@modules` dans le mauvais ordre | service non trouvé au consumer | Frontend AVANT son consumer ; framework/http AVANT modules qui les utilisent |
| Forgot `/// <reference types="node" />` | TS errors sur globals Node | Première ligne des fichiers test |

## Exemples concrets de modules créés

- `@nodefony/llm` : service unique (LLMService) + providers + erreurs typées (référence "simple")
- `@nodefony/http` : commands CLI + interfaces étoffées + service complexe (référence "complete backend")
- `@nodefony/frontend` : commands + service + 1 supervisor + 1 builder + presets (référence "avec extension points")
- `@nodefony/test-frontend-react` (POC) : module applicatif avec controllers + frontend (référence `src/modules/`)

Tous dans `src/packages/@nodefony/` ou `src/modules/`. Lire AVANT de générer un module similaire pour calquer le pattern exact.
