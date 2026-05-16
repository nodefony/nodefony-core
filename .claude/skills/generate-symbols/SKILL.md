---
name: generate-symbols
description: Génère le graphe symbolique TypeScript de Nodefony (classes, interfaces, types, decorators, usedBy) en JSON. Pour retrieval rapide cross-module sans grep.
---

# generate-symbols

Génère un **graphe symbolique** complet du repo Nodefony en JSON. Permet aux agents IA de résoudre les relations entre symboles (classes, interfaces, types) sans lire tout le code source.

## Quand l'utiliser

- Avant une analyse cross-module (« qui dépend de `Container` ? », « quelles classes étendent `Service` ? »)
- Après une refonte ou un gros refactor : vérifier les usages
- Pour un audit d'API publique (symboles exportés depuis chaque `index.ts`)
- Pour détecter des dépendances circulaires (croiser `imports` + `usedBy`)

## Sortie

Deux fichiers produits :

| Fichier              | Statut       | Contenu                                                                              |
| -------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `.ai/symbols.json`   | committé     | **Stable** — symboles exportés uniquement (~150 KB, ~360 symboles). Léger, lisible.   |
| `dist/symbols.json`  | gitignored   | **Verbose** — tous symboles + méthodes + signatures + imports (~560 KB, ~430 symboles). |

## Comment générer

```bash
npm run generate-symbols
```

Le script (`scripts/generate-symbols.ts`) parse via **ts-morph**, filtre par taille (>500 KB skip), tolère les erreurs de parse fichier-par-fichier.

Configuration : `scripts/generate-symbols.config.ts` — globs `include` / `exclude`, chemins de sortie.

## Format JSON

```jsonc
{
  "generated": "2026-05-16T13:19:56.977Z",
  "version": "1.0.0",
  "stats": {
    "files": 180,
    "symbols": 428,
    "classes": 148,
    "interfaces": 139,
    "types": 112,
    "enums": 1,
    "functions": 24,
    "constants": 4
  },
  "symbols": [
    {
      "name": "Container",
      "kind": "class",                     // "class" | "interface" | "type" | "enum" | "function" | "const" | "decorator-fn"
      "file": "src/nodefony/src/Container.ts",
      "exported": true,
      "module": "@nodefony/core",          // workspace owning the symbol
      "extends": null,
      "implements": ["IContainer"],
      "decorators": []
      // verbose-only: "methods", "properties", "members", "signature"
    }
  ],
  "usedBy": {
    "Container": [
      "src/nodefony/src/Service.ts",
      "src/nodefony/src/kernel/Kernel.ts",
      // ... files that import this symbol
    ]
  },
  // verbose-only:
  "imports": [
    { "file": "src/nodefony/src/Service.ts", "imports": [{ "module": "./Container", "names": ["Container"], "isTypeOnly": false }] }
  ]
}
```

## Patterns d'usage agent

### « Qui étend X ? »

```bash
jq '.symbols[] | select(.extends == "Service") | {name, module, file}' .ai/symbols.json
```

### « Quelles classes implémentent IContext ? »

```bash
jq '.symbols[] | select(.implements != null and (.implements | index("IContext"))) | {name, module, file}' .ai/symbols.json
```

### « Qui utilise Container ? »

```bash
jq '.usedBy.Container' .ai/symbols.json
```

### « Liste tous les decorators définis »

```bash
jq '.symbols[] | select(.kind == "decorator-fn") | {name, file, module}' .ai/symbols.json
```

### « Liste les classes décorées avec @injectable »

```bash
jq '.symbols[] | select(.kind == "class" and (.decorators | index("injectable"))) | {name, module}' .ai/symbols.json
```

### « Quels symboles le module @nodefony/http expose ? »

```bash
jq '.symbols[] | select(.module == "@nodefony/http" and .exported)' .ai/symbols.json
```

## Limites

- **Pas de résolution complète de types** : on parse l'AST syntaxique, pas l'inférence (rapide, mais `extends` est le texte brut, pas la classe résolue).
- **Pas de cycles détectés explicitement** : croiser `imports` + `usedBy` manuellement.
- **`usedBy` basé sur les noms** : si deux symboles partagent un nom dans deux modules, ils sont confondus dans l'index `usedBy`. Acceptable pour Nodefony (peu de doublons), à raffiner si besoin.
- **Pas de coverage** des `dist/` ni des fichiers > 500 KB (générés/minifiés ignorés).

## Quand régénérer

- Après un commit majeur (renaming, nouvelles interfaces, nouveaux modules)
- En pre-commit hook (TODO future)
- En CI sur la branche `claude-ts` (TODO future)

Pour Nodefony pendant la migration : régénérer **manuellement à la fin de chaque session** où l'API publique a changé.

## Quand NE PAS utiliser

- Pour des questions sur la **runtime behavior** (état des sessions, valeurs d'enum). → lire le code.
- Pour des **bugs spécifiques** ou des problèmes dans une fonction. → lire la fonction.
- Pour `dist/` (compilé) ou tests. → exclus par config.
