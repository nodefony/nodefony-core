---
name: nodefony-view-method-signature
description: >
  Affiche la signature d'une méthode (nom, visibilité, static, décorateurs, TSDoc) depuis l'AST
  extrait dans dist/symbols.json — évite de lire un fichier source de 500 lignes pour l'ordre des args.
  Déclencheurs : "signature de méthode", "args de fonction", "comment appeler X",
  "quels paramètres prend Y", "view method signature".
---

# view-method-signature

Interroge le graphe symbolique verbose (`dist/symbols.json`) pour extraire la signature d'une méthode ou d'une fonction sans lire le fichier source.

## Quand l'utiliser

- Avant d'appeler une méthode dont on ne se rappelle pas l'ordre des arguments
- Vérifier si une méthode est `async`, `static`, `private`, décorée par `@route`/`@inject`
- Lire la TSDoc d'une méthode sans ouvrir le fichier

## Pourquoi ça économise des tokens

`cat src/.../HttpContext.ts` = 4 000 tokens. `jq '.symbols.HttpContext.methods[] | select(.name == "render")' dist/symbols.json` = ~50 tokens. Gain ~95 %.

## Prérequis

`dist/symbols.json` doit exister. Si absent :

```bash
npm run generate-symbols
```

Le fichier verbose est gitignored mais régénéré par le hook pre-commit dès qu'un `.ts` change.

## Commandes

### Toutes les méthodes d'une classe

```bash
jq '.symbols.HttpContext.methods | map(.name)' dist/symbols.json
```

### Signature détaillée d'une méthode précise

```bash
jq '.symbols.HttpContext.methods[] | select(.name == "render")' dist/symbols.json
```

Retourne :
```json
{
  "name": "render",
  "static": false,
  "visibility": "public",
  "decorators": [],
  "description": "Render the body of the response..."
}
```

### Méthodes décorées (ex: routes d'un controller)

```bash
jq '.symbols.DefaultController.methods[] | select(.decorators | length > 0) | {name, decorators}' dist/symbols.json
```

### Signature complète d'une fonction (kind = function | decorator-fn)

```bash
jq '.symbols.injectable' dist/symbols.json
# pour la première ligne brute (verbose only) :
jq '.symbols.injectable.signature' dist/symbols.json
```

### Toutes les propriétés publiques d'une classe

```bash
jq '.symbols.Container.properties[] | select(.visibility == "public")' dist/symbols.json
```

## Fallback si la méthode n'est pas dans l'index

Cas : méthode privée, expression de classe anonyme, `Object.assign(this, …)`. Ne PAS lire tout le fichier — extraire les lignes via `grep -n` puis `sed` :

```bash
grep -n "methodName" src/path/to/File.ts
sed -n '120,135p' src/path/to/File.ts
```

## Quand NE PAS utiliser

- Pour comprendre l'**implémentation** d'une méthode → lire le corps du source
- Pour des hooks d'événements / callbacks **anonymes** → utiliser `grep` ciblé
