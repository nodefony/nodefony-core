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
- **Jamais importé côté serveur** (ex. `vite`/`@vitejs/plugin-react` = build front séparé) →
  ⚠️ inoffensif (le bundler ne le rencontre pas), mais incohérent. Laisser OU aligner pour la propreté.

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
