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

Chaque paquet Nodefony maintient **à la main** sa liste `external` dans `rolldown.config.ts` ET son
manifeste dans `package.json` → **duplication = dérive**. Symptôme vécu : une dépendance absente de
`external` est **bundlée** par rolldown — soit ça casse au build (`@nodefony/user` non externalisé →
rolldown suit jusqu'à `@node-rs/bcrypt` natif → `"hash" is not exported`), soit ça passe inaperçu et
le paquet publié embarque une copie d'une bibliothèque que npm installera **en plus**.

## 1. Lancer l'audit — la commande appartient au DÉPÔT

```bash
node scripts/check-externals.mjs          # rapport lisible ; sort 1 si défaut
node scripts/check-externals.mjs --json   # relevé brut
npx vitest run scripts/check-externals.test.mjs   # la suite de l'audit lui-même (16 cas)
```

> 🔴 **Pourquoi une commande du dépôt et non un bloc de shell ici.** La version précédente de ce
> skill portait un `awk` qui supposait `const external: string[] = [ ... ]`. La migration rolldown a
> fait passer **20 configs sur 21** à `defineNodefonyRolldownConfig({ external: [...] })` : l'audit
> a cessé de lire quoi que ce soit, **sans jamais le dire**, et personne ne s'en est aperçu — c'est
> ainsi que `zod` s'est retrouvé bundlé dans le module `test`. Un contrôle qui vit dans le dépôt est
> lancé, testé et corrigé avec lui ; un contrôle recopié dans un skill se périme en silence.

## 2. Lire le rapport — deux mesures qui échouent différemment

**§1 PREUVE — ce qui est réellement bundlé.** Lue dans les `dist/` (`dist/**/node_modules/<paquet>`),
elle ne suppose rien du format des configs. C'est la mesure qui trouve, pas celle qui anticipe.
⚠️ Elle ne vaut que sur un `dist/` **frais** — le rapport nomme les modules sans dist plutôt que de
les compter verts. Avant de conclure sur un diff non commité :
`npx turbo run build --force --filter=<paquet>`.

**§2 DÉRIVE — le manifeste hors `external`.** Elle anticipe le prochain build. Tout manque n'est pas
un défaut :

- **⛔ défaut** — le paquet est importé par du code serveur bundlé (`index.ts` + `nodefony/**`, hors
  tests) : il **sera** avalé. Le rapport nomme le fichier importateur.
- **⚠️ information** — jamais importé côté serveur. Le `vite`, le `react` ou le `vue` d'un module à
  frontend est dans ce cas : rolldown ne l'atteint pas. Ne rien y faire.
- **audit sans objet** — le paquet emploie `externalDeps: true`, qui externalise tout le manifeste.

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
- **Conclure « vert » sur la §1 sans dist frais** — l'absence de preuve n'est pas une preuve
  d'absence, et le rapport le dit explicitement (`sans dist, donc NON prouvés`).
- **Recopier ici la commande d'audit** : c'est ce qui l'a laissée se périmer une première fois.

## Liens

- Cas vécu : `@nodefony/user` peerDep non externalisée (commit P5.9 drizzle).
- Convention types/exports/peerDeps : `CLAUDE.md` racine (« Standard gestion des types »).
