---
name: nodefony-check-externals
description: >
  Audite la dérive entre la liste `external` des rolldown.config.ts et les `peerDependencies` de
  chaque package.json Nodefony — détecte le bug « peerDep bundlée » (cause d'échecs de build
  type @node-rs/bcrypt) et les entrées external périmées. Anti-duplication : la même liste est
  maintenue à la main à deux endroits → dérive garantie. À charger avant une publication npm ou
  devant un échec de build qui parle d'un paquet natif ou d'un module introuvable à l'exécution.
  Déclencheurs : "check externals", "audit externals", "external rolldown", "peerDeps externalisées",
  "duplication external", "vérifie les external", "le bundler avale un peerDep", "avant de publier
  sur npm", "erreur de build sur une dépendance native", "module introuvable au runtime".
---

# nodefony-check-externals

Chaque module Nodefony maintient **à la main** sa liste `external` dans `rolldown.config.ts` ET ses
`peerDependencies` dans `package.json` → **duplication = dérive**. Symptôme vécu : un peerDep absent
de `external` est **bundlé** par rolldown → casse au build (ex. `@nodefony/user` non externalisé →
rolldown suit jusqu'à `@node-rs/bcrypt` natif → `"hash" is not exported`). Ce skill détecte la dérive.
Zéro prose.

## 1. Audit (tous les modules)

```bash
cd /Users/cci/repository/nodefony-core
for cfg in src/nodefony/rolldown.config.ts src/packages/@nodefony/*/rolldown.config.ts; do
  dir=$(dirname "$cfg"); pkg="$dir/package.json"; [ -f "$pkg" ] || continue
  name=$(node -p "require('./$pkg').name" 2>/dev/null)
  ext=$(awk '/const external/{f=1} f{print} /\];/{if(f)exit}' "$cfg" \
        | grep -oE '"[^"]+"' | tr -d '"' | sort -u)
  peers=$(node -p "Object.keys(require('./$pkg').peerDependencies||{}).join('\n')" 2>/dev/null | sort -u)
  missing=$(comm -23 <(printf '%s\n' "$peers") <(printf '%s\n' "$ext") | grep -v '^$')
  [ -n "$missing" ] && { echo "⛔ $name : peerDeps absents de external →"; echo "$missing" | sed 's/^/     /'; }
done
echo "--- fin ---"
```

> Hypothèse de format : `const external: string[] = [ ... ];` (tous les modules le suivent au
> 2026-05). Si un module diverge, ajuster l'`awk`.

## 2. Interpréter — tout « missing » n'est pas un bug

Pour chaque peerDep absent de `external`, vérifier s'il est **importé par le code serveur** du module :

```bash
# ex. le peerDep "vite" est-il importé par du .ts bundlé (hors tests/frontend) ?
grep -rnE "from ['\"]<dep>['\"]|require\(['\"]<dep>" src/packages/@nodefony/<mod>/nodefony src/packages/@nodefony/<mod>/index.ts
```

- **Importé côté serveur + absent de external → ⛔ BUG** (sera bundlé). À corriger (étape 3).
- **Jamais importé côté serveur** → ⚠️ inoffensif pour le bundler, mais l'entrée `external` est
  légitime dès qu'un `await import()` la vise. Un `external` **sans peer correspondante n'est donc
  PAS une dérive** — voir la règle ci-dessous.

### 🔴 Un outil de BUILD ne se déclare JAMAIS en `peerDependencies` — même optionnelle

Constaté trois fois dans ce dépôt, corrigé trois fois : `vite` et ses plugins
(`@nodefony/frontend`, `@nodefony/studio`), puis `rolldown` (`nodefony`, pour le subpath
`nodefony/bundler`).

**Le mécanisme, et pourquoi « optionnelle » ne protège pas.** Une peer est _satisfaite_ par le
paquet que l'application installe en `devDependencies`. `npm prune --omit=dev` considère alors
qu'il appartient à l'arbre de **production** et le garde — refaire l'arbre depuis zéro n'y change
rien, le `package-lock.json` l'a figé. L'outil voyage donc dans l'image, et rien ne le signale.

**Ce que ça coûte, mesuré** sur une image d'application à frontend : `node_modules` 161 → 106 Mo,
image 542 → 472 Mo. Mais le vrai dégât n'est pas le poids : la garde de `FrontendService.setupProd`
qui refuse la page blanche muette (« vite indisponible → ERREUR nommée ») était **inatteignable**,
puisque vite était toujours là pour reconstruire en silence. Une garantie écrite, jamais exécutable.

**Le test qui tranche** : le paquet importe-t-il l'outil au RUNTIME ? Si l'import n'a lieu qu'au
build (`rolldown.config.ts`, `await import()` d'un builder), alors ni `dependencies`, ni
`peerDependencies` — `devDependencies` du paquet pour ses propres tests, et l'application le
déclare pour elle-même (versions : source unique `scaffold/versions.ts`). Corollaire : **aucun
framework front** (`vue`, `react`…) dans les `dependencies` d'un builder générique — `vue` y était,
et tirait TypeScript, 26,6 Mo dans toute application, même React.

Le contrôle vit dans le smoke release (`--scenario front`) : il refuse une image contenant `vite`,
`vue` ou `typescript`, puis vérifie que l'ERREUR nommée s'affiche. Sans lui, la régression revient
par une ligne de manifeste — et l'image marche.

## 3. Corriger (rolldown.config.ts est PROTÉGÉ → accord user)

Ajouter le peerDep manquant à la liste `external` du module — mirror des entrées existantes :

```ts
const external: string[] = [
  "nodefony",
  "@nodefony/orm-core",
  "@nodefony/<dep-manquante>",   // ← ajout
  ...
];
```

Le matcher gère `id === e` et `id.startsWith(e + "/")`. **Demander l'accord** avant d'éditer
`rolldown.config.ts` (règle CLAUDE.md). Rebuild + relancer l'audit pour confirmer.

## 4. Root cause (proposer, ne pas imposer)

La duplication EST le problème. Fix DRY = **dériver `external` des `peerDependencies`** au lieu de
la rétaper :

```ts
import pkg from "./package.json" with { type: "json" };
const external = [
  ...Object.keys(pkg.peerDependencies ?? {}),
  "tslib", // + extras non-peer (builtins gérés à part)
];
```

- Avantage : zéro dérive possible (source unique = package.json).
- Coût : édition de **chaque** `rolldown.config.ts` (protégé → accord) + vérifier que les extras
  non-peer actuels (`tslib`, builtins `node:*`) restent couverts.
- À faire en une passe dédiée, pas opportunément.

## Anti-patterns

- Ajouter aveuglément tous les « missing » à external — vérifier d'abord l'usage serveur (étape 2).
- Éditer `rolldown.config.ts` sans accord (fichier protégé).
- Corriger un module à la main sans relancer l'audit global (la dérive est systémique).

## Liens

- Cas vécu : `@nodefony/user` peerDep non externalisée (commit P5.9 drizzle).
- Convention types/exports/peerDeps : `CLAUDE.md` racine (« Standard gestion des types »).
