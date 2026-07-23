---
name: nodefony-get-module-config
description: >
  INSPECTE un module Nodefony DÉJÀ EXISTANT — sa configuration, ses services injectés et ses routes
  déclarées — sans charger son code métier ni démarrer de serveur. Pour valider qu'un service est
  bien enregistré, qu'une route est bien déclarée, ou auditer les paramètres effectifs. Ne crée
  rien : scaffolder un module neuf → `nodefony-create-module`.
  Déclencheurs : "config du module X", "comment est configuré X", "montre la config de ce module",
  "quelles routes expose ce module", "voir les routes d'un module", "ce service est-il enregistré ?",
  "vérifier la déclaration de service", "inspecter un module existant".
---

# get-module-config

Cible directement les fichiers de structure d'un module (`config/`, `services.ts`, `routing.ts`) sans toucher au code des controllers/services.

## Quand l'utiliser

- Vérifier la déclaration d'un service dans le DI Container
- Auditer les paramètres passés à un bundle/module
- Vérifier la syntaxe d'une route ou ses middlewares
- Comprendre comment un module est wired avant de modifier son code

## Pourquoi ça économise des tokens

Lire un controller ou un service complet pour comprendre comment il est _enregistré_ est 10× plus coûteux que de lire les 30 lignes de `config.ts`. Ce skill force le ciblage sur les métadonnées.

## Commandes à exécuter

### Localiser le module

```bash
# package
ls src/packages/@nodefony/<name>/nodefony/config/ 2>/dev/null
# module utilisateur
ls src/modules/<name>/nodefony/config/ 2>/dev/null
```

### Lire la config

```bash
# Convention : tous les modules exposent `nodefony/config/config.ts`
cat src/packages/@nodefony/<name>/nodefony/config/config.ts 2>/dev/null \
  || cat src/modules/<name>/nodefony/config/config.ts
```

### Lire les services (si présents)

```bash
cat src/packages/@nodefony/<name>/nodefony/config/services.ts 2>/dev/null
```

### Lire les routes (si présentes)

```bash
cat src/packages/@nodefony/<name>/nodefony/config/routing.ts 2>/dev/null \
  || cat src/modules/<name>/nodefony/config/routing.ts 2>/dev/null
```

### Index : tous les `config.ts` du repo

```bash
find src -type f -name "config.ts" -path "*/nodefony/config/*" 2>/dev/null
```

## Quand NE PAS utiliser

- Pour comprendre **ce que fait** un controller → lire le source du controller
- Pour les configs JSON `package.json` → utiliser `jq` directement
- Pour la config de l'**application** (racine) → lire **`nodefony.config.ts`** (descripteur `defineConfig`,
  manifeste `modules` via `use()`) + **`env.ts`** (catalogue `defineEnv`). ⚠️ Plus de `nodefony/config/config.ts`
  (supprimé Lot 5) ; les défauts framework vivent dans le core (`src/nodefony/src/config/defaults.ts`).
