---
title: "nodefony-load-test — fiche de skill"
navTitle: nodefony-load-test
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-10-09
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-load-test/SKILL.md"
---

# `nodefony-load-test`

> Charge, stress et DIMENSIONNEMENT HTTP/WebSocket de Nodefony : suites Vitest versionnées (non-régression, sondes de rupture derrière un flag) et une trentaine de scripts autonomes (plafond de connexions WS, débit, RPS et percentiles, capacité d'un pod, e2e cluster).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-load-test**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **0/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Exécuter, diagnostiquer, mesurer |
| Corps | 532 lignes |
| Coût d'activation | ~9 389 tokens (le corps est chargé à l'invocation) |
| Description | 986 / 1024 caractères |
| Déclencheurs | 16 |
| Ressources `references/` | 5 page(s) |
| Scripts | 70 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Charge, stress et DIMENSIONNEMENT HTTP/WebSocket de Nodefony : suites Vitest versionnées (non-régression, sondes de rupture derrière un flag) et une trentaine de scripts autonomes (plafond de connexions WS, débit, RPS et percentiles, capacité d'un pod, e2e cluster). **À charger AVANT de lancer un de ces scripts** : le script produit un chiffre, c'est le protocole qui en fait une mesure — décor requis, médiane de N runs, et les pièges qui ont déjà produit des chiffres faux (mesurer sous rafale ne mesure pas la latence, une variance ×3 ne tranche rien).

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **serveur UP** · **redis** · **docker** · **base de données**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`html-report`](nodefony-html-report.md) · [`start-server`](nodefony-start-server.md) · [`tail-error-logs`](nodefony-tail-error-logs.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`test de charge` · `stress` · `benchmark` · `combien de connexions` · `jusqu'à la rupture` · `RPS` · `latence p99` · `est-ce que ça tient la charge ?` · `combien de pods ?` · `c'est plus rapide ?` · `impact perf de ce changement ?` · `mesurer avant/après` · `dimensionner` · `pourquoi plus lent que X` · `où part le CPU d'une requête` · `profiler`

## Ce que contient le corps

- Niveau 1 — Suites vitest versionnées (non-régression)
- Niveau 2 — Scripts client standalone (exploration)
- Niveau 3 — A/B perf MONO PROD (coût du pipeline par requête)
- Repères empiriques (loopback, machine 32 GB) — pour situer un résultat
- 🚨 RÈGLE N°0 — le coût d'une requête se juge COMPARÉ, avant tout audit
- 🚨 RÈGLE N°1 — aucun chiffre sans contrôle de validité
- 🚨 RÈGLE N°1 bis — LATENCE et BLOCAGE sont deux grandeurs ; une seule plafonne un process
- 🚨 RÈGLE N°1 ter — la machine doit être CALME, et le thermal ne suffit pas
- 🚨 RÈGLE N°2 — un banc e2e a un DÉCOR ; décor manquant ≠ échec
- Chercher une FUITE : une PENTE, jamais un delta — `scripts/soak.mjs`
- Publier les résultats (HTML) — et la question à poser AVANT
- Gotchas (vécus — ne pas réapprendre)
- Références
- Liens

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/ab-perf-mono-prod.md` | Niveau 3 — A/B perf mono prod : détails | 148 |
| `references/catalogue.md` | Catalogue des scripts — ce que chacun prouve | 322 |
| `references/profil-compare.md` | Profil comparé — le coût d'une requête face à un témoin équitable | 65 |
| `references/protocoles-bancs-charge.md` | Protocoles détaillés des bancs de charge les plus utilisés | 237 |
| `references/reperes-empiriques.md` | Repères empiriques — pour situer un résultat | 30 |


## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/aimd-demo.mjs` | aimd-demo — démonstration LISIBLE et déterministe de la cadence adaptative (AIMD). | — | `DIST` |
| `scripts/app-download-probe.mjs` | `binaryType` par défaut de `ws` = "nodebuffer" : `raw` est toujours un `Buffer` ici. | — | — |
| `scripts/bench-ab-mono.sh` | Banc perf A/B — mono process PRODUCTION. Mesure le COÛT DU PIPELINE PAR REQUÊTE. | `--latency` `--show-toplevel` | `BENCH_CONN` `BENCH_DUR` `BENCH_EXPECT_STATUS` `BENCH_INDEX_TARGET` `BENCH_THERM_TARGET` `BENCH_THREADS` `BENCH_URL` `BENCH_WARMUP` `NF_BENCH_OUT` |
| `scripts/bench-out.mjs` | Dossier des sorties de banc, côté JavaScript — miroir de `bench-out.sh`. | `--show-toplevel` | `NF_BENCH_OUT` |
| `scripts/bench-out.sh` | shellcheck shell=bash Où les bancs écrivent leurs sorties (médianes `.med`, détails `.json`, séries refusées, relevés de sonde, journaux, pid) — SEULE définition, sourcée par bench-ab-mono.sh, bench-frameworks/bench.sh, bench-pairs.sh et perf-campaign.sh. | `--show-toplevel` | `NF_BENCH_OUT` |
| `scripts/bench-out.test.mjs` | Les deux copies de la règle « où vont les sorties de banc » — bench-out.sh (bancs bash) et bench-out.mjs (rapports, soak) — rendent le même dossier. | — | `NF_BENCH_OUT` |
| `scripts/bench-report.mjs` | Rapport HTML d'un (ou plusieurs) résultats de banc — pour un HUMAIN qui décide. | — | `OUT` |
| `scripts/bench-request.sh` | La requête d'un banc — UNE implémentation, sourcée par `bench-ab-mono.sh` (camp Nodefony) ET `bench-frameworks/bench.sh` (camps témoins). | `--data` | `BENCH_BODY` `BENCH_EXPECT_STATUS` `BENCH_HEADER` `BENCH_METHOD` |
| `scripts/boot-bench.mjs` | boot-bench.mjs — mesure le temps de boot d'un mode Nodefony (du spawn jusqu'à ce que les serveurs écoutent) et compte le nombre de `new Kernel()` via NF_KERNEL_TRACE_FILE. | `--workers` | — |
| `scripts/boot-profile.mjs` | boot-profile.mjs — AUDIT fin du boot Nodefony. Capture la sortie horodatée d'un boot (jusqu'à "Server Listen on http") et révèle où part le temps : - jalons de phase (onPreStart→onPostReady + Server Listen) avec leur t (ms depuis le 1er log) - top des plus gros écarts entre 2 logs consécutifs (= opérations lentes du boot) | `--workers` | — |
| `scripts/capacity-html.mjs` | capacity-html.mjs — rendu du rapport de capacité. | `--accent` `--dim` `--rupture` | `PAYLOAD` `REPEAT` |
| `scripts/capacity.mjs` | capacity.mjs — BANC DE CAPACITÉ + rapport de dimensionnement. | `--capacity` `--json` `--out` `--rupture` `--seconds` `--short` `--skip-ws` `--sockets` `--target` | `HOST` `JSON_OUT` `MAX_SPREAD` `MIN_ELU_SAMPLES` `MIN_R2` `NF_ADMIN_PASSWORD` `NF_ADMIN_USER` `NF_HOST` `NF_PORT` `NF_PORT_HTTPS` `OUT` `PAYLOAD` `PCLR` `PTLS` `REPEAT` `ROUTE` |
| `scripts/cluster-health-endpoint-e2e.mjs` | Preuve BOUT-EN-BOUT de la forme JSON de l'ENDPOINT santé en mode cluster — ce que le panneau Studio « Realtime Hub » (vue pod) consomme réellement. | — | `E2E_ROLE` `SETTLE` |
| `scripts/cluster-ipc.mjs` | Bench du FIL IPC du backplane cluster Nodefony (mode sans PM2) — mesure le coût RÉEL du fan-out cross-process worker→MASTER(gateway)→workers, AVANT Redis. | — | `BATCH` `BENCH_ROLE` `CHANNEL` `DURATION` `MODE` `PAYLOAD` `RATE` `WORKERS` |
| `scripts/cluster-orm-rich-e2e.mjs` | Preuve BOUT-EN-BOUT du RELAIS ORM RICHE @pid (drill cluster, facette "orm") — sans navigateur. | — | `E2E_ROLE` `SETTLE` |
| `scripts/cluster-probe-e2e.mjs` | Preuve BOUT-EN-BOUT de la SONDE AGRÉGÉE pod (cluster sans PM2) — Phase 4c, mode push. | — | `E2E_ROLE` `SETTLE` |
| `scripts/cluster-realtime-e2e.mjs` | Preuve BOUT-EN-BOUT du realtime cross-process Nodefony (cluster sans PM2) — Phase 4b. | — | `E2E_ROLE` `SETTLE` |
| `scripts/config-env-override-e2e.mjs` | Banc e2e TERRAIN — override de config par variable d'environnement (ADR-0006) — sans navigateur. | — | `BOOT_TIMEOUT_MS` `FAIL_TIMEOUT_MS` `HTTPS_PORT` `HTTP_PORT` |
| `scripts/cut-analyze.mjs` | Relit une bissection par court-circuit (`NF_WAIT_CUTS` de `wait-compare.sh`) et rend le COÛT DE CHAQUE ÉTAGE en µs de CPU du fil principal par requête. | `--partial` | `KEY` `MAX_SPREAD` |
| `scripts/cut-probe.mjs` | Bissection par COURT-CIRCUIT du pipeline HTTP — préchargée dans le serveur (`NODE_OPTIONS=--import=…/cut-probe.mjs`), jamais dans le produit. | — | `NF_BENCH_CUT` |
| `scripts/db-backend-cost.mjs` | db-backend-cost — ce qu'un backend de base de données coûte AU SERVEUR, et non ce qu'il coûte en lui-même. | `--ceiling` `--prove` | `CONC` `JSON_OUT` `LIMIT` `NF_DATABASE_URL` `NF_PG_URL` `PG_CONTAINER` `REPS` `ROWS` `SEC` `SERIES` |
| `scripts/debug-runtime-e2e.mjs` | Banc e2e TERRAIN — debug runtime par-module à chaud — sans navigateur. | — | — |
| `scripts/decor-probe.mjs` | Garde de DÉCOR d'un banc de débit Nodefony — préchargée (`node --import`) dans le serveur mesuré. À la PREMIÈRE requête, elle refuse (code 3) si un hook du chemin de requête a un écouteur : un seul suffit à faire passer chaque requête par `fireAsync` (une Promise, une microtâche), coût qu'une application sans ce hook ne paie pas — et que le banc imputerait au framework. Vécu deux fois sur #508, les deux fois posé par le module test (`onRequestScope`, puis `beforeResolve`) ; la seconde n'a été vue qu'au chronométrage in situ, parce que rien ne la cherchait. | — | — |
| `scripts/graceful-shutdown-e2e.mjs` | Banc e2e du GRACEFUL SHUTDOWN (@nodefony/http, trous 1+3 revue 0.7) — sans navigateur. | `--detach` `--wait` | `HTTP_SLOW_URL` `PORT` `WS_URL` |
| `scripts/http-load.mjs` | Stress HTTP — N requêtes avec concurrence C sur une route Nodefony. Mesure : RPS, latence p50/p90/p95/p99/max, distribution des codes, erreurs. | — | `BODY` `METHOD` `URL` `URL_STR` |
| `scripts/hub-load.mjs` | Charge de la SOCKET Nodefony côté HUB (RealtimeHub) — fait bouger le panneau « Realtime Hub » de Studio (/nodefony/hub) + l'endpoint /nodefony/realtime/api/health. | — | `ADMIN_USER` `BASE` `BATCH` `HOLD` `HOLD_MS` `HOST` `HTTP_PATH` `HTTP_RPS` `MODE` `NF_BENCH_ADMIN_PASSWORD` `NF_BENCH_ADMIN_USER` `NODE_TLS_REJECT_UNAUTHORIZED` `PORT` `WS_URL` |
| `scripts/ic-sites.mjs` | Lit un journal V8 `--log-ic` et rend les sites d'accès aux propriétés qui ont basculé en MÉGAMORPHE (état `N`) — là où V8 renonce au chemin rapide et passe par un cache global (`LoadIC_Megamorphic`, `KeyedLoadIC_Megamorphic`…). | `--log-ic` `--logfile` `--no-logfile-per-isolate` | — |
| `scripts/idempotency-cluster-e2e.mjs` | Banc CROSS-WORKER de l'idempotence distribuée Redis (cluster multi-process, P6.8) — sans navigateur. | `--detach` `--wait` `--workers` | — |
| `scripts/idempotency-postgres-e2e.mjs` | Banc CROSS-POD de l'idempotence distribuée Drizzle/PostgreSQL (axe 3, P6.8) — sans navigateur. | `--profile` | `CONC` `PG_URL` `ROUNDS` |
| `scripts/idempotency-userland-e2e.mjs` | Banc e2e USERLAND @Idempotent contre un VRAI Redis (single-pod, P6.8) — sans navigateur. | — | — |
| `scripts/kill-guard.sh` | Garde de mise à mort des bancs — À SOURCER, jamais à exécuter. | — | — |
| `scripts/log-sink-contention.mjs` | Microbench ISOLÉ du driver de sink de log (LB.W / axe W2). | — | `DIR` `JSON_OUT` `LINES` `ONLY` `RUNS` `VARIANT` `WARMUP` `WID` `WORKERS` |
| `scripts/machine-regime.sh` | RÉGIME MACHINE — l'état du processeur au moment d'une mesure. | `--format` | — |
| `scripts/native-sample.mjs` | Lit une capture `sample <pid> <s> -file <f>` (macOS) et rend le temps PROPRE du fil principal, par famille et par frame, en µs par requête — et, quand la table `perf.map` du process est posée à côté de la capture, QUI l'a payé : chaque échantillon natif est imputé à son premier ancêtre JavaScript. | `--accept-noise` `--cpu-prof` `--dir` `--perf-basic-prof` `--prof` | `MAX_DISPERSION` |
| `scripts/native-sample.test.mjs` | Éprouve le lecteur de captures `sample` (native-sample.mjs) sur une capture miniature écrite à la main : temps propre, nommage par perf.map, imputation au premier ancêtre JS, moyenne par camp. Un changement du format de `sample` ou de la table perf doit faire tomber ce test, pas fausser un banc en silence. npx vitest run .claude/skills/nodefony-load-test/scripts/native-sample.test.mjs | `--accept-noise` `--dir` | — |
| `scripts/perf-campaign.sh` | Campagne de mesure PUBLIABLE, sans surveillance — la matière de `docs/performance/data/<version>.json`, rejouée au protocole de la dernière publication : trois paires de débit, le cas applicatif, et une tenue longue. | `--at` `--conn` `--minutes` `--only` `--out` `--porcelain` `--short` `--soak-min` `--tries` `--window` | `NF_PARITY_CAMPS` `ONLY` `SOAK_MIN` `TRIES` |
| `scripts/perf-compose.mjs` | Compose `docs/performance/data/<version>.json` depuis le dossier d'une campagne (`perf-campaign.sh`) — les CHIFFRES, jamais le récit. | `--absent` `--allow-missing` `--campaign` `--capacity` `--data` `--format` `--json` `--only` `--quiet` `--reuse` `--soak` `--version` `--write` | `CAMPAIGN` `DATA` |
| `scripts/perf-dossier-report.mjs` | Rapport HTML de synthèse — dossier Performance de Nodefony. | `--data` `--prove` | `OUT` |
| `scripts/poc-bench.mjs` | POC bench — mesure la latence p50/p95/p99 du backend Nodefony pendant que Vite tourne / compile. | `--concurrency` `--duration` `--label` `--touch` `--touch-delay` `--url` | — |
| `scripts/poc-hmr-perf.mjs` | POC HMR perf — mesure le délai end-to-end entre : 1. `fs.utimes()` (touch) sur un fichier source surveillé par Vite 2. réception du 1er message HMR ("update" ou "full-reload") côté client WS | `--file` `--gap-ms` `--iterations` `--vite-url` | — |
| `scripts/prod-readiness-report.mjs` | prod-readiness-report.mjs — « Nodefony peut-il partir en production ? » | `--at` `--campaign` `--data` `--http-path` `--json` `--minutes` `--only` `--out` `--seconds` `--soak` `--window` | `DATA` `SOAK` |
| `scripts/profile-analyze.mjs` | Relit un profil `--cpu-prof` pris par `profile-cpu.sh` : temps PROPRE agrégé par fonction et par origine (paquet, module node:, natif), FENÊTRÉ sur les 20 dernières secondes actives — le profil couvre aussi le démarrage — et rapporté en µs par requête servie. | `--cpu-prof` | — |
| `scripts/profile-compare.mjs` | Compare DEUX profils pris par `profile-cpu.sh` dans le même décor, poste à poste, en µs par requête. C'est la question qu'un profil isolé ne pose jamais : « combien de trop, et OÙ, par rapport à ce qui est possible ? ». | — | — |
| `scripts/profile-compare.sh` | « Comparé à QUOI ? » — profile Nodefony ET le camp témoin équitable dans le MÊME décor, puis rend l'écart poste par poste en µs par requête. | — | `NF_PROFILE_DIR` |
| `scripts/profile-cpu.sh` | Profil CPU d'un serveur SOUS CHARGE — où part le temps d'une requête. Lance le serveur sous `node --cpu-prof`, le chauffe (wrk non compté), le charge 20 s, puis l'arrête GRACIEUSEMENT (SIGINT : V8 n'écrit le profil qu'à la sortie). Relire ensuite avec `profile-analyze.mjs`, qui fenêtre sur la charge. | `--cpu-prof` `--cpu-prof-dir` `--cpu-prof-interval` | `BENCH_CONN` `BENCH_DUR` `BENCH_LOGIN` `BENCH_PATH` `NF_PROFILE_DIR` `PORT` `XENV` |
| `scripts/promise-map.mjs` | Carte des Promises d'UNE requête — OÙ chacune naît, pile par pile. | `--body` `--method` | `COUNTER_PORT` `PORT` |
| `scripts/promise-sites.mjs` | Carte des sites de création des Promises d'UNE requête (#505) — préchargé par `node --import` dans le serveur mesuré. GET :5199/start ouvre la fenêtre, GET :5199/stop la ferme et rend les piles (JSON). Compteur jumeau, pour la garde : `src/packages/@nodefony/http/nodefony/tests/helpers/promiseCounter.mjs`. ⚠️ Sous crochet, V8 crée une Promise jetable par `await` : le compte vaut « Promises + suspensions » — ne se compare qu'à un camp mesuré pareil (nest-fair : 20, Fastify nu : 2, Express : 0 ; Nodefony avant L2 : 53-57). | — | `NF_PROMISE_COUNTER_PORT` |
| `scripts/ratelimit-e2e.mjs` | Banc e2e du RATE-LIMIT GÉNÉRAL par IP (@nodefony/http, P0.3) — sans navigateur. | — | `MAX` `RL_URL` `URL` |
| `scripts/route-scan-cost.mjs` | route-scan-cost — ce que la RÉSOLUTION DE ROUTE coûte à une application, et comment ce coût grandit avec le nombre de routes. | `--diagnostic` `--json` `--measure` `--reps` `--routes` `--scale` `--target` | `JSON_OUT` |
| `scripts/run.sh` | Wrapper unique du skill load-test. Route vers les suites vitest VERSIONNÉES (non-régression de charge) ou vers les scripts client standalone (exploration). | `--config` `--rupture` | — |
| `scripts/scaffold-ws-probe.mjs` | Sonde : prouve que le job de scaffold est bien streamé sur la socket Nodefony. | — | `NF_STEPS` `NF_WAIT` |
| `scripts/soak.mjs` | soak.mjs — TENUE DANS LA DURÉE d'un process Nodefony sous trafic continu. | `--attendre-charge` `--conn` `--force-charge` `--format` `--latency` `--minutes` `--pid` `--show-toplevel` `--skip` `--url` `--version` `--workspace` | `ATTENDRE_CHARGE` `COEURS` `CONN` `LOG` `MINUTES` `MIN_AMPLITUDE_MB` `MIN_MINUTES` `OUT` `PROBE` `ROOT` `SKIP` `SONDE_ESSAIS` `SONDE_TIMEOUT_MS` `THREADS` `TRANCHE` `TTL_DEROGATION_MIN` `URL` `VCPU_VIRTUALISES` `WINDOW` `WINDOWS` |
| `scripts/span-analyze.mjs` | Relit les fenêtres de `span-probe.mjs` (via `span-run.sh`) et rend, par méthode, la MÉDIANE des runs en ns/requête — brute, puis corrigée du coût de l'enveloppe (étalonné par la sonde, multiplié par les appels imbriqués). | — | — |
| `scripts/span-probe.mjs` | Chronométrage IN SITU des appels d'un étage du pipeline — préchargé dans le serveur COMPLET (`NODE_OPTIONS=--import=…/span-probe.mjs`), jamais dans le produit. | — | `NF_SPAN_PROBE_OUT` |
| `scripts/span-run.sh` | Chronométrage in situ d'un étage (`span-probe.mjs`) sur le serveur Nodefony COMPLET — même décor que `wait-compare.sh` (production, garde machine calme, cible prouvée 200, chauffe non comptée, fenêtre SIGUSR2), sans témoin : la sonde attribue, elle ne compare pas. | — | `BENCH_CONN` `BENCH_DUR` `BENCH_PATH` `NF_SPAN_DIR` |
| `scripts/supervision-stress.mjs` | STRESS COMBINÉ « supervision » — pousse SIMULTANÉMENT 3 lanes (HTTP + WebSocket connexions/messages + ORM/DB) en RAMPE par paliers, pour voir le dashboard de SUPERVISION (CPU, mémoire/heap, GC, event-loop, handles) ET le dashboard ORM bouger d'un seul coup d'œil, jusqu'à la rupture. | — | `BATCH` `ERR_RUPTURE` `HOST` `HTTP_PATH` `HTTP_STEP` `MSG_HZ` `ORM_PATH` `ORM_STEP` `PORT` `STAGES` `STAGE_MS` `WS_PATH` `WS_STEP` |
| `scripts/totp-mfa-attack-e2e.mjs` | Banc ADVERSARIAL 2FA TOTP (P6.17) — red team / blue team, VRAI serveur. | — | — |
| `scripts/totp-mfa-e2e.mjs` | Banc e2e 2FA TOTP step-up (P6.17) — VRAI serveur, sans navigateur. | — | — |
| `scripts/users-admin-factors-e2e.mjs` | Banc e2e — RESET ADMIN des facteurs forts d'un utilisateur (P6.15) — VRAI serveur, session BFF, sans navigateur. Prouve bout-en-bout : NOMINAL (admin ROLE_NODEFONY_ADMIN) : - GET  users/{id}/totp       → 200 (état 2FA) - GET  users/{id}/passkeys   → 200 { credentials } - POST users/{id}/totp/disable → 200 (reset réel) - user inconnu               → 404 ATTACK (anti-IDOR inverse) : - ROLE_USER → 403 sur les 4 endpoints (un user ne reset pas autrui) - anonyme   → 401 | — | `NF_ADMIN_PASSWORD` `NF_USER_PASSWORD` |
| `scripts/wait-analyze.mjs` | Relit les fenêtres de `wait-probe.mjs` (via `wait-compare.sh`) et rend, par camp, la MÉDIANE des runs ramenée à la requête — puis l'écart. | `--json` | — |
| `scripts/wait-compare.sh` | « Où Nodefony ATTEND-il quand le témoin sert ? » — même décor que `profile-compare.sh`, mais sans profileur : la sonde `wait-probe.mjs`, préchargée dans les DEUX camps, encadre la fenêtre de charge et rend ce que le profil CPU ne voit pas (occupation de la boucle, CPU fil principal contre process, GC, tours libuv, écritures socket, changements de contexte). | `--dir` `--interpreted-frames-native` `--perf-basic-prof` | `BENCH_CONN` `BENCH_DUR` `BENCH_PATH` `NF_NATIVE_SAMPLE` `NF_NATIVE_TOP` `NF_WAIT_CUTS` `NF_WAIT_DIR` |
| `scripts/wait-lib.mjs` | Lecture des fenêtres de `wait-probe.mjs` — partagée par `wait-analyze.mjs` (deux camps) et `cut-analyze.mjs` (étages d'une bissection) : un seul calcul « par requête », deux lecteurs. | — | — |
| `scripts/wait-probe.mjs` | Sonde « où part le temps HORS du JavaScript » — préchargée dans un serveur (`node --import …/wait-probe.mjs`), identique pour tous les camps. | — | `NF_WAIT_PROBE_OUT` |
| `scripts/webhooks-dataplane-e2e.mjs` | Banc e2e — Data plane WEBHOOKS (P6.13 Slice C) — VRAI serveur, session BFF, sans navigateur. […] | — | `NF_ADMIN_PASSWORD` `NF_USER_PASSWORD` |
| `scripts/ws-backpressure-e2e.mjs` | Contre-pression WebSocket SORTANTE (serveur → client) sur une VRAIE socket. | — | `BASE` `HOST` `NODE_TLS_REJECT_UNAUTHORIZED` `PORT` `URL` `WS_URL` |
| `scripts/ws-conn-cap-e2e.mjs` | Banc e2e du BACKSTOP de connexions WS concurrentes par IP (@nodefony/http, F6c revue 0.6) — sans navigateur. Prouve le CÂBLAGE bout-en-bout du plafond OPT-IN : au-delà de `wsMaxConnectionsPerIp` sockets simultanément ouvertes depuis une même IP, l'upgrade est fermé (RFC 6455 close 1013). Distinct du rate-limit (débit) : ici ce sont des sockets HELD open EN MÊME TEMPS (pas une rafale séquentielle). | — | `NODE_TLS_REJECT_UNAUTHORIZED` `WS_URL` |
| `scripts/ws-connections.mjs` | Stress WS — AXE 1 : nombre de connexions simultanées (combien de sockets un process tient), distinct du débit messages (axe 2 → ws-messages.mjs). | `--pending` | `BATCH` `CAP` `HEAP_URL` `HOLD_MS` `STEP` `WS_URL` |
| `scripts/ws-handshake-ratelimit-e2e.mjs` | Banc e2e du RATE-LIMIT du HANDSHAKE WebSocket (@nodefony/http, F5 revue 0.6) — sans navigateur. | — | `HTTP_URL` `MAX` `NODE_TLS_REJECT_UNAUTHORIZED` `WS_URL` |
| `scripts/ws-messages.mjs` | Stress WS — AXE 2 : débit de messages / fan-out broadcast (combien de frames le pipeline encaisse), distinct du nombre de connexions (axe 1 → ws-connections.mjs). | — | `BURST` `BURSTS` `CLIENTS` `HOST` `MODE` `TIMEOUT_MS` `WS_URL` |
| `scripts/ws-tls-batching.mjs` | ws-tls-batching.mjs — pourquoi l'écho WebSocket sort plus RAPIDE en TLS qu'en clair sur `capacity.mjs`, preuve sur un serveur `ws` NU (sans Nodefony). | — | `CLIENTS` `PAYLOAD` `RUNS` `WINDOW` `WS_BATCH_PAYLOAD` |

**Invocation telle que documentée dans chaque script :**

```bash
Usage : bash .claude/skills/nodefony-load-test/scripts/run.sh aimd
bash bench-ab-mono.sh <label> [KEY=VAL ...]
import { benchOut } from "./bench-out.mjs"
. "$(dirname "${BASH_SOURCE[0]}")/bench-out.sh"
JSON_OUT=tmp/sink.json node .claude/skills/nodefony-load-test/scripts/log-sink-contention.mjs
Usage : node scripts/boot-bench.mjs <runs> -- <args nodefony...>
Usage : node scripts/boot-profile.mjs -- production --workers 1
node .claude/skills/nodefony-load-test/scripts/capacity.mjs
node .claude/skills/nodefony-load-test/scripts/cluster-health-endpoint-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/cluster-ipc.mjs
node .claude/skills/nodefony-load-test/scripts/cluster-orm-rich-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/cluster-probe-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/cluster-realtime-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/config-env-override-e2e.mjs
Usage : node cut-analyze.mjs <dossier> <témoin> <coupe…> [--partial]
node .claude/skills/nodefony-load-test/scripts/debug-runtime-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/graceful-shutdown-e2e.mjs
node .claude/skills/load-test/scripts/http-load.mjs
bash .claude/skills/nodefony-load-test/scripts/run.sh hub
node ic-sites.mjs <v8.log> [top=40] [filtre=regex sur le fichier]
node .claude/skills/nodefony-load-test/scripts/idempotency-cluster-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/idempotency-postgres-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/idempotency-userland-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/log-sink-contention.mjs
node native-sample.mjs <capture> <rps>                      # un camp
bash perf-campaign.sh [--at HH:MM] [--out DIR] [--soak-min 90] [--tries 3]
node perf-compose.mjs --campaign tmp/perf-campaign-<date> \
Usage :  node .claude/skills/nodefony-load-test/scripts/perf-dossier-report.mjs [sortie.html]
node scripts/poc-bench.mjs [--url http://127.0.0.1:5151/poc/api/data]
node scripts/poc-hmr-perf.mjs --file /abs/path/to/App.tsx
node .claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs
Usage : node profile-analyze.mjs <dossier> [requêtes] [top=40]
Usage : node profile-compare.mjs <dossier A> <dossier B> [top=25]
node promise-map.mjs [url] [--method POST] [--body '{"a":1}'] [KEY=VAL …]
bash .claude/skills/nodefony-start-server/start.sh
node .claude/skills/nodefony-load-test/scripts/route-scan-cost.mjs
Usage : node scaffold-ws-probe.mjs <cookie> [type] [name]
node .claude/skills/nodefony-load-test/scripts/soak.mjs
Usage : node span-analyze.mjs <dossier>
node .claude/skills/nodefony-load-test/scripts/supervision-stress.mjs
Lancement : node .claude/skills/nodefony-load-test/scripts/totp-mfa-attack-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/totp-mfa-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/users-admin-factors-e2e.mjs
Usage : node wait-analyze.mjs <dossier> <campA> <campB> [--json <fichier>]
node .claude/skills/nodefony-load-test/scripts/webhooks-dataplane-e2e.mjs
bash .claude/skills/nodefony-start-server/start.sh
NF__HTTP__WSMAXCONNECTIONSPERIP=3 bash .claude/skills/nodefony-start-server/start.sh
node .claude/skills/load-test/scripts/ws-connections.mjs
bash .claude/skills/nodefony-start-server/start.sh
node .claude/skills/load-test/scripts/ws-messages.mjs
node .claude/skills/nodefony-load-test/scripts/ws-tls-batching.mjs
```

**Toutes les variables lues par ce skill** : `ADMIN_USER` · `ATTENDRE_CHARGE` · `BASE` · `BATCH` · `BENCH_BODY` · `BENCH_CONN` · `BENCH_DUR` · `BENCH_EXPECT_STATUS` · `BENCH_HEADER` · `BENCH_INDEX_TARGET` · `BENCH_LOGIN` · `BENCH_METHOD` · `BENCH_PATH` · `BENCH_ROLE` · `BENCH_THERM_TARGET` · `BENCH_THREADS` · `BENCH_URL` · `BENCH_WARMUP` · `BODY` · `BOOT_TIMEOUT_MS` · `BURST` · `BURSTS` · `CAMPAIGN` · `CAP` · `CHANNEL` · `CLIENTS` · `COEURS` · `CONC` · `CONN` · `COUNTER_PORT` · `DATA` · `DIR` · `DIST` · `DURATION` · `E2E_ROLE` · `ERR_RUPTURE` · `FAIL_TIMEOUT_MS` · `HEAP_URL` · `HOLD` · `HOLD_MS` · `HOST` · `HTTPS_PORT` · `HTTP_PATH` · `HTTP_PORT` · `HTTP_RPS` · `HTTP_SLOW_URL` · `HTTP_STEP` · `HTTP_URL` · `JSON_OUT` · `KEY` · `LIMIT` · `LINES` · `LOG` · `MAX` · `MAX_DISPERSION` · `MAX_SPREAD` · `METHOD` · `MINUTES` · `MIN_AMPLITUDE_MB` · `MIN_ELU_SAMPLES` · `MIN_MINUTES` · `MIN_R2` · `MODE` · `MSG_HZ` · `NF_ADMIN_PASSWORD` · `NF_ADMIN_USER` · `NF_BENCH_ADMIN_PASSWORD` · `NF_BENCH_ADMIN_USER` · `NF_BENCH_CUT` · `NF_BENCH_OUT` · `NF_DATABASE_URL` · `NF_HOST` · `NF_NATIVE_SAMPLE` · `NF_NATIVE_TOP` · `NF_PARITY_CAMPS` · `NF_PG_URL` · `NF_PORT` · `NF_PORT_HTTPS` · `NF_PROFILE_DIR` · `NF_PROMISE_COUNTER_PORT` · `NF_SPAN_DIR` · `NF_SPAN_PROBE_OUT` · `NF_STEPS` · `NF_USER_PASSWORD` · `NF_WAIT` · `NF_WAIT_CUTS` · `NF_WAIT_DIR` · `NF_WAIT_PROBE_OUT` · `NODE_TLS_REJECT_UNAUTHORIZED` · `ONLY` · `ORM_PATH` · `ORM_STEP` · `OUT` · `PAYLOAD` · `PCLR` · `PG_CONTAINER` · `PG_URL` · `PORT` · `PROBE` · `PTLS` · `RATE` · `REPEAT` · `REPS` · `RL_URL` · `ROOT` · `ROUNDS` · `ROUTE` · `ROWS` · `RUNS` · `SEC` · `SERIES` · `SETTLE` · `SKIP` · `SOAK` · `SOAK_MIN` · `SONDE_ESSAIS` · `SONDE_TIMEOUT_MS` · `STAGES` · `STAGE_MS` · `STEP` · `THREADS` · `TIMEOUT_MS` · `TRANCHE` · `TRIES` · `TTL_DEROGATION_MIN` · `URL` · `URL_STR` · `VARIANT` · `VCPU_VIRTUALISES` · `WARMUP` · `WID` · `WINDOW` · `WINDOWS` · `WORKERS` · `WS_BATCH_PAYLOAD` · `WS_PATH` · `WS_STEP` · `WS_URL` · `XENV`

### Détail des scripts auto-documentés

#### `scripts/bench-out.mjs`


```bash
import { benchOut } from "./bench-out.mjs"
```

| Variable | Rôle |
| --- | --- |
| `NF_BENCH_OUT` | dossier des sorties (défaut : <racine du dépôt>/tmp/bench/ab) |

#### `scripts/bench-out.sh`


```bash
. "$(dirname "${BASH_SOURCE[0]}")/bench-out.sh"
```

| Variable | Rôle |
| --- | --- |
| `NF_BENCH_OUT` | dossier des sorties (défaut : <racine du dépôt>/tmp/bench/ab) |

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| en-tête analysable par un vrai parseur YAML | ℹ️ normatif | ✅ |  | spec § frontmatter : « YAML frontmatter » — un en-tête que YAML refuse n'est pas rendu par GitHub, alors que le parseur de l'agent, tolérant, l'accepte sans un mot |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 986 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ❌ | 532 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-load-test/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
