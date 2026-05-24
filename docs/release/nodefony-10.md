---
title: Release Nodefony 10 — plan & décisions
status: DISCUSSION (historisation — on n'exécute PAS aujourd'hui)
date: 2026-05-24
audience: Lead Architect / mainteneur
---

# Release Nodefony 10 — plan & décisions

> **Doc VIVANT.** On ne release **pas** aujourd'hui : on **historise** les décisions au fil des
> discussions pour les exécuter plus tard. Chaque section « Décisions » est figée une fois tranchée ;
> les « Questions ouvertes » descendent dans « Décisions » quand on choisit.

---

## 1. Objectif (vision — tirée de la douleur Nodefony 1→7)

- **Ne plus maintenir N packages npm indépendants** → le versioning croisé de N packages est l'enfer
  vécu sur les versions précédentes.
- La release = **UNE version unique** ; le **build embarque les `dist/`** de tous les packages.
- Un dev qui crée une **app** part d'un **repo « dev-ready »** : la **même DX que ce repo de dev**
  (start.sh, build, Studio, HMR, `modules/`, config) **mais sans le source du framework** — il
  **consomme la distribution embarquée**.

---

## 2. Périmètre de release

| Inclus (publiable)                                                        | Exclu                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/nodefony` → package **`nodefony`** (core, nom non-scopé, historique) | `src/modules/*` (test, mediasoup, test-frontend-react/vue/angular = bancs d'essai **dev-only**) |
| `src/packages/@nodefony/*` → 16 packages scopés                           | racine `nodefony-core` (`private:true`) = **app de dev**, jamais publiée                        |

---

## 3. Inventaire (état 2026-05-24) — ⚠️ blocker `private` incohérent

> Aujourd'hui un `npm publish` ferait **l'inverse** de ce qu'on veut : le cœur est bloqué, l'IA alpha sortirait.

| Catégorie                   | Packages                                                        | `private`   | Version            | Verdict                        |
| --------------------------- | --------------------------------------------------------------- | ----------- | ------------------ | ------------------------------ |
| **Cœur** (DOIT sortir)      | http, framework, security, frontend                             | **true** ❌ | 10.0.0             | bloqués à tort                 |
| **ORM/data**                | orm-core, drizzle (défaut), user, redis, mongoose, sequelize 🪦 | false       | 10.0.0             | OK (sauf legacy à arbitrer)    |
| **IA** (Phase 12 PAS faite) | agent, llm, rag, vector, memory                                 | false ⚠️    | 10.0.0-**alpha.1** | sortiraient prématurément      |
| **Studio**                  | studio                                                          | true        | 10.0.0-**poc.1**   | POC — sortir en 10.0.0 ?       |
| **Core**                    | nodefony                                                        | false       | 10.0.0             | OK (mais pas de champ `files`) |

Constats : (a) flags `private` à recadrer ; (b) **versions mélangées** (`10.0.0`/`alpha.1`/`poc.1`) →
aucune stratégie de version ; (c) hygiène publish (`files`/`exports`) à cadrer.

---

## 4. Modèle cible proposé (à valider)

### 4.1 Mono-distribution `nodefony` à **version unique** (subpaths)

Les 16 `@nodefony/*` deviennent des **subpaths** d'un seul package : `nodefony/http`,
`nodefony/framework`, `nodefony/security`, `nodefony/drizzle`, `nodefony/studio`… **UN `package.json`,
UNE version, tous les `dist/` embarqués**. → 0 versioning croisé.

> **Déjà la direction prise** : `nodefony/react`, `nodefony/client`, `nodefony/debugbar`,
> `nodefony/roles`, `nodefony/sip|media` existent. On **généralise** le pattern subpath isomorphe.

### 4.2 Template **dev-ready** `create-nodefony`

Repo starter qui **clone la DX de ce repo** (tooling, `modules/`, config, scripts start/build, Studio,
HMR) mais **dépend de la mono-distribution** → app dev-ready out-of-the-box, sans source framework.

### 4.3 Deps externes lourdes = **optionnelles**

Le **code Nodefony** est embarqué ; les **libs tierces** (mongoose, sequelize, mediasoup, redis, SDK
LLM, mediasoup) restent `peer`/`optionalDependencies` → installées à la demande (sinon la distrib pèse
des centaines de Mo).

---

## 5. Résolution des TYPES (point délicat — `import` propre des types)

> Préoccupation user : « c'est un framework de dev → il faut importer les **types** proprement ».
> C'est LE point technique sensible du modèle mono-package + subpaths.

- **Chaque subpath doit déclarer ses types dans `exports`** (TS 4.7+ / `moduleResolution: Bundler|NodeNext`) :
  ```jsonc
  "exports": {
    "./http":      { "types": "./dist/types/http/index.d.ts",      "import": "./dist/http/index.js" },
    "./framework": { "types": "./dist/types/framework/index.d.ts", "import": "./dist/framework/index.js" }
    // … un bloc par subpath
  }
  ```
- **Le build doit ASSEMBLER les `.d.ts` générés** de chaque package sous `dist/types/<subpath>/` (jamais
  de `.d.ts` à la main — règle CLAUDE.md « types générés par Rollup uniquement »).
- **Imports de types cross-subpath** : un type de `nodefony/framework` qui référence un type de
  `nodefony/http` doit **résoudre dans la mono-distrib** (chemins internes cohérents, pas de fuite vers
  l'ancien `@nodefony/http`). Risque #1 de dérive de types.
- **Vérification automatisée** : `@arethetypeswrong/cli` (attw) sur le tarball + un **`tsc` depuis une app
  consommatrice témoin** (le template) à chaque build de release → garantit que `import { X } from
"nodefony/http"` résout type ET runtime.
- Conserver `types` (fallback TS < 4.7) **et** `exports[...].types` par subpath (cf table « Standard
  gestion des types » du `CLAUDE.md` racine).

---

## 6. Décisions à trancher (questions ouvertes)

1. **Mono-package subpaths** vs **dists vendorés** dans le template (npm install d'1 package vs repo
   auto-contenu) — ou hybride.
2. **Versioning** : lockstep strict (tout `10.0.0`) — acté comme objectif ; reste l'outillage (script de
   stamp unique vs changesets).
3. **Ce qui sort en 10.0.0** : IA (agent/llm/rag/vector/memory, Phase 12 non faite) → **dehors** ?
   Studio (POC) → dehors ou « preview » ? Sequelize 🪦 legacy → inclus mais déprécié ?
4. **Assemblage du build** : comment le build de release collecte les `dist/` + `dist/types/` des 16
   packages en une distrib cohérente (script d'assemblage + ordre topologique des deps internes).
5. **Hygiène publish** : `files`/`exports`/`.npmignore` (publier `dist/`+`dist/types/` only) ; `nodefony`
   n'a pas de `files`.
6. **Recadrage `private`** : aligner les flags sur « releasable en 10.0.0 » (libérer le cœur, geler l'IA alpha).

---

## 7. Hors scope aujourd'hui

Exécution de la release. Ce doc ne fait que **capturer** la cible et les décisions. Reprendre la
discussion → relire ce fichier d'abord.

---

## Journal des décisions

| Date       | Décision                                                                             | Statut                  |
| ---------- | ------------------------------------------------------------------------------------ | ----------------------- |
| 2026-05-24 | Périmètre = `src/nodefony` + `src/packages/@nodefony/*` (modules/\* + racine exclus) | ✅ acté                 |
| 2026-05-24 | **Version UNIQUE** + build embarque les dist (fini les N packages indépendants)      | ✅ acté (vision)        |
| 2026-05-24 | App utilisateur = **repo dev-ready** (DX du repo de dev, sans source framework)      | ✅ acté (vision)        |
| 2026-05-24 | Modèle mono-package subpaths + deps lourdes optionnelles                             | 🔶 proposé, à confirmer |
| 2026-05-24 | Résolution types par `exports[...].types` par subpath + attw + tsc témoin            | 🔶 proposé              |
