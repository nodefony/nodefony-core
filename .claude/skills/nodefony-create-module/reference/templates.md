# Templates — nodefony-create-module

> Fichiers générés par l'étape 3 du scaffold (voir `SKILL.md`).
> Variables à substituer : `{{name}}`, `{{NameClass}}`, `{{NAME_UPPER}}`, `{{description}}`,
> `{{path_dir}}`, `{{peer_deps}}`, `{{peer_dev_types}}` — résolution décrite dans SKILL.md étape 3.

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
    "test": "vitest run",
    "coverage": "vitest run --coverage",
    "lint": "tsc --noEmit"
  },
  "keywords": ["nodefony", "typescript"],
  "peerDependencies": {{peer_deps_with_zod}},
  "devDependencies": {
    "@rollup/plugin-json": "6.1.0",
    "@rollup/plugin-node-resolve": "16.0.3",
    "@rollup/plugin-typescript": "12.3.0",
    "@types/node": "25.8.0",
    "@vitest/coverage-v8": "4.1.7",
    "rimraf": "6.1.3",
    "rollup": "4.60.4",
    "rollup-sourcemap-path-transform": "1.2.0",
    "tslib": "2.8.1",
    "typescript": "6.0.3",
    "vitest": "4.1.7"
  },
  "private": true,
  "license": "CECILL-B"
}
```

**peer_deps_with_zod selon options activées** :

```json
{
  "nodefony": "*",
  // ⭐ TOUJOURS : zod = validation runtime du schéma de config au boot (convention figée
  // 2026-05-28, cf [[feedback_config_validation_zod]]). Version alignée avec security 4.4.3.
  "zod": "^4.4.3",
  // si controllers :
  "@nodefony/http": "*",
  "@nodefony/framework": "*",
  // si entities :
  "@nodefony/sequelize": "*",
  // si frontend :
  "@nodefony/frontend": "*"
}
```

### Tests + coverage = **vitest** (convention universelle)

Tout module utilise **`vitest` + `@vitest/coverage-v8`** (ESM-natif ; **jamais c8** KO ESM/Node, et **pas monocart+mocha+tsx** qui casse dès qu'un test importe un dist Rollup — `mcr --require` bascule en CJS, cf [[feedback_coverage_modules]]). Studio lit `.coverage/coverage-summary.json` (onglet Coverage).

devDeps (déjà dans le `package.json` ci-dessus) : `vitest` + `@vitest/coverage-v8`. Scripts :

```jsonc
"test": "vitest run",
"coverage": "vitest run --coverage",
// intégration (si serveur requis) reste en ts-node mocha :
"test:integration": "TS_NODE_PROJECT=tsconfig.tests.json mocha --config .mocharc.integration.json"
```

**Tests fraîchement scaffoldés** = `node:assert` + `describe`/`it` en **globals** (aucun import mocha) → la config MINIMALE ci-dessous suffit (réf. réelles : `@nodefony/orm-core`, `@nodefony/user`) :

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts"], // ou "nodefony/tests/unit/**" selon l'emplacement
    coverage: {
      provider: "v8",
      include: ["index.ts", "nodefony/**/*.ts"],
      // interfaces/contracts = type-only (effacés à la compil) → hors métrique
      exclude: [
        "nodefony/interfaces/**",
        "nodefony/contracts/**",
        "**/*.d.ts",
        "**/dist/**",
      ],
      reporter: ["text", "text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
});
```

**Ajouts CONDITIONNELS** (ne PAS mettre par défaut — réservés au portage de modules type framework/http) :

- **décorateurs** (DI reflect) → `setupFiles: [r("./.../vitest.setup.ts")]` avec `import "reflect-metadata"` (+ `g.before ??= beforeAll` pour compat mocha). _orm-core n'en a PAS besoin (décorateurs WeakMap, sans reflect)._
- **tests mocha existants** `import "mocha"` → `resolve.alias.mocha = r("./.../vitest-mocha-shim.mjs")` (`export {};`).
- **import d'un ORM hors kernel** qui crashe → `resolve.alias["@nodefony/sequelize"|"mongoose"]` vers des stubs.

> **JAMAIS c8** (KO ESM/Node) ni **monocart+mocha+tsx** (`mcr --require` → CJS, sous-mappe le TS, lignes faussées — cf [[feedback_coverage_modules]]). vitest mappe le source TS proprement. `.coverage/` est gitignored ; Studio lit `.coverage/coverage-summary.json` OU `lcov.info`. Seul le **core** (`src/nodefony`) reste sur monocart (source pur sans dist importé).

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
import { {{name}}ConfigSchema } from "./nodefony/config/schema";
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

  /**
   * Validation Zod de la config racine merge au boot (convention figée 2026-05-28,
   * cf [[feedback_config_validation_zod]]). Plante propre avec messages clairs si
   * la config (defaults + module.options) n'est pas conforme au schéma — évite tous
   * les `undefined.x` silencieux en runtime.
   */
  override async onKernelRegister(): Promise<this> {
    const parsed = {{name}}ConfigSchema.safeParse(this.options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join(" · ");
      throw new Error(`[@nodefony/{{name}}] Invalid config: ${issues}`);
    }
    return this;
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

### `nodefony/config/schema.ts` — schéma Zod (source de vérité)

> Convention figée 2026-05-28 (cf [[feedback_config_validation_zod]]) : tout module Nodefony
> qui expose une config DOIT avoir un schéma Zod. Validé au boot du Module class (hook
> `onKernelRegister`) → plante propre avec messages clairs si la config racine est invalide.
> Pas de `undefined.x` silencieux en runtime. Source de vérité = schéma (TS type dérivé via
> `z.infer<>`, pas l'inverse). Pattern de référence : `defineSecurityConfig.ts`.

```typescript
import { z } from "zod";

/**
 * Schéma Zod de la configuration de @nodefony/{{name}}.
 *
 * Chaque champ porte `.describe()` pour :
 *  - messages d'erreur explicites au boot,
 *  - introspection Studio (futur form auto-généré via `{{name}}ConfigJsonSchema()`).
 *
 * Pattern enrichi à terme : voir `defineSecurityConfig.ts` (12 sections groupées par
 * préoccupation, chaque défense `enabled` togglable, défauts SÛRS).
 */
export const {{name}}ConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Active le module {{name}} au boot. Recommandation prod : true. " +
          "false = module chargé mais inerte (logs, registry, mais aucun listener actif).",
      ),
  })
  .describe("Configuration de @nodefony/{{name}}.");

export type {{NameClass}}Config = z.infer<typeof {{name}}ConfigSchema>;

/**
 * (Optionnel — à coder quand Studio aura besoin du form auto-généré.) Renvoie le JSON
 * Schema dérivé du schéma Zod pour qu'un consommateur (Studio) génère une UI d'édition.
 * Voir `securityConfigJsonSchema()` pour le pattern complet (z.toJSONSchema).
 */
// export function {{name}}ConfigJsonSchema(): Record<string, unknown> {
//   return z.toJSONSchema({{name}}ConfigSchema);
// }
```

### `nodefony/config/config.ts` — défauts dérivés du schéma

```typescript
/**
 * NODEFONY FRAMEWORK — Configuration DEFAULT de `@nodefony/{{name}}`.
 *
 * Source de vérité = `./schema.ts` (Zod). Ce fichier expose les défauts dérivés
 * via `{{name}}ConfigSchema.parse({})` — utile pour le `super(..., config)` du
 * Module class (toujours valide par construction).
 *
 * Surcharge côté app : clé `module-{{name}}` dans le `config.ts` racine, ou prop
 * `module.options` du module consumer. La fusion + validation finale est faite
 * dans `index.ts` au hook `onKernelRegister` (plante propre si invalide).
 *
 * ⚠️ NE PAS éditer les valeurs ici à la main : modifier les `.default(...)` du
 * schéma, pas ce fichier.
 */
import { {{name}}ConfigSchema, type {{NameClass}}Config } from "./schema";

const config: {{NameClass}}Config = {{name}}ConfigSchema.parse({});

export default config;
export type { {{NameClass}}Config };
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
 * - `code` : identifiant machine, consommé par Studio et l'audit-logger.
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
 * Controller {{NameClass}} — préfixe `/nodefony/{{name}}/*` (conv. Studio Phase 10).
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

  // Endpoint Studio (Phase 10) — état du module pour l'API admin.
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
├── index.ts ← class {{NameClass}} (Module) + exports publics
├── package.json
├── rollup.config.ts ← bundler — NE PAS MODIFIER sans accord
├── tsconfig.json ← NE PAS MODIFIER sans accord
├── CLAUDE.md / MEMORY.md / README.md
└── nodefony/
├── config/config.ts ← config DEFAULT (commentée en français)
├── interfaces/I{{NameClass}}Service.ts
├── service/{{NameClass}}Service.ts ← @injectable, name="{{name}}"
├── (command/ / controller/ / entity/ selon options)
└── src/errors/{{NameClass}}Error.ts
\`\`\`

## Décisions techniques figées

| Sujet           | Décision                                      |
| --------------- | --------------------------------------------- | ----- | ------- | ----- | --------- |
| Service name DI | `"{{name}}"` (container.get("{{name}}"))      |
| Errors          | extends `{{NameClass}}Error` (code + context) |
| Config          | typée via `{{NameClass}}Config` (cfg field)   |
| Logs            | via `this.log(msg, "INFO                      | DEBUG | WARNING | ERROR | CRITIC")` |

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

| Étape | Statut | Description                                  |
| ----- | ------ | -------------------------------------------- |
| MVP   | ⏳     | Squelette + service basique + erreurs typées |
| ...   | ⏳     | À compléter                                  |
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

## API Studio (route /nodefony/{{name}}/\* — Phase 10)

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

| Méthode    | Description                        |
| ---------- | ---------------------------------- |
| `status()` | Snapshot lecture — état du service |

## License

CECILL-B
```

### `docs/index.md` — vue d'ensemble (surfacée dans Studio /nodefony/modules/{{name}})

> **Pourquoi un `docs/` en plus du `README.md`** : le `README.md` cible humain/npm/GitHub
> (court). `docs/` cible la doc dev/utilisateur étendue, **lue directement dans Studio**
> via `/nodefony/modules/{{name}}` (onglet « Docs » alimenté par
> `/nodefony/kernel/api/module/{{name}}/docs`). Convention figée : 2 fichiers minimum à la
> création (`index.md` + `architecture.md`) pour que tout module naisse avec sa structure
> doc et soit visible dans Studio dès le 1er commit. Voir le pattern complet sur
> `@nodefony/realtime/docs/` (session 2026-05-28).
>
> **Frontmatter Studio-friendly OBLIGATOIRE** (extrait par `docsReader.ts` + filtre persona
> Studio via bitmask rôles) :
>
> - `slug` — unique dans le module, format `{{name}}/<page>` ;
> - `title` — affiché dans la sidebar Studio ;
> - `section` — groupe (les pages d'un même `section` apparaissent ensemble) ;
> - `audience` — CSV des personas Studio (`developer,architect,devops,supervisor,admin`).
>   **Mettre les 5 par défaut** : la pédagogie ne se réserve pas, et le bitmask permet de
>   switcher (cf [[feedback_studio_layout_rigor]]) ;
> - `version` — bump à chaque grosse révision (`v0.1` à la création) ;
> - `status` — `draft` à la création, → `stable` quand contenu complet ;
> - `updated` — date ISO `YYYY-MM-DD` (à mettre à jour à chaque edit) ;
> - `source` — chemin relatif au repo, pour le futur lien « Edit on GitHub ».

````markdown
---
slug: {{name}}/index
title: "@nodefony/{{name}} — vue d'ensemble dev"
section: {{name}}
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: YYYY-MM-DD
source: src/packages/@nodefony/{{name}}/docs/index.md
module: "@nodefony/{{name}}"
topic: overview
tags: [nodefony, {{name}}]
---

# @nodefony/{{name}} — vue d'ensemble dev

> {{description}}
>
> Cette page est la **doc dev étendue**, lue dans Studio
> (`/nodefony/modules/{{name}}` → onglet « Docs »). Le `README.md` à côté est volontairement
> plus court et cible npm/GitHub.

## Table des matières

| Page                                   | Quoi                              |
| -------------------------------------- | --------------------------------- |
| [`index.md`](./index.md) (cette page)  | Vue d'ensemble + cible DX         |
| [`architecture.md`](./architecture.md) | Architecture, contrats, internals |

## Promesse en 1 phrase

> _<à remplir — quelle est la cible DX de ce module ? que voit l'utilisateur qui l'importe ?>_

## Ce que tu écris dans ton app (cible)

```typescript
// _<exemple minimal d'usage — server + client si pertinent>_
```
````

## Ce que tu n'écris JAMAIS

- _<choses cachées par l'abstraction du module>_

## État actuel

| Couche        | État         | Notes    |
| ------------- | ------------ | -------- |
| _<composant>_ | ✅ / 🔶 / ⬜ | _<note>_ |

## Liens

- 📐 **Décisions d'archi figées** : [`../CLAUDE.md`](../CLAUDE.md)
- 🤖 **Internals IA** : [`../MEMORY.md`](../MEMORY.md)
- 📦 **Doc humain courte** : [`../README.md`](../README.md)
- 🏛️ **Architecture détaillée** : [`./architecture.md`](./architecture.md)

````

### `docs/architecture.md` — squelette d'architecture

```markdown
---
slug: {{name}}/architecture
title: "Architecture — @nodefony/{{name}}"
section: {{name}}
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: YYYY-MM-DD
source: src/packages/@nodefony/{{name}}/docs/architecture.md
module: "@nodefony/{{name}}"
topic: architecture
tags: [nodefony, {{name}}, architecture]
---

# Architecture — @nodefony/{{name}}

> Cette page décrit **comment le module est construit à l'intérieur** : les briques, leurs
> responsabilités, ce qui les sépare. À lire avant de toucher au code source.

## Vue d'oiseau

````

_<schéma ASCII ou mermaid de la structure interne — qui appelle qui>_

```

## Briques principales

| Brique | Rôle | Fichier |
|--------|------|---------|
| `{{NameClass}}` | Module class (entry point) | `index.ts` |
| `{{NameClass}}Service` | Service injectable principal | `nodefony/service/{{NameClass}}Service.ts` |
| `{{NameClass}}Error` | Erreur typée (code + context) | `nodefony/src/errors/{{NameClass}}Error.ts` |

## Cycle de vie

1. **constructor(module)** : merge defaults + `module.options` → `cfg`.
2. **initialize()** : enregistre les listeners kernel (`onReady`, `onTerminate`).
3. **(méthodes métier)** : appelées par les consumers via `container.get("{{name}}")`.
4. **onTerminate** : cleanup (close handles, kill children).

## Contrats publics

- _<lister les interfaces exposées dans `nodefony/interfaces/`>_

## Décisions figées

| Sujet | Décision | Pourquoi |
|-------|----------|----------|
| _<sujet>_ | _<décision>_ | _<raison>_ |

## Liens

- [`./index.md`](./index.md) — vue d'ensemble dev
- [`../CLAUDE.md`](../CLAUDE.md) — décisions d'archi figées
- [`../MEMORY.md`](../MEMORY.md) — internals IA
```
