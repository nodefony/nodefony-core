# Conventions de structure — modules, types, configuration

> Référence chargée à la demande. Contenu **déplacé du `CLAUDE.md` racine** : il y était payé à
> chaque tour de chaque session alors qu'il ne sert qu'au moment où on crée ou restructure un
> module. Les invariants d'une ligne restent au `CLAUDE.md` ; le détail est ici.
>
> **Maintenance** : édition EN PLACE (vérité courante, jamais un journal — historique = `git log`).

## Sommaire

1. Architecture du dépôt
2. Structure d'un module
3. Standard de gestion des types (exports, `.d.ts`, `interfaces/`)
4. Configuration de l'APPLICATION — `defineConfig` / `env.ts`
5. Convention de STRUCTURE de la config d'un module

---

## Architecture

```
nodefony-core/
├── tsconfig.json               ← config TS racine (NE PAS MODIFIER sans accord)
├── package.json                ← workspaces npm
├── CLAUDE.md                   ← ce fichier
├── MIGRATION_STATUS.md         ← tableau de bord — LIRE EN DÉBUT DE SESSION
└── src/
    ├── nodefony/               ← workspace @nodefony/core
    │   ├── rolldown.config.ts  ← bundler (NE PAS MODIFIER sans accord)
    │   ├── tsconfig.json
    │   └── src/
    │       ├── tests/          ← tests mocha (npm run test)
    │       └── **/*.ts
    ├── packages/
    │   └── @nodefony/
    │       ├── http/           ← serveurs HTTP/HTTPS/HTTP2/WS/WSS
    │       ├── framework/      ← Controller, Resolver, Route
    │       ├── security/       ← JWT, OAuth, Session, WAF
    │       ├── orm-core/        ← abstraction IOrm / IRepository / IEntity
    │       ├── drizzle/         ← ORM SQL (référence, défaut)
    │       ├── mongoose/       ← MongoDB
    │       ├── redis/
    │       ├── llm/            ← ILLMProvider + adapters
    │       ├── rag/            ← Pipeline RAG
    │       ├── vector/         ← Adapters pgvector / Qdrant / Chroma
    │       ├── agent/          ← Orchestrateur + sous-agents
    │       └── memory/         ← Mémoire court/long terme
    └── modules/
        └── test/               ← module exemple
```

---

## Structure d'un module

```
src/packages/@nodefony/[module]/ ou src/modules/[module]
├── index.ts              ← export public uniquement
├── CLAUDE.md             ← INSTRUCTIONS SPÉCIFIQUES AU MODULE (À lire en priorité)
├── MEMORY.md             ← INSTRUCTIONS SPÉCIFIQUES Audience IA
├── package.json          ← workspace npm
├── README.md             ← doc du module
├── rolldown.config.ts
├── tsconfig.json
├── nodefony
│   ├── interfaces        ← I*.ts
│   ├── errors            ← classes typées
│   ├── config
│   ├── decorators
│   ├── services          ← @Service implementations
│   ├── src
│   ├── types
│   └── [domain]/         ← sous-dossiers spécifiques
└── tests/
    └── *.test.ts         ← couverture > 80%
```

## Standard gestion des types — règle universelle (TOUS les modules)

### La règle

Chaque module doit exposer ses types via les fichiers **générés automatiquement** (bundle rolldown + `.d.ts` par tsgo).
**Jamais** de fichier `.d.ts` écrit à la main — ils divergent silencieusement du code réel.

### `package.json` — template obligatoire

```json
{
  "main": "./dist/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

- `types` : fallback pour les outils TS < 4.7
- `exports["."].types` : pris en priorité par TS 4.7+ avec `moduleResolution: Bundler`
- Les deux pointent vers `dist/types/` généré par tsgo — jamais vers `nodefony/types/`

### `index.ts` — re-exporter tous les types publics

```typescript
// Classes concrètes
export { MyClass } from "./nodefony/src/...";

// Interfaces publiques — export type (effacé à la compilation)
export type { IMyInterface, MyType } from "./nodefony/interfaces/IMyInterface";
```

### `nodefony/interfaces/` — dossier standard

Chaque module doit avoir un dossier `nodefony/interfaces/` avec ses interfaces `I*.ts`.
Un barrel `index.ts` re-exporte tout.

### Fichiers legacy `nodefony/types/*.d.ts`

Ces fichiers `.d.ts` manuels sont un **héritage de l'ère JS**. Ne plus en créer.
Ne pas les supprimer sans vérifier qu'aucun outil externe ne les référence encore.
Ne JAMAIS les éditer : ils ne sont plus la source de vérité.

### Deux patterns de `exports.types` (selon dépendance inter-modules)

- **`"./index.ts"` (source TS, anti-race)** — modules consommés EN SOURCE par un autre module : `http`, `framework`, `security`, `frontend`, `orm-core`, `user`. **Chaîne obligatoire** : security → user → orm-core → `nodefony` (core buildé en 1er → `dist` prêt). Casser un maillon (un `dist/types` au milieu) = TS2307 « Cannot find module » sur les consommateurs amont (build race). Cf [[feedback_turbo_cache_stale_logs]].
- **`"./dist/types/..."` (`.d.ts` généré, standard)** — modules NON consommés en source : `drizzle`, `mongoose`, `redis`, `llm`. `nodefony` (core) = isomorphe (`browser`/`import`).
- WIP P12 (pas encore câblés, pas de `rolldown.config.ts`) : `agent`, `memory`, `rag`, `vector`. `studio` = `private: true` + `declaration: false` (types publics inutiles).

### Configuration de l'APPLICATION — `defineConfig` (modèle figé 2026-06-05, Lot 5)

La config de l'app vit dans **`nodefony.config.ts`** (racine) + **`env.ts`** (racine). Plus de
dossier `nodefony/config/{config,app,servers,log,schema,modules}.ts` (supprimés). Le core porte les
**défauts** (`defaultAppConfig`) ; l'app n'écrit QUE ses écarts (deep-merge au boot).

```typescript
// nodefony.config.ts — UN fichier, l'orchestrateur
import { defineConfig, use } from "nodefony";
import type { env } from "./env";
export default defineConfig<typeof env>((ctx) => ({
  domain: ctx.isProd ? "0.0.0.0" : "127.0.0.1", // par-env via ctx (PAS de config.prod.ts)
  log: { debug: ctx.isProd ? [] : "*", driver: ctx.env.NF_LOG_DRIVER },
  modules: [
    // manifeste ordonné (remplace @modules)
    use(
      "@nodefony/http",
      { trustedHosts: ["localhost"] },
      { policy: "mandatory" },
    ), // config colocalisée
    "@nodefony/framework",
    { name: "@nodefony/test", policy: "dev" }, // gating policy/when
  ],
}));
```

```typescript
// env.ts — SEUL lecteur de process.env (catalogue typé + validé au boot)
import { defineEnv, envEnum, envString } from "nodefony";
export const env = defineEnv({
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
  }),
  LOKI_URL: envString({ optional: true }),
});
```

`index.ts` racine : `import config from "./nodefony.config"` (passé à `super(...)`) + `export { env }`
(lu par le Kernel pour `ctx.env`). **Plus de `export { validateConfig }`** (la validation Zod est
intégrée au `resolve()` du descripteur, dans le core).

**Règles** :

- `ctx = { env, appEnv, runtimeEnv, isProd, isDev, isTest }`. Par-env = **fonction `(ctx) => …`**, jamais un fichier parallèle.
- `use(name, config, opts?)` colocalise la config d'un module avec son chargement (remplace les clés `module-<name>` à la racine). `opts = { policy, when }`.
- ⚠️ `as const` sur les valeurs d'`envEnum([...])` (sinon l'union littérale est élargie en `string` → erreur de type sur le champ ciblé).
- `enverrouiller le kernel au top-level` reste interdit ; avec `(ctx) => …` + getters lazy, le deref devient inutile (cf section ci-dessus).
- Cluster : `nodefony/config/cluster/cluster.config.ts` reste un fichier **séparé kernel-free** (le master le lit standalone AVANT boot) — ne PAS le mettre dans `nodefony.config.ts`.

**Convention module (OBLIGATOIRE pour le typage de `use()`)** : tout module qui expose une config doit
(1) publier son type d'**entrée** `IXConfigInput` / `XConfigInput` (`z.input` du schéma — tout
optionnel), et (2) **augmenter le registre** `NodefonyModuleConfig` via `declare module "nodefony"`
(clé = nom du module → ce type d'entrée) pour que `use("@nodefony/x", …)` propose ses clés typées.

⚠️ **Le type d'ENTRÉE, jamais celui de sortie** (`z.infer`) : après application des défauts les champs
sont requis, et surcharger une seule clé obligerait l'app à réécrire toute la config.

⚠️ **L'enjeu n'est pas l'auto-complétion.** Sans augmentation, `use()` accepte tout
(`Record<string, unknown>`) — donc une clé **mal orthographiée compile**, puis est **retirée par Zod
au boot sans un mot** : la config a l'air prise en compte, elle ne l'est pas. L'augmentation transforme
cette panne silencieuse en erreur de compilation. Un module tiers qui ne l'applique pas reste
fonctionnel (jamais bloquant) — il perd juste ce filet.

Le scaffold (`nodefony create module`) génère déjà cette déclaration : un module neuf naît conforme.
Sentinelle de la convention : `@nodefony/redis` `nodefony/tests/unit/moduleConfigRegistry.types.test.ts`.
Recette complète : [`docs/guides/configuration.md`](docs/guides/configuration.md).

**Convention STRUCTURE de la config d'un module (figée 2026-07-04 — cible, migration en cours, réf = `@nodefony/drizzle`)** :
chaque module = EXACTEMENT 2 fichiers, mêmes noms PARTOUT (zéro question) —

- `nodefony/config/config.ts` = **LE QUOI** : schéma Zod commenté (source UNIQUE des défauts,
  `.default().describe()` + flags `meta()`), type inféré, défauts matérialisés `schema.parse({})`.
- `nodefony/config/defineModuleConfig.ts` = **LE COMMENT** : builder PUR `define<Module>Config()`
  (parse input → env layering → freeze — ne retape JAMAIS un défaut) + `<module>ConfigJsonSchema()`.
- **`schema.ts` n'existe plus** (fusion vers `config.ts`, le nœud bas — jamais vers `define`, sinon
  cycle `interfaces ↔ define`). Fichier uniforme, mais **fonction exportée PRÉFIXÉE module**
  (`defineHttpConfig()`…) — évite les collisions d'import cross-modules.
- Métas de champ : **`.meta()` NATIF zod** — le core (`config/configMeta.ts`) porte UNIQUEMENT
  l'interface `IConfigFieldMeta` (`reserved`/`runtimeMutable`/`kernelDerived`/`secret`) + l'augmentation
  `declare module "zod" { interface GlobalMeta }` → les flags sont typés dans `.meta()` PARTOUT
  (modules ET apps) sans aucun helper, et sortent dans `z.toJSONSchema()` (provenance Studio).
  ⚠️ `.meta()` TOUJOURS EN DERNIER de la chaîne (chaque méthode zod clone → `.default()` après
  `.meta()` PERD la métadonnée, prouvé par POC). On nomme le RÔLE, jamais l'outil.
- **Vocabulaire sélection** : données = champ `store` partout (`session.store`, `tokenStore.store`,
  `audit.store`, `passkeys.store`…) ; flux/transport = `driver` (backplane realtime, logs).
