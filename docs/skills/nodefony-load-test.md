---
title: "nodefony-load-test — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-load-test/SKILL.md"
---

# `nodefony-load-test`

> Charge, stress et DIMENSIONNEMENT HTTP/WebSocket de Nodefony : suites Vitest versionnées (non-régression, sondes de rupture derrière un flag) et une trentaine de scripts autonomes (plafond de connexions WS, débit, RPS et percentiles, capacité d'un pod, e2e cluster).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-load-test**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                    |
| ------------------------ | -------------------------------------------------- |
| Version                  | — (non versionné)                                  |
| Famille                  | Exécuter, diagnostiquer, mesurer                   |
| Corps                    | 443 lignes                                         |
| Coût d'activation        | ~6 930 tokens (le corps est chargé à l'invocation) |
| Description              | 878 / 1024 caractères                              |
| Déclencheurs             | 14                                                 |
| Ressources `references/` | 1 page(s)                                          |
| Scripts                  | 36                                                 |
| Conformité               | ✅ conforme au standard                            |

## Ce qu'il fait

Charge, stress et DIMENSIONNEMENT HTTP/WebSocket de Nodefony : suites Vitest versionnées (non-régression, sondes de rupture derrière un flag) et une trentaine de scripts autonomes (plafond de connexions WS, débit, RPS et percentiles, capacité d'un pod, e2e cluster). **À charger AVANT de lancer un de ces scripts** : le script produit un chiffre, c'est le protocole qui en fait une mesure — décor requis, médiane de N runs, et les pièges qui ont déjà produit des chiffres faux (mesurer sous rafale ne mesure pas la latence, une variance ×3 ne tranche rien).

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **serveur UP** · **redis** · **docker** · **base de données**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`html-report`](nodefony-html-report.md) · [`start-server`](nodefony-start-server.md) · [`tail-error-logs`](nodefony-tail-error-logs.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`test de charge` · `stress` · `benchmark` · `combien de connexions` · `jusqu'à la rupture` · `RPS` · `latence p99` · `est-ce que ça tient la charge ?` · `combien de pods ?` · `c'est plus rapide ?` · `quel est l'impact perf de ce changement ?` · `mesurer avant/après` · `dimensionner` · `prouver que c'est plus rapide`

## Ce que contient le corps

- Niveau 1 — Suites vitest versionnées (non-régression)
- Niveau 2 — Scripts client standalone (exploration)
- Niveau 3 — A/B perf MONO PROD (coût du pipeline par requête)
- Repères empiriques (loopback, machine 32 GB) — pour situer un résultat
- 🚨 RÈGLE N°1 — aucun chiffre sans contrôle de validité
- Publier les résultats (HTML) — et la question à poser AVANT
- Gotchas (vécus — ne pas réapprendre)
- Liens

## Références (chargées à la demande)

- `references/catalogue.md`

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script                                    | Rôle                                                                                                 | Options                                                                  | Variables d'environnement                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/aimd-demo.mjs`                   | aimd-demo — démonstration LISIBLE et déterministe de la cadence adaptative (AIMD).                   | —                                                                        | `DIST`                                                                                                                             |
| `scripts/app-download-probe.mjs`          | —                                                                                                    | —                                                                        | —                                                                                                                                  |
| `scripts/bench-ab-mono.sh`                | Banc perf A/B — mono process PRODUCTION. Mesure le COÛT DU PIPELINE PAR REQUÊTE.                     | `--show-toplevel`                                                        | `BENCH_CONN` `BENCH_DUR` `BENCH_THREADS` `BENCH_URL`                                                                               |
| `scripts/bench-report.mjs`                | Rapport HTML d'un (ou plusieurs) résultats de banc — pour un HUMAIN qui décide.                      | —                                                                        | `OUT`                                                                                                                              |
| `scripts/boot-bench.mjs`                  | boot-bench.mjs — mesure le temps de boot d'un mode Nodefony (du spawn jusqu'à ce que                 | `--workers`                                                              | —                                                                                                                                  |
| `scripts/boot-profile.mjs`                | boot-profile.mjs — AUDIT fin du boot Nodefony. Capture la sortie horodatée d'un boot                 | `--workers`                                                              | —                                                                                                                                  |
| `scripts/capacity-html.mjs`               | capacity-html.mjs — rendu du rapport de capacité.                                                    | `--accent` `--dim` `--rupture`                                           | `PAYLOAD` `REPEAT`                                                                                                                 |
| `scripts/capacity.mjs`                    | capacity.mjs — BANC DE CAPACITÉ + rapport de dimensionnement.                                        | `--http-reqs` `--out` `--rupture` `--skip-ws` `--sockets` `--target`     | `HOST` `NF_ADMIN_PASSWORD` `NF_ADMIN_USER` `NF_HOST` `NF_PORT` `NF_PORT_HTTPS` `OUT` `PAYLOAD` `PCLR` `PTLS` `REPEAT` `ROUTE`      |
| `scripts/cluster-health-endpoint-e2e.mjs` | Preuve BOUT-EN-BOUT de la forme JSON de l'ENDPOINT santé en mode cluster — ce que le                 | —                                                                        | `E2E_ROLE` `SETTLE`                                                                                                                |
| `scripts/cluster-ipc.mjs`                 | Bench du FIL IPC du backplane cluster Nodefony (mode sans PM2) — mesure le coût RÉEL                 | —                                                                        | `BATCH` `BENCH_ROLE` `CHANNEL` `DURATION` `MODE` `PAYLOAD` `RATE` `WORKERS`                                                        |
| `scripts/cluster-orm-rich-e2e.mjs`        | Preuve BOUT-EN-BOUT du RELAIS ORM RICHE @pid (drill cluster, facette "orm") — sans navigateur.       | —                                                                        | `E2E_ROLE` `SETTLE`                                                                                                                |
| `scripts/cluster-probe-e2e.mjs`           | Preuve BOUT-EN-BOUT de la SONDE AGRÉGÉE pod (cluster sans PM2) — Phase 4c, mode push.                | —                                                                        | `E2E_ROLE` `SETTLE`                                                                                                                |
| `scripts/cluster-realtime-e2e.mjs`        | Preuve BOUT-EN-BOUT du realtime cross-process Nodefony (cluster sans PM2) — Phase 4b.                | —                                                                        | `E2E_ROLE` `SETTLE`                                                                                                                |
| `scripts/config-env-override-e2e.mjs`     | Banc e2e TERRAIN — override de config par variable d'environnement (ADR-0006) — sans navigateur.     | —                                                                        | `BOOT_TIMEOUT_MS` `FAIL_TIMEOUT_MS` `HTTPS_PORT` `HTTP_PORT`                                                                       |
| `scripts/debug-runtime-e2e.mjs`           | Banc e2e TERRAIN — debug runtime par-module à chaud — sans navigateur.                               | —                                                                        | —                                                                                                                                  |
| `scripts/graceful-shutdown-e2e.mjs`       | Banc e2e du GRACEFUL SHUTDOWN (@nodefony/http, trous 1+3 revue 0.7) — sans navigateur.               | —                                                                        | `HTTP_SLOW_URL` `PORT` `WS_URL`                                                                                                    |
| `scripts/http-load.mjs`                   | Stress HTTP — N requêtes avec concurrence C sur une route Nodefony.                                  | —                                                                        | `BODY` `METHOD` `URL` `URL_STR`                                                                                                    |
| `scripts/hub-load.mjs`                    | Charge de la SOCKET Nodefony côté HUB (RealtimeHub) — fait bouger le panneau                         | —                                                                        | `BASE` `BATCH` `HOLD` `HOLD_MS` `HOST` `HTTP_PATH` `HTTP_RPS` `MODE` `NODE_TLS_REJECT_UNAUTHORIZED` `PORT` `WS_URL`                |
| `scripts/idempotency-cluster-e2e.mjs`     | Banc CROSS-WORKER de l'idempotence distribuée Redis (cluster multi-process, P6.8) — sans navigateur. | `--workers`                                                              | —                                                                                                                                  |
| `scripts/idempotency-postgres-e2e.mjs`    | Banc CROSS-POD de l'idempotence distribuée Drizzle/PostgreSQL (axe 3, P6.8) — sans navigateur.       | `--profile`                                                              | `CONC` `PG_URL` `ROUNDS`                                                                                                           |
| `scripts/idempotency-userland-e2e.mjs`    | Banc e2e USERLAND @Idempotent contre un VRAI Redis (single-pod, P6.8) — sans navigateur.             | —                                                                        | —                                                                                                                                  |
| `scripts/log-sink-contention.mjs`         | Microbench ISOLÉ du driver de sink de log (LB.W / axe W2).                                           | —                                                                        | `DIR` `JSON_OUT` `LINES` `ONLY` `RUNS` `VARIANT` `WARMUP` `WID` `WORKERS`                                                          |
| `scripts/poc-bench.mjs`                   | POC bench — mesure la latence p50/p95/p99 du backend Nodefony                                        | `--concurrency` `--duration` `--label` `--touch` `--touch-delay` `--url` | —                                                                                                                                  |
| `scripts/poc-hmr-perf.mjs`                | POC HMR perf — mesure le délai end-to-end entre :                                                    | `--file` `--gap-ms` `--iterations` `--vite-url`                          | —                                                                                                                                  |
| `scripts/ratelimit-e2e.mjs`               | Banc e2e du RATE-LIMIT GÉNÉRAL par IP (@nodefony/http, P0.3) — sans navigateur.                      | —                                                                        | `MAX` `RL_URL` `URL`                                                                                                               |
| `scripts/run.sh`                          | Wrapper unique du skill load-test. Route vers les suites vitest VERSIONNÉES                          | `--config` `--rupture`                                                   | —                                                                                                                                  |
| `scripts/scaffold-ws-probe.mjs`           | Sonde : prouve que le job de scaffold est bien streamé sur la socket Nodefony.                       | —                                                                        | `NF_STEPS` `NF_WAIT`                                                                                                               |
| `scripts/supervision-stress.mjs`          | STRESS COMBINÉ « supervision » — pousse SIMULTANÉMENT 3 lanes (HTTP + WebSocket                      | —                                                                        | `BATCH` `ERR_RUPTURE` `HOST` `HTTP_PATH` `HTTP_STEP` `MSG_HZ` `ORM_PATH` `ORM_STEP` `PORT` `STAGES` `STAGE_MS` `WS_PATH` `WS_STEP` |
| `scripts/totp-mfa-attack-e2e.mjs`         | Banc ADVERSARIAL 2FA TOTP (P6.17) — red team / blue team, VRAI serveur.                              | —                                                                        | —                                                                                                                                  |
| `scripts/totp-mfa-e2e.mjs`                | Banc e2e 2FA TOTP step-up (P6.17) — VRAI serveur, sans navigateur.                                   | —                                                                        | —                                                                                                                                  |
| `scripts/users-admin-factors-e2e.mjs`     | Banc e2e — RESET ADMIN des facteurs forts d'un utilisateur (P6.15) — VRAI                            | —                                                                        | —                                                                                                                                  |
| `scripts/webhooks-dataplane-e2e.mjs`      | Banc e2e — Data plane WEBHOOKS (P6.13 Slice C) — VRAI serveur, session BFF,                          | —                                                                        | —                                                                                                                                  |
| `scripts/ws-conn-cap-e2e.mjs`             | Banc e2e du BACKSTOP de connexions WS concurrentes par IP (@nodefony/http, F6c                       | —                                                                        | `NODE_TLS_REJECT_UNAUTHORIZED` `WS_URL`                                                                                            |
| `scripts/ws-connections.mjs`              | Stress WS — AXE 1 : nombre de connexions simultanées (combien de sockets un                          | `--pending`                                                              | `BATCH` `CAP` `HEAP_URL` `HOLD_MS` `STEP` `WS_URL`                                                                                 |
| `scripts/ws-handshake-ratelimit-e2e.mjs`  | Banc e2e du RATE-LIMIT du HANDSHAKE WebSocket (@nodefony/http, F5 revue 0.6) — sans navigateur.      | —                                                                        | `HTTP_URL` `MAX` `NODE_TLS_REJECT_UNAUTHORIZED` `WS_URL`                                                                           |
| `scripts/ws-messages.mjs`                 | Stress WS — AXE 2 : débit de messages / fan-out broadcast (combien de frames                         | —                                                                        | `BURST` `BURSTS` `CLIENTS` `HOST` `MODE` `TIMEOUT_MS` `WS_URL`                                                                     |

**Invocation telle que documentée dans chaque script :**

```bash
Usage : bash .claude/skills/nodefony-load-test/scripts/run.sh aimd
bash bench-ab-mono.sh <label> [KEY=VAL ...]
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
node .claude/skills/nodefony-load-test/scripts/debug-runtime-e2e.mjs
bash .claude/skills/nodefony-start-server/start.sh
node .claude/skills/load-test/scripts/http-load.mjs
bash .claude/skills/nodefony-load-test/scripts/run.sh hub
node .claude/skills/nodefony-load-test/scripts/idempotency-cluster-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/idempotency-postgres-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/idempotency-userland-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/log-sink-contention.mjs
node scripts/poc-bench.mjs [--url http://127.0.0.1:5151/poc/api/data]
node scripts/poc-hmr-perf.mjs --file /abs/path/to/App.tsx
bash .claude/skills/nodefony-start-server/start.sh
Usage : node scaffold-ws-probe.mjs <cookie> [type] [name]
node .claude/skills/nodefony-load-test/scripts/supervision-stress.mjs
Lancement : node .claude/skills/nodefony-load-test/scripts/totp-mfa-attack-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/totp-mfa-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/users-admin-factors-e2e.mjs
node .claude/skills/nodefony-load-test/scripts/webhooks-dataplane-e2e.mjs
NF__HTTP__WSMAXCONNECTIONSPERIP=3 bash .claude/skills/nodefony-start-server/start.sh
node .claude/skills/load-test/scripts/ws-connections.mjs
bash .claude/skills/nodefony-start-server/start.sh
node .claude/skills/load-test/scripts/ws-messages.mjs
```

**Toutes les variables lues par ce skill** : `BASE` · `BATCH` · `BENCH_CONN` · `BENCH_DUR` · `BENCH_ROLE` · `BENCH_THREADS` · `BENCH_URL` · `BODY` · `BOOT_TIMEOUT_MS` · `BURST` · `BURSTS` · `CAP` · `CHANNEL` · `CLIENTS` · `CONC` · `DIR` · `DIST` · `DURATION` · `E2E_ROLE` · `ERR_RUPTURE` · `FAIL_TIMEOUT_MS` · `HEAP_URL` · `HOLD` · `HOLD_MS` · `HOST` · `HTTPS_PORT` · `HTTP_PATH` · `HTTP_PORT` · `HTTP_RPS` · `HTTP_SLOW_URL` · `HTTP_STEP` · `HTTP_URL` · `JSON_OUT` · `LINES` · `MAX` · `METHOD` · `MODE` · `MSG_HZ` · `NF_ADMIN_PASSWORD` · `NF_ADMIN_USER` · `NF_HOST` · `NF_PORT` · `NF_PORT_HTTPS` · `NF_STEPS` · `NF_WAIT` · `NODE_TLS_REJECT_UNAUTHORIZED` · `ONLY` · `ORM_PATH` · `ORM_STEP` · `OUT` · `PAYLOAD` · `PCLR` · `PG_URL` · `PORT` · `PTLS` · `RATE` · `REPEAT` · `RL_URL` · `ROUNDS` · `ROUTE` · `RUNS` · `SETTLE` · `STAGES` · `STAGE_MS` · `STEP` · `TIMEOUT_MS` · `URL` · `URL_STR` · `VARIANT` · `WARMUP` · `WID` · `WORKERS` · `WS_PATH` · `WS_STEP` · `WS_URL`

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 878    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 443    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-load-test/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
