---
title: Audit performance du boot Nodefony
date: 2026-06-01
scope: src/nodefony (Kernel, CliKernel, Cli, commandes) — app dev complète
tools: scripts/boot-bench.mjs, scripts/boot-profile.mjs
related: project_cli_module_command_dispatch, project_log_backplane_vision, feedback_perf_memory_rule
---

# Audit — performance du boot (vers des pods cloud-native plus rapides)

## Contexte

Suite au refacto CLI « 1 seul Kernel par process » (fin du double-boot prod/cluster), audit
de la **rapidité de boot** : où part réellement le temps, et quels leviers pour accélérer le
démarrage des pods en mode cloud-native.

Mesures sur l'**app de dev** (lourde : module `test` + 4 frontends de démo + `mediasoup` +
`studio` + ORM avec la fixture Dolibarr 410 tables). Un pod réel (app minimale) bootera
sensiblement plus vite — l'audit distingue le coût **framework** (incompressible) du coût
**app** (modules chargés).

## Méthodologie

- `scripts/boot-bench.mjs <runs> -- <args>` : temps du **spawn** jusqu'à `Server Listen on http`
  - nombre de `new Kernel()` (via `NODEFONY_KERNEL_TRACE_FILE`, instrumentation ajoutée au
    constructeur Kernel — boot-only, 0 coût en prod).
- `scripts/boot-profile.mjs -- <args>` : capture du boot **horodaté**, jalons de phase + top des
  écarts inter-logs (= opérations lentes).
- Mesure isolée du coût d'`import` des vendors et du package `nodefony`.

## Résultat 1 — le double-boot ne coûtait PAS de temps

| Variante                    | Boot (médiane, prod -w1) | `new Kernel()` |
| --------------------------- | ------------------------ | -------------- |
| Avant refacto (double-boot) | **2721 ms**              | 2              |
| Après refacto (1 Kernel)    | **2776 ms**              | 1              |

Quasi identiques (écart dans le bruit). **Raison** : le kernel CLI #1 avait `kernelEvent="onStart"`
→ il s'arrêtait dès `onStart` (`setCommandComplete`) **sans booter les modules ni les serveurs** ;
seul le kernel #2 (`launchTopology`) faisait le boot complet. Le temps de boot était donc déjà
dominé par **un seul** boot complet.

➡️ Le gain réel du refacto = **mémoire & clarté** (1 container/injector/syslog au lieu de 2 → cause
racine du doublon JSONL cluster-file) et **correctness**, **pas la vitesse**. À ne pas survendre.

## Résultat 2 — décomposition du boot (app dev, ~2776 ms)

| Poste                                                                          |         Coût | Nature                                                                                                 |
| ------------------------------------------------------------------------------ | -----------: | ------------------------------------------------------------------------------------------------------ |
| Démarrage Node + **import statique** (`import nodefony` = 571 ms + graphe app) | **~1337 ms** | avant le 1er log                                                                                       |
| Gap `onPreRegister` → `MODULE ADD` (sans aucun log)                            | **~1203 ms** | **instanciation des modules app** (Dolibarr 410 tables, frontends, mediasoup, studio) — app-spécifique |
| Vendors CLI top-level de `Cli.ts`                                              |  **~180 ms** | dont inutiles en serveur                                                                               |
| Framework core (`onPreStart`→`onPreRegister`)                                  |    **~3 ms** | négligeable                                                                                            |
| ORM connect (sequelize 15 ms + drizzle 6 ms)                                   |       ~21 ms | —                                                                                                      |
| `initServers` → `Server Listen`                                                |       ~23 ms | —                                                                                                      |

**91 % du boot = import + instanciation de modules JS.** Le framework lui-même est quasi gratuit.

### Coût d'import des vendors CLI (chargés au top-level de `Cli.ts`, donc **même en mode serveur**)

| Vendor            |  Import | Utile au boot serveur ?                   |
| ----------------- | ------: | ----------------------------------------- |
| rxjs              | 49.8 ms | ❌                                        |
| shelljs           | 36.0 ms | ❌ (builder/install)                      |
| @inquirer/prompts | 27.8 ms | ❌ (interactif)                           |
| clui              | 19.0 ms | ❌ (UI CLI)                               |
| cli-color         | 18.6 ms | ⚠️ (coloring logs — utilisé via logColor) |
| node-emoji        | 10.6 ms | ❌                                        |
| semver            |  9.9 ms | ⚠️ (checkVersion)                         |
| figlet            |  6.9 ms | ❌ (banner)                               |
| moment            |  5.6 ms | ❌ (niceUptime/niceDate)                  |
| cli-table3        |  3.9 ms | ❌ (displayTable)                         |

≈ **180 ms** dont ~150 ms clairement inutiles à un serveur prod.

## Leviers priorisés

1. **Lazy-load des vendors CLI non-serveur** (`figlet`, `clui`, `shelljs`, `cli-table3`,
   `node-emoji`, `@inquirer/prompts`, `rxjs`, `moment`) dans `Cli.ts`/`Command.ts`/`Builder.ts`.
   Gain ≈ **150–180 ms par boot** (serveur ET pod), + mémoire. ⚠️ `Cli.ts` est le cœur (clc/asciify
   utilisés au boot pour logs/banner → garder) ; refacto délicat (shelljs 21 usages) → **chantier
   dédié avec filet** (`memory.test` + le filet CLI), pas en passe rapide.
2. **Lazy-load `HttpKernel` / ORM dans le core** : `Kernel.ts` importe `@nodefony/http` au top-level
   → tiré même en mode CONSOLE/batch. Un import dynamique gaté par `type==="SERVER"` allègerait le
   boot des commandes batch/daemon. Contribue aux 571 ms d'`import nodefony`.
3. **App minimale en prod** : le gap de 1203 ms est dominé par les modules de **démo** (Dolibarr 410
   tables, 4 frontends, mediasoup). Un pod réel ne les charge pas → boot bien plus rapide. Vérifier
   sur une app squelette (benchmark de référence « pod minimal » à créer).
4. **Bundling/snapshot prod** : réduire le nombre de fichiers résolus par l'ESM loader (le coût
   d'`import` est dominé par la résolution + l'évaluation de centaines de fichiers).

## Recommandation

Le double-boot étant corrigé (mémoire), la **vitesse de boot** se joue sur les imports. Prochaine
action à fort ROI : **levier #1 (lazy vendors CLI)** en session dédiée, mesuré avant/après avec
`boot-bench.mjs`, gate `memory.test` + filet CLI. Établir aussi un **benchmark « pod minimal »**
(levier #3) pour mesurer le boot réel d'un déploiement, hors modules de démo.
