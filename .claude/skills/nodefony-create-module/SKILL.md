---
name: nodefony-create-module
description: >
  Scaffold complet d'un nouveau module Nodefony — package.json, tsconfig, rollup, structure
  nodefony/{interfaces,service,command,src,config}/, index.ts (Module + @services + exports),
  CLAUDE.md, MEMORY.md, README.md. Détecte le pattern (package @nodefony/* vs module applicatif
  src/modules/), pré-configure peerDeps et options (CLI, controllers, frontend), met à jour @modules() racine.
  Déclencheurs : "crée un module", "scaffold module", "nouveau module nodefony", "génère un module",
  "create module", "bootstrap module", "module @nodefony/...".
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

### 3. Génération des fichiers (utiliser Write tool — templates dans `reference/templates.md`)

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

> 📄 Tous les templates (package.json, tsconfig, rollup, index.ts, services, errors, command,
> controller, CLAUDE.md, MEMORY.md, README.md) sont dans
> **[`reference/templates.md`](reference/templates.md)** — les charger au moment de l'étape 3.
> Conventions figées : TS strict, ESM-only, named exports, préfixe `node:`, interfaces `I*`,
> emitDecoratorMetadata + experimentalDecorators, declarationDir `./dist/types`.

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
