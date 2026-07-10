---
title: "Migration Rollup → rolldown — plan d'exécution"
module: "transverse"
status: "PLAN — validé par les POC, aucun code écrit ; exécution en session dédiée"
audience: "framework authors"
---

# Migration Rollup → rolldown — plan d'exécution

> **Prérequis de lecture** : [`typescript-7-decorateurs-2026-07.md`](typescript-7-decorateurs-2026-07.md)
> (le pourquoi, la veille, les POC). Ce document est le **comment**.
>
> Tout ce qui suit est adossé à des POC déjà exécutés : les 19 packages ont été rejoués sous rolldown,
> avec **surface exportée identique partout**. Aucun `rollup.config.ts` ni `tsconfig.json` n'a été modifié.

## 1. Objectif

Retirer **`@rollup/plugin-typescript`**, seul lien de notre build à l'API JavaScript de TypeScript — que
TS 7 ne publie plus. Le bundler est un moyen, pas la cible : on passe à **rolldown** parce qu'il intègre la
transformation TS nativement (via oxc), pas parce que Rollup serait déprécié (il ne l'est pas).

**Non-objectifs** : toucher au lint (`typescript-eslint`) et à la doc (`typedoc`), qui restent sur TS 6
faute d'API — sans ETA. Toucher aux décorateurs (c'est le palier 3, un autre chantier).

**Pourquoi maintenant** : le framework est en développement, sans consommateurs. Une fois 10.0.0 publiée,
`dist` et `.d.ts` deviennent un contrat opposable.

## 2. Critères de succès (gates, non négociables)

À chaque lot, et impérativement avant le commit final :

1. `npm run build` → **19/19 tasks**.
2. **Surface exportée identique** pour les 19 packages : comparer `Object.keys()` de l'import réel de
   `dist/index.js` avant/après. Aucun export manquant, aucun en trop.
3. `.d.ts` : `dist/types` **et** `dist/client/types` — mêmes fichiers, mêmes exports d'`index.d.ts`.
4. Tests : core **1809**, http **568** (`test:integration`) + **9/9** (`test:memory`), framework 30,
   security 55, drizzle 22, realtime 21, orm-core 13, user 13.
5. Le serveur démarre (skill `nodefony-start-server`) et la debugbar standalone se charge.

> Le gate mémoire (`test:memory`) est obligatoire : on touche la chaîne qui produit le code du pipeline
> request.

## 3. Lot 0 — Prérequis, indépendants du bundler (mergeable seul)

Ces trois points sont des **défauts réels**, révélés par les POC. Ils se corrigent avant, et se
mergent séparément — ils ont de la valeur même si la migration est abandonnée.

**0.a — Self-import de `@nodefony/http`.** `nodefony/src/context/http/Request.ts:28` fait
`import { HttpError } from "@nodefony/http"` : le paquet s'importe **par son propre nom**. Rollup masque le
problème ; rolldown suit le lien et avale le `dist/` (65 → 120 fichiers). **Seul self-import du repo**
(vérifié sur les 19). → le passer en import relatif.

**0.b — `zod` non externalisé dans `@nodefony/frontend`.** Contrairement à `http`, `orm-core`, `realtime`…
Conséquence : `zod` est bundlé dans le `dist` de frontend. → l'ajouter à sa liste `external`.

**0.c — Code mort.** Mesuré :

| Cible                                       | Constat                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@rollup/plugin-terser`                     | **3 déclarations npm, 0 usage réel**                                                                         |
| `rollup-plugin-copy`                        | 1 déclaration, 0 usage                                                                                       |
| `@rollup/plugin-commonjs`                   | 3 déclarations, 1 usage (core seulement)                                                                     |
| Lignes commentées dans 9 `rollup.config.ts` | 28 (imports + appels de plugins désactivés)                                                                  |
| `external` du core                          | 7 entrées mortes : `pm2` (retiré du framework), `typedoc`, `rollup`, `terser`, `glob`, `lodash`, `lodash-es` |

> ⚠️ Les `rollup.config.ts` seront **réécrits** au lot 2/3. Ne pas y investir de nettoyage cosmétique :
> supprimer seulement les **deps npm mortes** (terser, copy) et les **entrées `external` mortes** si elles
> sont reportées telles quelles dans la config rolldown. Le code commenté disparaît de fait avec la
> réécriture.

## 4. Lot 1 — Socle

Créer une **config rolldown partagée** à la racine (source unique, comme `vitest.oxc.ts`), qui porte :
`platform`, `preserveModules`, `preserveModulesRoot`, le `treeshake` (dont `moduleSideEffects`), et
l'externalisation **systématique du nom propre du paquet** (garde-fou anti self-import, cf 0.a).

Puis découpler les déclarations : `.d.ts` générés par **`tsgo --emitDeclarationOnly`**, hors du bundler.

- `rootDir` explicite requis à l'émission (TS 7 lève `TS5011`) — **13 tsconfig**.
- ⚠️ `declarationDir` du tsconfig **écrase `--outDir`** : passer `--declarationDir` explicitement, sinon
  tsgo écrit dans le vrai `dist`.
- Exclure `rollup.config.ts` du tsconfig d'émission (`TS6059`, hors `rootDir`) — le
  `tsconfig.declarations.json` existe déjà pour ça.
- `isolatedDeclarations` **n'est pas requis** (tsgo a le vérificateur complet). Pour mémoire, s'il fallait
  un jour générer les `.d.ts` par le bundler : ≈ 277 annotations (security 149, core 88, realtime 21,
  drizzle 16, orm-core 3).

Ajouter `rolldown` en devDep. **Ne jamais** utiliser un alias npm pour un binaire homonyme (leçon `tsgo` :
un alias n'a pas renommé `tsc` et a écrasé `.bin/tsc`). Pour retirer un paquet de test :
`git checkout package.json package-lock.json && npm install` — **jamais** `npm uninstall` (a délogé
TypeScript 6.0.3 et exposé un 5.7.3 transitif).

## 5. Lot 2 — Le core (4 bundles)

Le cas le plus dur, déjà rejoué : node (`preserveModules`, 24 externals), bin (shebang,
`exports: "default"`), **client isomorphe** (4 entrées, plugin `resolveId` maison), debugbar standalone.

Résultats POC :

| Bundle           | Rollup    | rolldown                                                                                  |
| ---------------- | --------- | ----------------------------------------------------------------------------------------- |
| node             | 96 `.js`  | 97 — **137 exports identiques**, `Container` s'instancie, `reflect-metadata` actif        |
| bin              | 3 089 o   | 2 222 o, shebang correct                                                                  |
| client isomorphe | 31 `.js`  | 31 — **arborescence identique**, exports 43/13/20/11, `react` externe, 0 fuite de builtin |
| standalone       | 170 939 o | 128 664 o (−25 %), 0 import résiduel                                                      |

**Cinq plugins disparaissent** (rolldown les fait nativement) : `@rollup/plugin-typescript`,
`-node-resolve`, `-commonjs`, `-json`, `rollup-plugin-polyfill-node`. Le `browserShim` maison est
**conservé tel quel** (API plugin compatible).

Le `treeshake.moduleSideEffects` qui préserve le side-effect de `reflect-metadata` — piège documenté dans
le `rollup.config.ts` actuel — est **honoré** par rolldown. Ne pas le perdre : sans lui,
`Reflect.defineMetadata is not a function` au runtime.

**Temps** : 20 473 ms → ~195 ms pour les 4 bundles.

## 6. Lot 3 — Les 18 autres packages + l'application racine

Tous rejoués, **18/18 avec surface exportée identique**. Ordre suggéré, du plus simple au plus exposé :
`llm`, `studio`, `documentation`, `redis`, `mediasoup`, `test-frontend-*` → `user`, `orm-core`, `drizzle`,
`mongoose` → `realtime`, `framework`, `frontend` → `http`, `security`, `test`.

**L'application racine est le 20ᵉ build** (le repo agit comme une app utilisateur) : son
`rollup.config.ts` a exactement la forme standard (index.ts + glob `nodefony/**` + external) → migrée
par le même helper partagé. **Exigence release (contexte `create app`)** : le bundler d'application
doit être _très propre_ — une app consommatrice du framework en mode `import` ne peut PAS dépendre
d'un fichier interne du repo (`rolldown.shared.ts`). Livrable Phase 2 release : **publier le helper
dans le package `nodefony`** (subpath type `nodefony/bundler`) pour que le scaffold `create app`
génère une config de 3 lignes (`import { defineAppConfig } from "nodefony/bundler"`). La config
racine du repo sert de config de référence de ce que `create app` générera.

Total : 854 fichiers Rollup (dont **76 chunks vides**) → 951 rolldown (**0 vide**). Les `+2/+3` récurrents
sont les helpers oxc (`_virtual/@oxc-project/runtime/helpers/{decorate,decorateMetadata,decorateParam}`),
**bundlés** — donc pas de dépendance runtime à déclarer (contrairement à Rollup + `unplugin-oxc`).

Cas particulier `frontend` : 40 → 104 fichiers mais **290 Ko → 237 Ko** (zod découpé plus finement, mieux
tree-shaké). Le lot 0.b le règle.

## 7. Lot 4 — Ce qui n'a PAS été testé

- **Mode `watch` / dev** (`DevSupervisor`). Le seul angle du build non couvert par les POC.
- **Sourcemaps** : `rollup-sourcemap-path-transform` (6 packages) — cosmétique, remappe les chemins.
  Vérifier l'équivalent rolldown, ou accepter la perte en dev.
- `treeshake.tryCatchDeoptimization` : **n'existe pas** chez rolldown (avertissement, non bloquant).

## 8. Lot 5 — Bascule et nettoyage

Une fois les 19 packages verts : retirer `rollup` et les 4 plugins `@rollup/*` des devDeps, mettre à jour
`turbo.json` si les scripts changent, et corriger la doc (`CLAUDE.md` racine dit « Bundler : Rollup — ne
pas remplacer » : **cette ligne devra être réécrite**, avec l'accord explicite du mainteneur).

## 9. Rollback

Chaque lot est un commit isolé. Le retour arrière est un `git revert` : le `dist` est regénéré à partir des
sources, et aucun artefact n'est publié pendant le chantier. Le gate #2 (surface exportée) est la sentinelle
— s'il casse, on ne commite pas.

## 10. Pièges gravés (issus des POC — ne pas les redécouvrir)

1. **Self-import** : un paquet qui s'importe par son nom fait avaler son `dist` par rolldown. Externaliser
   systématiquement le nom propre du paquet.
2. **`declarationDir` écrase `--outDir`** : tsgo écrira dans le vrai `dist` si l'on ne passe pas
   `--declarationDir`.
3. **Registres globaux** : importer deux builds du même paquet dans un seul process explose
   (`EntityRegistry: entity "session" already registered`). Comparer les exports dans des **process isolés**.
4. **`npm uninstall`** peut déloger une dep hoistée et en exposer une transitive plus ancienne. Restaurer
   par `git checkout package.json package-lock.json && npm install`.
5. **Alias npm ≠ renommage de binaire** : `tsgo@npm:typescript@7` écrase `.bin/tsc`.
6. **`reflect-metadata`** doit garder son side-effect au tree-shaking.

## 11. Ce qui reste sur TypeScript 6 après la migration

`typescript-eslint` (peer `<6.1.0`, issue fermée `not planned`) et `typedoc` (« no timeline ») importent
`ts.createProgram`. Ils resteront sur `typescript@6.0.3` — installé de toute façon — jusqu'à l'API TS 7.1,
annoncée « nouvelle et différente », **sans calendrier**. Le typecheck, lui, tourne déjà sur `tsgo`
(commit `fbd1d6ae`, ×6 à ×8, 0 erreur).
