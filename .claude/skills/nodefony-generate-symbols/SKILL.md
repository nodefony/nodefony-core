---
name: nodefony-generate-symbols
description: >
  Graphe symbolique TypeScript de Nodefony (classes, interfaces, types, décorateurs, relations
  inversées) : le génère dans `.ai/symbols.json` et donne les requêtes `jq` pour répondre en O(1),
  sans parcourir le dépôt — qui étend cette classe, qui implémente cette interface, qui importe ce
  symbole, quelle est la description TSDoc, où est-il défini. À charger AVANT de partir en `grep`
  sur plusieurs modules : la réponse est déjà indexée.
  Déclencheurs : "génère les symboles", "graphe symbolique", "regenerate symbols", "symbols.json",
  "qui étend cette classe ?", "qui implémente cette interface ?", "qui utilise ce symbole ?",
  "où est défini X ?", "chercher dans tout le repo", "trouver les consommateurs".
---

# generate-symbols

Génère un **graphe symbolique indexé** du repo Nodefony en JSON. Conçu pour que les agents IA résolvent types, dépendances et impacts cross-modules en O(1) sans charger des fichiers entiers.

## Quand l'utiliser

- Avant une analyse cross-module : « Qui dépend de `Container` ? », « Quelles classes étendent `Service` ? »
- Analyse d'impact avant refactor : qui implémente `IContext` et serait cassé par un changement de signature ?
- Audit d'API publique : tous les symboles exportés par un workspace
- Localisation d'un fichier source à partir du nom d'un symbole

## Sortie

| Fichier             | Statut     | Contenu                                                                                      |
| ------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `.ai/symbols.json`  | committé   | **Stable** — exportés uniquement (~180 KB, ~380 symboles). Map indexée + relations inverses. |
| `dist/symbols.json` | gitignored | **Verbose** — tous symboles + méthodes (+ description) + propriétés + imports détaillés.     |

## Générer

```bash
npm run generate-symbols
```

Le script (`scripts/generate-symbols.ts`) parse via **ts-morph**, filtre par taille (>500 KB skip), tolère les erreurs fichier-par-fichier. Régénéré automatiquement par le hook pre-commit quand un `.ts` de la zone parsée est staged.

## Format JSON (v2.0)

```jsonc
{
  "generated": "2026-05-17T01:55:00.000Z",
  "version": "2.0.0",
  "stats": { "files": 187, "symbols": 452, "classes": 153, ... },

  // Map indexée par nom → accès O(1).
  // Homonymes : second et suivants sous "Module:Name" (warning console au build).
  "symbols": {
    "Container": {
      "kind": "class",                     // "class" | "interface" | "type" | "enum" | "function" | "const" | "decorator-fn"
      "file": "src/nodefony/src/Container.ts",
      "exported": true,
      "module": "@nodefony/core",
      "extends": null,
      "implements": ["IContainer"],
      "decorators": [],
      "description": "Gère l'injection de dépendances..."  // si TSDoc présente
      // verbose-only: "methods" (avec description par méthode), "properties", "members", "signature"
    }
  },

  // Index inversés pré-calculés — réponses instantanées sans scan.
  "relations": {
    "extendedBy":    { "Service":    ["Cli", "Kernel", "Module", ...] },
    "implementedBy": { "IContainer": ["Container", "Scope"] },
    "decoratedBy":   { "injectable": ["Router", "HttpKernel", ...] },
    "usedBy":        { "Container":  ["src/nodefony/src/Service.ts", ...] }
  }
}
```

## Cheat-sheet jq — Zero-Token Lookup

### 🎯 Définition d'un symbole (O(1))

```bash
jq '.symbols.Container' .ai/symbols.json
```

### 🌿 Qui étend la classe X ?

```bash
jq '.relations.extendedBy.Service' .ai/symbols.json
```

### 🧩 Qui implémente l'interface Y ?

```bash
jq '.relations.implementedBy.IContainer' .ai/symbols.json
```

### 🔍 Où est utilisé le symbole Z (analyse d'impact) ?

```bash
jq '.relations.usedBy.Container' .ai/symbols.json
```

### 🏷️ Quelles classes portent un décorateur ?

```bash
jq '.relations.decoratedBy.injectable' .ai/symbols.json
```

### 📦 Tous les symboles exportés par un module

```bash
jq '.symbols | to_entries | map(select(.value.module == "@nodefony/http")) | from_entries' .ai/symbols.json
```

### 🔠 Tous les noms de symboles (utile pour autocomplétion / vérif)

```bash
jq '.symbols | keys' .ai/symbols.json
```

### 📖 Description TSDoc d'un symbole

```bash
jq '.symbols.Container | {kind, description, implements, file}' .ai/symbols.json
```

### 🔧 Signatures de méthodes (verbose only)

```bash
jq '.symbols.HttpContext.methods[] | select(.name == "render")' dist/symbols.json
```

## Limites & règles

- **Homonymes** : deux symboles avec le même nom dans deux modules → le premier garde le nom court, les suivants sont accessibles via `"Module:Name"`. Convention Nodefony : éviter les doublons via préfixe (`HttpKernel` vs `Kernel`).
- **Génériques** : `extends BaseService<T>` → `extendedBy.BaseService` (les paramètres génériques sont strippés). Inférence syntaxique, pas sémantique.
- **`usedBy` par nom simple** : si deux modules exposent un même nom, les usages tombent dans le même bucket. Lever l'ambiguïté en lisant le `module` dans `symbols[name]`.
- **Pas de cycles détectés explicitement** : croiser `relations.usedBy` + `imports` (verbose) manuellement.
- **`dist/` ignoré** (config). Fichiers > 500 KB skippés.

## Quand régénérer

- **Auto** : pre-commit hook (`.husky/pre-commit`) régénère si un `.ts` de la zone parsée est staged
- **Manuel** : après un gros refactor ou pour vérifier en cours de session

## Quand NE PAS utiliser

- Runtime behavior (état sessions, valeurs runtime) → lire le code
- Bug dans une fonction spécifique → lire la fonction
- Inférence de types complexes (generics résolus) → utiliser `tsc --noEmit` ou l'AST verbose
