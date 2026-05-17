---
name: nodefony-ts-docs
description: >
  Consulte la documentation officielle TypeScript (utility types, handbook, do's and don'ts)
  et les types Node.js (@types/node DefinitelyTyped) via sources brutes raw GitHub + proxy
  `r.jina.ai`. Interdiction d'utiliser `typescriptlang.org` (trop lourd, JS bloque Claude Code).
  Déclencheurs : "comment typer X", "utility type", "Pick/Omit/ReturnType", "@types/node",
  "NodeJS.Timeout", "TS handbook", "design declaration file", "mapped types", "conditional type".
---

# nodefony-ts-docs

Sources TypeScript et @types/node — raw GitHub uniquement.

## Règle d'or

- **Interdiction** de charger les pages du site `typescriptlang.org` (JS lourd, perte de tokens).
- **Raccourci** : utiliser le proxy `https://r.jina.ai/` devant l'URL GitHub Raw.
- **Zéro Bla-bla** : extraire la structure du type officiel → l'adapter à Nodefony → l'intégrer sans rapport de lecture.
- **Cache MEMORY** : une fois une API Node.js comprise (ex: `node:http2`), stocker les signatures critiques dans le `MEMORY.md` du module pour ne plus relire.

## Sources canoniques

### 1. Utility Types officiels (Pick, Omit, ReturnType, Parameters…)

Définitions natives `lib.es5.d.ts` :

```
https://r.jina.ai/https://raw.githubusercontent.com/microsoft/TypeScript/main/src/lib/es5.d.ts
```

> Ne lis pas tout. `grep "type Pick"` ou cherche la définition précise.

### 2. TS Handbook — Do's and Don'ts (design declaration files)

Règles overloads, callbacks, unsound types :

```
https://r.jina.ai/https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/declaration-files/Do-s-and-Don-ts.md
```

### 3. TS Handbook — Everyday Types (Interfaces vs Types)

Cheat-sheet quotidien :

```
https://r.jina.ai/https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/handbook/2/Everyday-Types.md
```

### 4. @types/node officiel — DefinitelyTyped

Types natifs Node.js v20+ :

**Core HTTP** :
```
https://r.jina.ai/https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/node/http.d.ts
```

**Globals / Process / NodeJS namespace** :
```
https://r.jina.ai/https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/node/globals.d.ts
```

## Pattern d'usage

1. Question utilisateur : "Comment typer X en TS ?"
2. Identifier la source : utility type → es5.d.ts, design pattern → handbook, type natif Node → DefinitelyTyped.
3. `curl -s <URL>` puis `grep` ou recherche ciblée.
4. Adapter à Nodefony (préfixe `I` pour interfaces, jamais `any`, jamais `@ts-ignore`).
5. Si l'API est destinée à être réutilisée, l'ajouter au `MEMORY.md` du module (signature condensée).

## Anti-patterns à éviter

- Charger `typescriptlang.org` — JS lourd, plante l'agent.
- Reformuler le handbook dans la conversation.
- Inventer la signature d'une API @types/node — vérifier d'abord.
