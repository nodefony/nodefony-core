---
name: nodefony-create-module
description: >
  Scaffold d'un package @nodefony/* du REPO FRAMEWORK (src/packages/) — package.json, tsconfig,
  rolldown, structure nodefony/{interfaces,service,command,src,config}/, index.ts (Module + @services
  + exports), CLAUDE.md, MEMORY.md, README.md, peerDeps, manifeste `modules`. Dans une APPLICATION, le
  scaffold d'un module est une commande — `nodefony create module <nom>` — et ce skill s'y délègue au
  lieu de la réimplémenter (une seule source de templates).
  À charger AVANT d'écrire le moindre fichier d'un module neuf : recomposer le squelette à la main
  produit un module non conforme (types, exports, config, docs) que rien ne signale.
  Déclencheurs : "crée un module", "scaffold module", "nouveau module nodefony", "génère un module",
  "create module", "bootstrap module", "module @nodefony/...", "j'ai besoin d'un nouveau paquet",
  "ajouter un module au framework", "structure d'un module neuf".
---

# nodefony-create-module

Génère un module Nodefony complet — backend uniquement par défaut, optionnellement avec
controllers HTTP, commands CLI, ou frontend Vite — en suivant les conventions figées
dans `CLAUDE.md` racine et observées sur les modules existants (`@nodefony/http`,
`@nodefony/llm`, `@nodefony/frontend`).

## 🚦 DEUX CAS — ne pas confondre (lire AVANT toute génération)

Le scaffold d'un module d'**application** vit maintenant dans le **CLI**. Ce skill ne le
réimplémente PAS : deux scaffolders qui divergent, c'est le bug que ce projet a déjà payé.

| Cible                                                           | Qui scaffolde                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Module d'une **APP** (`modules/<nom>/` d'un projet utilisateur) | **`nodefony create module <nom>`** — le CLI. Ce skill DÉLÈGUE.             |
| Package **`@nodefony/*` du repo framework** (`src/packages/`)   | Ce skill (templates de `references/templates.md`) — le CLI ne le fait pas. |

**Cas APP → lancer la commande, ne rien recopier à la main :**

```bash
nodefony create module blog --controller hello --command   # + --frontend react, --no-service…
```

Elle pose un **workspace npm** (`modules/blog/`), câble les workspaces + les scripts de
l'app, ajoute `use("@<app>/blog", {})` au manifeste `modules`, délègue le controller/front
aux scaffolds `create controller` / `create front`, installe et construit. Un service
s'ajoute ensuite par `nodefony create service <Nom> --module <nom>` (il câble le
`@services([…])` seul, et le CRÉE si la cible n'en avait pas). Templates réels :
`src/nodefony/templates/module/` ; moteur : `src/nodefony/src/cli/scaffold/engine.ts`.

Ce que l'IA apporte **en plus** de la commande (c'est ça, la valeur du skill) : le choix des
options, des `CLAUDE.md`/`MEMORY.md` sur-mesure (pas un gabarit figé), la vérification
post-build, et l'explication du POURQUOI. Jamais la mécanique.

> **Pourquoi le repo framework n'est pas couvert par le CLI** : son layout (`src/packages/@nodefony/*`,
> `src/modules/*`, chaîne de build turbo, types consommés en SOURCE) n'est pas celui d'une app générée
> (`modules/*`). Le CLI cible les apps ; le repo reste servi par les templates de ce skill.

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

| Option                          | Emplacement                      | Quand                                               |
| ------------------------------- | -------------------------------- | --------------------------------------------------- |
| Package framework `@nodefony/*` | `src/packages/@nodefony/{name}/` | Composant réutilisable, faisant partie du framework |
| Module applicatif               | `src/modules/{name}/`            | Module d'app, démo, test, non publié séparément     |

### Q3 — Options à activer (multiSelect)

- `Commands CLI` (ex: `nodefony foo:start`) — ajoute `nodefony/command/` + addCommand
- `Controllers HTTP` (ex: `@controller("/foo")`) — ajoute `nodefony/controller/` + `@controllers([...])` + peer `@nodefony/framework` et `@nodefony/http`
- `Service injectable principal` (recommandé par défaut) — ajoute `nodefony/service/FooService.ts` + `@services([FooService])`
- `Entities ORM` — ajoute `nodefony/entity/` + peer `@nodefony/drizzle` (défaut SQL) ou `@nodefony/mongoose` (NoSQL) selon config
- `Frontend Vite` — ajoute `frontend/`, peer `@nodefony/frontend`, déclaration `registerEntry` dans `onKernelBoot`

### Q4 — Ajouter au manifeste `modules` de `nodefony.config.ts` ?

> "Activer le module dans la config maintenant ? (oui = ajouté tout de suite et utilisable au prochain build)"

Si oui : éditer **`/Users/cci/repository/nodefony-core/nodefony.config.ts`** pour ajouter le module au
tableau **`modules`** du descripteur `defineConfig` (⚠️ plus de décorateur `@modules` — RETIRÉ 2026-06-03).
Forme : `"@nodefony/<name>"` (string nue = optional), `{ name, policy: "dev"|"mandatory", when }`, ou
**`use("@nodefony/<name>", { …config }, { policy })`** pour colocaliser une config. Ordre important :
packages framework AVANT modules applicatifs ; un consumer DOIT être après le module qu'il consomme.

## Étapes d'exécution

### 1. Vérifications préalables

- Vérifier que le chemin cible n'existe pas déjà : `ls src/packages/@nodefony/{name}/` doit faillir.
- Si le module existe → ne PAS l'écraser, demander à l'user (overwrite ? nom différent ?).

### 2. Création arborescence

```bash
# Package framework (TOUJOURS — `docs/` inclus, surfacé dans Studio /nodefony/modules/{name})
mkdir -p src/packages/@nodefony/{name}/nodefony/{config,interfaces,service,src/errors}
mkdir -p src/packages/@nodefony/{name}/docs

# Avec commands CLI
mkdir -p src/packages/@nodefony/{name}/nodefony/command

# Avec controllers
mkdir -p src/packages/@nodefony/{name}/nodefony/controller

# Avec entities
mkdir -p src/packages/@nodefony/{name}/nodefony/entity

# Avec frontend
mkdir -p src/packages/@nodefony/{name}/frontend/src
```

### 3. Génération des fichiers (utiliser Write tool — templates dans `references/templates.md`)

Variables à remplacer dans tous les templates :

- `{{name}}` → nom court (ex: `foo`)
- `{{NameClass}}` → PascalCase (ex: `Foo`)
- `{{NAME_UPPER}}` → upper (ex: `FOO`) — utilisé seulement dans error codes
- `{{description}}` → 1 ligne fournie par l'user (fallback : `"Nodefony {{name}} module"`)
- `{{path_dir}}` → `src/packages/@nodefony/{{name}}` ou `src/modules/{{name}}`
- `{{peer_deps}}` → JSON object selon options activées
- `{{peer_dev_types}}` → liste @types/\* devDependencies selon options

**Fichiers générés TOUJOURS** : `package.json`, `tsconfig.json`, `rolldown.config.ts`, `tsconfig.declarations.json`,
`vitest.config.ts`, `index.ts` (Module class + exports + validation Zod au boot),
**`nodefony/config/config.ts`** ⭐ (schéma Zod commenté = source unique + défauts `parse({})`),
`nodefony/config/defineModuleConfig.ts` (nom de FICHIER uniforme partout — fonction préfixée
`define{{NameClass}}Config()` : parse + erreurs formatées + freeze + `{{name}}ConfigJsonSchema()`),
`nodefony/interfaces/I{{NameClass}}Service.ts` + `index.ts` barrel,
`nodefony/service/{{NameClass}}Service.ts`, `nodefony/src/errors/{{NameClass}}Error.ts`,
`CLAUDE.md`, `MEMORY.md`, `README.md`, **`docs/index.md`, `docs/architecture.md`** ⭐.

**Fichiers générés SI OPTIONS** : `nodefony/command/{{name}}-command.ts` (Q3 commands),
`nodefony/controller/{{NameClass}}Controller.ts` (Q3 controllers), `nodefony/entity/...` (Q3 entities),
`frontend/...` (Q3 frontend — délégué au skill `nodefony-create-frontend-module`).

> ⭐ **`docs/` est OBLIGATOIRE depuis 2026-05-28** (convention figée — cf
> [[feedback_module_docs_scaffold]]). Tout module naît avec sa structure doc minimale pour
> être visible dans Studio `/nodefony/modules/{{name}}` (onglet « Docs ») dès le 1er commit.
> Le `README.md` reste séparé (cible npm/GitHub, court) ; `docs/*.md` = doc dev/utilisateur
> étendue (frontmatter Studio-friendly figé : `slug`, `title`, `section`, `audience`,
> `version`, `status`, `updated`, `source`).

> ⭐ **Config unifiée — convention ADR-0006 + lot 2 0.8 (« une source Zod par module »)** :
> tout module qui expose une config porte son **schéma Zod commenté dans `config.ts`** — le
> SEUL fichier à lire pour comprendre sa config (type via `z.infer<>`, défaut via `.default()`,
> doc via `.describe()`, défauts matérialisés via `{{name}}ConfigSchema.parse({})`). Le builder
> pur (parse + erreurs formatées + freeze) ET le JSON Schema (`z.toJSONSchema`) vivent dans
> **`defineModuleConfig.ts`** (nom de fichier UNIFORME partout, fonction PRÉFIXÉE module).
> **Plus de `schema.ts` séparé** (fusionné dans `config.ts`).
> Un défaut n'est **JAMAIS** re-tapé ailleurs (ni en double, ni `.env.example`, ni `Dockerfile`).
> Validé au boot via `onKernelRegister` → plante propre, pas de `undefined.x` silencieux. Chaque
> champ est surchargeable par l'app via `use("@nodefony/{{name}}", { … })` et par env générique
> `NF__{{NAME_UPPER}}__<CHEMIN>` (override cloud-native). Réf :
> `docs/adr/0006-configuration-unifiee-env-override.md` ; modèles `@nodefony/drizzle` et
> `@nodefony/documentation`. Zod `^4.4.3` = peerDep TOUJOURS.
>
> ⭐ **Flags de champ = `.meta()` NATIF zod** (l'augmentation `GlobalMeta` du core type
> `reserved`/`runtimeMutable`/`kernelDerived`/`secret` partout — 0 helper, cf
> `IConfigFieldMeta`). ⚠️ `.meta()` **TOUJOURS EN DERNIER** de la chaîne zod (un `.default()`
> après `.meta()` PERD la métadonnée). Tout champ sensible porte `secret: true`.
> **Vocabulaire** : backend de DONNÉES = champ `store` · FLUX/transport = `driver` · env
> Nodefony = préfixe `NF_`.

### 4. Build du module

```bash
npm run build --workspace={{path_dir}} 2>&1 | tail -5
```

Vérifier qu'il n'y a PAS de `error TS[0-9]+`.

### 5. Optionnel — activation dans le manifeste `modules` de `nodefony.config.ts`

Si l'user a dit oui à Q4 (⚠️ **plus de décorateur `@modules`** — RETIRÉ 2026-06-03 ; la liste vit dans
la config) :

```typescript
// nodefony.config.ts racine — éditer le tableau `modules` du descripteur defineConfig
modules: [
  use("@nodefony/http", { /* … */ }, { policy: "mandatory" }),
  { name: "@nodefony/framework", policy: "mandatory" },
  { name: "@nodefony/security", policy: "mandatory" },
  { name: "@nodefony/test", policy: "dev" },
  "@nodefony/{{name}}",  // ← ajouté ici (ou use("@nodefony/{{name}}", { …config }) pour colocaliser)
],
```

> **Typage de `use()`** : pour que `use("@nodefony/{{name}}", …)` propose les clés de config du module,
> le module augmente le registre (cf template `index.ts` ci-dessous) :
> `declare module "nodefony" { interface NodefonyModuleConfig { "@nodefony/{{name}}": {{NameClass}}ConfigInput } }`.
> ⚠️ Le type d'**ENTRÉE** (`z.input`, tout optionnel), JAMAIS celui de sortie (`z.infer`) : après
> application des défauts les champs sont requis, et l'app devrait alors réécrire toute la config
> pour surcharger une seule clé. Sans augmentation, `use()` accepte quand même (`Record<string,
unknown>`) — jamais bloquant, mais une clé mal orthographiée part au silence (strip Zod au boot).

**Séquence post-scaffold FIABLE** (ordre vécu 2026-05-22 sur `mediasoup` — chaque étape évite un crash) :

```bash
# (a) Symlink du nouveau workspace — SINON boot crash "Cannot find package .../dist/index.js"
npm install
# (b) Build du module + des deps modifiées EN DIRECT (pas turbo : cache → types périmés / TS2353)
cd src/modules/{{name}} && npm run build && ls dist/index.js   # ← vérifier l'émission, pas "created dist"
# (c) Dist RACINE rebuild (sinon 1er boot rate le module ; start.sh ne build que le module test)
cd /Users/cci/repository/nodefony-core && npx rolldown -c rolldown.config.ts
# (d) stop + start
bash .claude/skills/nodefony-start-server/stop.sh && bash .claude/skills/nodefony-start-server/start.sh
```

Si OK, mentionner à l'user que le module est utilisable. ⚠️ Ne PAS se fier au seul « created dist » : vérifier `ls dist/index.js`.

### 6. Reporter à l'user

Format court :

```
Module @nodefony/{{name}} créé.
  - {{path_dir}}/
  - Build OK (X.Xs)
  - Activé dans le manifeste `modules` (nodefony.config.ts) : oui/non
  - Services : [...], Commands : [...], Controllers : [...]
```

---

## Templates des fichiers à générer

> 📄 Tous les templates (package.json, tsconfig, rolldown, index.ts, services, errors, command,
> controller, CLAUDE.md, MEMORY.md, README.md) sont dans
> **[`references/templates.md`](references/templates.md)** — les charger au moment de l'étape 3.
> Conventions figées : TS strict, ESM-only, named exports, préfixe `node:`, interfaces `I*`,
> emitDecoratorMetadata + experimentalDecorators, declarationDir `./dist/types`.

---

## Validation finale

Après génération :

1. **Build du module** : `npm run build --workspace={{path_dir}}`
2. **Vérifier 0 erreur TS**
3. **Si activé dans le manifeste `modules`** : `npm run build` full + check qu'aucun workspace ne casse
4. **Reporter à l'user** le statut + chemins créés

## Pièges connus à éviter

<!-- prettier-ignore -->
| Piège | Symptôme | Fix |
| --- | --- | --- |
| `options: Config` redéclaré dans Service | TS2565 "Property 'options' is used before being assigned" | Utiliser `private readonly cfg: Config` field |
| `declarationDir` sans `declaration` | TS5069 | Soit garder les 2, soit retirer les 2 |
| `external: ["nodefony"]` non exact-match | "nodefony" matche tous chunks `nodefony/...` | `id === e \|\| (e !== "nodefony" && id.startsWith(e + "/"))` |
| Service `name` ≠ className | `container.get("ClassName")` retourne undefined | Utiliser le name passé à super() |
| ANSI dans stdout child | regex match foire | strip via `/\x1b\[[0-9;]*m/g` |
| `npx command &` meurt SIGHUP | process detached die | spawn `detached: true` + `child.unref()` |
| `path.resolve(root, "./frontend/src/main.tsx")` quand root déjà absolu | `frontend/frontend/...` doublé | Stocker entryFile relatif au root (`path.relative(root, abs)`) |
| Activation `modules` (nodefony.config.ts) dans le mauvais ordre | service non trouvé au consumer | Frontend AVANT son consumer ; framework/http AVANT modules qui les utilisent |
| Forgot `/// <reference types="node" />` | TS errors sur globals Node | Première ligne des fichiers test |
| **Nouveau workspace sans `npm install`** | **boot crash `Cannot find package '.../node_modules/@nodefony/<mod>/dist/index.js'`** | **`npm install` racine APRÈS création** → crée le symlink `node_modules/@nodefony/<mod>` (glob workspaces `src/modules/*` / `src/packages/@nodefony/*`) |
| **Dist RACINE périmé après ajout au manifeste `modules`** | 1er boot rate le module (même si le module est bâti) | **rebuild dist racine** (`npx rolldown -c rolldown.config.ts` à la racine) — `start.sh` ne build QUE le module test ; cf mémoire `feedback_root_dist_stale_modules` |
| **Turbo sert des types périmés d'une lib partagée** | `TS2353 '<champ>' n'existe pas sur <IInterface>` alors que la source l'a (ex. champ ajouté à `IEntity` dans orm-core) | **builder la dép EN DIRECT** (`cd <dep> && npm run build`), PAS via turbo (cache stale) ; cf `feedback_turbo_cache_stale_logs` |
| **`created dist` menteur** | build « réussi » mais `dist/index.js` **absent** — vérifier l'émission réelle | **TOUJOURS `ls dist/index.js`** après build, ne pas se fier au message « created dist » |

## Exemples concrets de modules créés

- `@nodefony/llm` : service unique (LLMService) + providers + erreurs typées (référence "simple")
- `@nodefony/http` : commands CLI + interfaces étoffées + service complexe (référence "complete backend")
- `@nodefony/frontend` : commands + service + 1 supervisor + 1 builder + presets (référence "avec extension points")
- `@nodefony/test-frontend-react` (POC) : module applicatif avec controllers + frontend (référence `src/modules/`)

Tous dans `src/packages/@nodefony/` ou `src/modules/`. Lire AVANT de générer un module similaire pour calquer le pattern exact.
