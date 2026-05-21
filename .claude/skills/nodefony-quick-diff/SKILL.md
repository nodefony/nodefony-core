---
name: nodefony-quick-diff
description: Résume les modifications non commitées sur `src/` uniquement (ignore les `dist/`, `node_modules`, fichiers générés) avant un build ou un test. Évite de polluer le contexte avec des fichiers compilés. Mots-clés : "diff rapide", "qu'est-ce que j'ai modifié", "quick diff", "voir les changements src", "git diff propre".
---

# quick-diff

Affiche un diff chirurgical sur les sources TypeScript uniquement (`src/`) avec format minimal pour validation rapide.

## Quand l'utiliser

- Juste après une série d'édits avant de lancer build ou tests
- Pour vérifier l'étendue d'un fix avant de commit
- Pour identifier les modules impactés avant un restart serveur

## Pourquoi ça économise des tokens

`git diff` sans filtre renvoie aussi les `dist/`, fichiers de lock, `.ai/symbols.json` régénéré, screenshots, etc. → des centaines de lignes inutiles. Ce skill cible `src/` et ignore les blancs.

## Commandes

### Vue synthétique (fichiers modifiés)

```bash
git diff --stat src/
```

### Diff complet (sources seulement, sans blancs)

```bash
git diff -w src/
```

### Inclure les fichiers staged + non staged

```bash
git diff -w HEAD src/
```

### Fichiers `docs/` et `.claude/` aussi (si on travaille la doc)

```bash
git diff --stat src/ docs/ .claude/
```

### Exclure expressément les fichiers générés (au cas où)

```bash
git diff -w -- src/ ':!**/dist/**' ':!**/node_modules/**'
```

### Lister les modules workspace impactés

```bash
git diff --name-only HEAD src/ | awk -F'/' '{
  if ($2 == "packages" && $3 == "@nodefony") print "@nodefony/" $4;
  else if ($2 == "modules") print "modules/" $3;
  else if ($2 == "nodefony") print "@nodefony/core";
}' | sort -u
```

## Quand NE PAS utiliser

- Pour voir le contenu d'un fichier spécifique → `git diff src/path/to/file.ts`
- Pour comparer deux branches → `git diff main...HEAD -- src/`
- Pour explorer un commit ancien → `git show <sha> -- src/`
