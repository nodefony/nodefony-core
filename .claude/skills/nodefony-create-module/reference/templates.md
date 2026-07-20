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
      "types": "./dist/types/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "rimraf dist && rolldown -c rolldown.config.ts && tsgo -p tsconfig.declarations.json",
    "dev": "rolldown -c rolldown.config.ts --watch",
    "clean": "rimraf dist",
    "test": "vitest run",
    "coverage": "vitest run --coverage",
    "lint": "tsgo --noEmit"
  },
  "keywords": ["nodefony", "typescript"],
  "peerDependencies": {{peer_deps_with_zod}},
  "devDependencies": {
    "@types/node": "26.0.1",
    "@vitest/coverage-v8": "4.1.8",
    "nodefony": "*",
    "rimraf": "6.1.3",
    "vitest": "4.1.8"
  },
  "private": true,
  "license": "CECILL-B"
}
```

> **Bundler** : `rolldown` + `tsgo` (`@typescript/native-preview`) sont des devDeps de la
> RACINE (hoistés) — un module n'en déclare PAS de copie locale.

> **`exports["."].types` — 2 patterns (CLAUDE.md racine)** : un NOUVEAU module pointe
> `./dist/types/index.d.ts` (standard, `.d.ts` généré). Le pattern `"./index.ts"` (source,
> anti-race TS2307) est RÉSERVÉ aux modules consommés en source par un autre workspace
> (http/framework/security/frontend/orm-core/user) — ne pas l'utiliser par défaut.
> **Toolchain = devDependencies UNIQUEMENT** (décision 0.4) : outillage de build ne va
> JAMAIS en `dependencies` (poids runtime). Les peers workspace consommés (`nodefony`,
> `@nodefony/http`…) se doublent en devDeps `"*"` pour le typecheck/build local.
> Plus de `tslib` en devDeps (retiré — cf modules réels).

**peer_deps_with_zod selon options activées** :

```json
{
  "nodefony": "*",
  // ⭐ TOUJOURS : zod = source unique de la config (schéma + validation au boot,
  // convention ADR-0006). Version alignée avec security/drizzle.
  "zod": "^4.4.3",
  // si controllers :
  "@nodefony/http": "*",
  "@nodefony/framework": "*",
  // si entities :
  "@nodefony/drizzle": "*",
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
// intégration (si serveur requis) = vitest aussi, config dédiée (PAS mocha) :
"test:integration": "vitest run --config vitest.integration.config.ts"
```

> **JAMAIS de `.mocharc.*` ni de dep `mocha` dans un nouveau module** (suppression totale en cours, cf [[feedback_test_framework_vitest]]). Une suite « lourde » (intégration/charge) = un second `vitest.*.config.ts`, pas un retour à mocha.

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
- **import d'un ORM hors kernel** qui crashe → `resolve.alias["@nodefony/drizzle"|"mongoose"]` vers des stubs.

> **JAMAIS c8** (KO ESM/Node) ni **monocart+mocha+tsx** (`mcr --require` → CJS, sous-mappe le TS, lignes faussées — cf [[feedback_coverage_modules]]). vitest mappe le source TS proprement. `.coverage/` est gitignored ; Studio lit `.coverage/coverage-summary.json` OU `lcov.info`. **Tous les workspaces sont sur `@vitest/coverage-v8`** — le core aussi depuis sa migration mocha→vitest (2026-06-05, `4106303`) ; **monocart est déprécié** (cf [[feedback_test_framework_vitest]]).

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "rootDir": "./",
    "outDir": "./dist",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "target": "ES2024",
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
  "include": ["index.ts", "rolldown.config.ts", "nodefony/**/*.ts"],
  "exclude": [
    "node_modules",
    "dist",
    "nodefony/tests/**",
    "tests/**",
    "**/*.test.ts"
  ]
}
```

> ⚠️ **Exclure les tests du build est OBLIGATOIRE.** L'émission `.d.ts` (`tsgo -p
tsconfig.declarations.json`) type-check TOUT le programme : un test laissé dans `include`
> fait remonter `describe`/`it` non typés (TS2593), `import`/globals de test (TS2882/TS2304).
> Les tests ont leur propre `tsconfig.tests.json` (`types: ["node", "vitest/globals", "chai"]`).
> Couvrir les deux emplacements (`nodefony/tests/**` ET `tests/**`) + `**/*.test.ts` en filet.

⚠️ **Piège TS2565** : NE JAMAIS redéclarer `options: FooConfig;` comme propriété de classe
dans un Service custom — le parent l'initialise déjà. Stocker la config typée dans un
field séparé `cfg: FooConfig` (voir template Service).

### `rolldown.config.ts`

> **Toute la mécanique vit dans le subpath `nodefony/bundler`** (source
> `src/nodefony/src/bundler/index.ts`, même import pour un module du repo ET une app
> externe) : platform, preserveModules, treeshake (side-effect `reflect-metadata`
> préservé), et l'externalisation SYSTÉMATIQUE du nom propre du paquet (anti self-import).
> Le module ne déclare QUE sa liste `external` (⚠️ garder external ↔ peerDependencies EN
> PHASE, cf skill `nodefony-check-externals`). Prérequis : le core `nodefony` doit être
> buildé (ordre turbo standard).

```typescript
import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    // Ajouter selon peer_deps :
    // "@nodefony/http",
    // "@nodefony/framework",
    "zod",
    "tslib",
  ],
});
```

### `tsconfig.declarations.json`

> Émission des `.d.ts` HORS bundler (`tsgo -p tsconfig.declarations.json`, enchaîné par le
> script `build`). Exclut la config bundler et les tests — n'émet que le graphe publié.

```json
{
  "extends": "./tsconfig.json",
  "include": ["index.ts", "nodefony/**/*.ts"],
  "exclude": [
    "node_modules",
    "dist",
    "tests/**",
    "nodefony/tests/**",
    "**/*.test.ts",
    "**/*.spec.ts"
  ],
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "declarationDir": "./dist/types",
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "skipLibCheck": true
  }
}
```

### `index.ts` — Module class

```typescript
/**
 * @nodefony/{{name}} — {{description}}
 *
 * Voir `CLAUDE.md` du module pour les décisions d'archi figées
 * et `MEMORY.md` pour les internals IA.
 */
import { Kernel, Module, services } from "nodefony";
import config, {
  type {{NameClass}}Config,
  type {{NameClass}}ConfigInput,
} from "./nodefony/config/config";
import { define{{NameClass}}Config } from "./nodefony/config/defineModuleConfig";
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
   * Validation Zod de la config (défauts + `module.options`) au boot via le
   * BUILDER (convention ADR-0006 + lot 2 : le schéma de `config.ts` est la source
   * unique, `defineModuleConfig.ts` valide et formate les erreurs). Plante propre
   * avec messages clairs si non conforme — évite les `undefined.x` silencieux.
   */
  override async onKernelRegister(): Promise<this> {
    this.options = define{{NameClass}}Config(
      (this.options as {{NameClass}}ConfigInput) ?? {},
    );
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
export type {
  {{NameClass}}Config,
  {{NameClass}}ConfigInput,
} from "./nodefony/config/config";

// Builder de config (parse + valide + gèle) + JSON Schema introspectable (Studio) —
// pattern ADR-0006 + lot 2 : le FICHIER s'appelle `defineModuleConfig.ts` PARTOUT
// (uniforme), la FONCTION reste préfixée module (0 collision d'import cross-modules).
export {
  define{{NameClass}}Config,
  {{name}}ConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";

// Typage de `use("@nodefony/{{name}}", …)` dans `nodefony.config.ts` : on augmente le
// registre du core par declaration merging (pattern Nuxt/Pinia) → l'app obtient
// l'auto-complétion + le hover TSDoc des clés de config de CE module, et une clé mal
// orthographiée devient une erreur de COMPILATION au lieu d'un strip Zod silencieux.
// ⚠️ Le type d'ENTRÉE (`z.input`, tout optionnel), jamais celui de sortie (`z.infer`) :
// après application des défauts les champs sont requis, et surcharger une seule clé
// obligerait l'app à réécrire toute la config.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/{{name}}": {{NameClass}}ConfigInput;
  }
}

// Erreurs.
export {
  {{NameClass}}Error,
} from "./nodefony/src/errors/{{NameClass}}Error";
```

### `nodefony/config/config.ts` — schéma Zod commenté (source unique) + défauts

> **Convention ADR-0006 + lot 2 0.8 (« une source Zod par module »)** : `config.ts` est le
> **seul** fichier à lire pour comprendre la config du module. Il porte le schéma Zod
> commenté (`.default().describe()` = type + validation + défaut + doc), les types dérivés
> et **matérialise les défauts** via `parse({})`. Il n'importe que `zod` → nœud bas, aucun
> cycle. **Aucune valeur n'est re-tapée ailleurs** (ni en double, ni `.env.example`, ni
> `Dockerfile`). Le builder pur + le JSON Schema vivent dans `defineModuleConfig.ts`.
> Réf : `docs/adr/0006-configuration-unifiee-env-override.md` ; modèles `@nodefony/drizzle`
> et `@nodefony/documentation`.
>
> **Flags de champ = `.meta()` NATIF zod** (l'augmentation `GlobalMeta` du core rend
> `reserved`/`runtimeMutable`/`kernelDerived`/`secret` typés PARTOUT — 0 helper, 0 import,
> cf `IConfigFieldMeta`). ⚠️ **`.meta()` TOUJOURS EN DERNIER de la chaîne** : chaque méthode
> zod clone l'instance → `.default()` APRÈS `.meta()` PERD la métadonnée (prouvé par POC).
> Tout champ sensible (mot de passe, URL à credentials, clé) porte `secret: true`.
>
> **Vocabulaire sélection (gravé lot 2)** : un backend de DONNÉES = champ **`store`**
> (`session.store`, `audit.store`, `passkeys.store`…) ; un FLUX/transport = `driver`
> (backplane realtime, logs). Env : préfixe **`NF_`** pour toute variable Nodefony.

```typescript
import { z } from "zod";

/**
 * @nodefony/{{name}} — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le schéma Zod commenté ET matérialise les
 * défauts via `parse({})`. Aucune valeur n'est re-tapée ailleurs. Chaque champ porte
 * `.describe()` → messages d'erreur clairs au boot + JSON Schema introspectable par
 * Studio (formulaire auto-généré).
 *
 * SURCHARGE (précédence croissante — ADR-0006) :
 *   • App (typé)         : `use("@nodefony/{{name}}", { … })` dans `nodefony.config.ts` ;
 *   • Par environnement  : la fonction `(ctx) => …` de `nodefony.config.ts` (`ctx.isProd`…) ;
 *   • Déploiement/Docker : `NF__{{NAME_UPPER}}__<CHEMIN>=valeur` (override env générique).
 *
 * Enrichir à terme : voir `@nodefony/security` (sections groupées par préoccupation,
 * chaque défense `enabled` togglable, défauts SÛRS).
 */
export const {{name}}ConfigSchema = z
  .object({
    enabled: z.boolean().default(true).meta({
      runtimeMutable: true, // exemple de flag Nodefony (.meta() natif, typé par le core)
      description:
        "Active le module {{name}} au boot. Recommandation prod : true. " +
        "false = module chargé mais inerte (logs, registry, mais aucun listener actif).",
    }),
    // Exemple champ sensible : TOUJOURS flagger `secret: true` (masqué Studio + logs).
    // apiKey: z.string().optional().meta({
    //   secret: true,
    //   description: "Clé d'accès au service X — fournie par env, jamais committée.",
    // }),
  })
  .describe("Configuration de @nodefony/{{name}}.");

/** Entrée du builder (champs avec défaut → optionnels). */
export type {{NameClass}}ConfigInput = z.input<typeof {{name}}ConfigSchema>;
/** Config normalisée (défauts appliqués). */
export type {{NameClass}}Config = z.infer<typeof {{name}}ConfigSchema>;

/**
 * Défauts du module, matérialisés depuis le schéma (source unique). Toujours valides
 * par construction ; passés au `super(..., config)` du Module class.
 */
const config: {{NameClass}}Config = {{name}}ConfigSchema.parse({});

export default config;
```

### `nodefony/config/defineModuleConfig.ts` — builder pur (parse + freeze) + JSON Schema

> **Nom de FICHIER uniforme PARTOUT** (`defineModuleConfig.ts`, gravé lot 2 0.8) ; la
> **fonction reste préfixée module** (`define{{NameClass}}Config()`) — 0 collision d'import
> cross-modules. Builder ~30 lignes, **zéro valeur** (règle d'or ADR-0006 : les défauts
> vivent dans le schéma de `config.ts`). Importe le schéma de `./config`, valide (erreurs
> formatées par champ), gèle. Porte AUSSI `{{name}}ConfigJsonSchema()` (introspection
> Studio). Le slot env DÉDIÉ (variables `NF_*` du catalogue `env.ts`) s'applique APRÈS le
> parse, ici. L'override env GÉNÉRIQUE `NF__{{NAME_UPPER}}__*` est géré par le core, pas ici.

```typescript
import { z } from "zod";
import { {{name}}ConfigSchema } from "./config";
import type { {{NameClass}}Config, {{NameClass}}ConfigInput } from "./config";

/**
 * Builder type-safe de la configuration de `@nodefony/{{name}}` (PUR — ne retape
 * JAMAIS un défaut : source unique = `./config.ts`).
 *
 * @param config - configuration brute (champs omis = défauts sûrs du schéma).
 * @returns config validée et gelée.
 * @throws Error si la config est invalide (issues Zod agrégées, lisibles par champ).
 */
export function define{{NameClass}}Config(
  config: {{NameClass}}ConfigInput = {},
): {{NameClass}}Config {
  try {
    return Object.freeze({{name}}ConfigSchema.parse(config));
  } catch (e) {
    const issues =
      e instanceof Error && "issues" in e && Array.isArray(e.issues)
        ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join(" · ")
        : (e as Error).message;
    throw new Error(`[@nodefony/{{name}}] Invalid config: ${issues}`);
  }
}

/**
 * JSON Schema introspectable de la config — Studio en dérive son formulaire d'édition
 * (labels/types/défauts/descriptions + flags `.meta()` recopiés), sans UI hardcodée.
 */
export function {{name}}ConfigJsonSchema(): unknown {
  return z.toJSONSchema({{name}}ConfigSchema);
}
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
 * DEUX noms, et c'est NORMAL :
 *  - `@injectable()`        → la CLASSE, sous `{{NameClass}}Service` (sert à `@inject("…")`)
 *  - `super("{{name}}", …)` → l'INSTANCE, clé du container (sert à `kernel.get("{{name}}")`)
 * Le DI les réconcilie via la classe (la clé est apprise quand `@services` pose l'instance) :
 * `@inject("{{NameClass}}Service")` et `kernel.get("{{name}}")` rendent la MÊME instance.
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
├── rolldown.config.ts ← bundler — NE PAS MODIFIER sans accord
├── tsconfig.json ← NE PAS MODIFIER sans accord
├── CLAUDE.md / MEMORY.md / README.md
└── nodefony/
├── config/config.ts ← schéma Zod commenté (source unique) + défauts parse({})
├── config/defineModuleConfig.ts ← builder pur (fonction define{{NameClass}}Config + jsonSchema)
├── interfaces/I{{NameClass}}Service.ts
├── service/{{NameClass}}Service.ts ← @injectable, name="{{name}}"
├── (command/ / controller/ / entity/ selon options)
└── src/errors/{{NameClass}}Error.ts
\`\`\`

## Décisions techniques figées

| Sujet | Décision |
| --------------- | --------------------------------------------- | ----- | ------- | ----- | --------- |
| Service name DI | `"{{name}}"` (container.get("{{name}}")) |
| Errors | extends `{{NameClass}}Error` (code + context) |
| Config | typée via `{{NameClass}}Config` (cfg field) |
| Logs | via `this.log(msg, "INFO                      | DEBUG | WARNING | ERROR | CRITIC")` |

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

- Modifier `rolldown.config.ts` ou `tsconfig.json`
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

Workspace npm — déjà inclus dans nodefony-core. Ajouter au tableau `modules` du
descripteur `defineConfig` de votre `nodefony.config.ts` racine pour l'activer :

\`\`\`typescript
export default defineConfig((ctx) => ({
modules: [
// ...
"@nodefony/{{name}}",
],
}));
\`\`\`

## Usage

\`\`\`typescript
import { Nodefony } from "nodefony";
import type { {{NameClass}}Service } from "@nodefony/{{name}}";

const svc = Nodefony.getKernel().container.get("{{name}}") as {{NameClass}}Service;
console.log(svc.status());
\`\`\`

## Configuration

Surcharger les defaults via `use()` dans le manifeste `modules` de `nodefony.config.ts` :

\`\`\`typescript
import { defineConfig, use } from "nodefony";

export default defineConfig((ctx) => ({
modules: [
// ...
use("@nodefony/{{name}}", { enabled: true }),
],
}));
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
