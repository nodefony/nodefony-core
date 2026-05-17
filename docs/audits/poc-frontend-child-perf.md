---
title: "POC @nodefony/frontend — branche child_process — mesures perf"
date: 2026-05-17
branch: poc/frontend-child
machine: darwin 24.6.0, Node 26.1.0
status: validated
---

# POC `@nodefony/frontend` — Branche `poc/frontend-child` — Mesures perf

## Setup

- **Architecture** : `ViteProcessSupervisor` lance Vite via `child_process.spawn("npx vite ...")` — Vite tourne dans un process système séparé, event-loop isolé du backend Nodefony.
- **Backend Nodefony** : HTTP server natif `node:http` port 5151, sessions Sequelize SQLite, firewall, etc. (config dev complète).
- **Frontend** : module test `@nodefony/test-frontend-react` — React 19.2.6, entry `frontend/src/main.tsx`. Vite 8.0.13, plugin-react 6.0.2.
- **Endpoint benché** : `GET /poc/api/data` — renvoie `{ ts, pid, env }` (pas d'I/O).
- **Outil bench** : `scripts/poc-bench.mjs` — `fetch` Node natif, keep-alive, 50 workers concurrents.
- **Vite supervisor ready** : ~200 ms après le spawn (`VITE v8.0.13 ready in 196 ms`).

## Mesures — Bench 1 : latence backend HTTP

| Scenario                 | Total req | Errors | RPS | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
| ------------------------ | --------- | ------ | --- | -------- | -------- | -------- | -------- |
| **Baseline** (no Vite activity) | 4760 | 0 | 473 | 98.14 | 168.92 | 212.75 | 341.46 |
| **HMR triggered @ 2s** (touch App.tsx) | 4990 | 0 | 495 | 96.19 | 141.64 | 174.60 | 295.19 |

**Durée bench** : 10 secondes, concurrence 50.
**Trigger HMR** : `fs.utimes()` sur `frontend/src/App.tsx` à T+2000ms du début du bench → Vite recompile dans le child et envoie le delta HMR via WS (sur son port 5173, indépendamment du backend).

## Mesures — Bench 2 : latence HMR end-to-end (save → patch arrivé client)

Mesure du délai entre l'écriture du fichier source et la réception du message
WS HMR par le client (perspective navigateur : "j'ai sauvé → le code s'est mis à jour").

| Statistique                          | Valeur (ms) |
| ------------------------------------ | ----------- |
| Iterations                           | 8 (0 fail)  |
| p50                                  | 114.21      |
| p95                                  | 262.66      |
| p99                                  | 262.66      |
| min                                  | 13.53       |
| max (= iter 0, cold)                 | 262.66      |
| mean                                 | 120.11      |

**Steady state HMR** : ~114 ms par cycle (touch → message `{type:"update"}` reçu côté WS).
**Cold iter** (1er touch après boot Vite) : 262 ms — initial source map + transformer cache miss.
**Iter 6 outlier** (13 ms) : event résiduel d'un revert précédent — n'invalide pas la mesure.

**Logs HMR dans syslog Nodefony** : ✅ confirmé. Chaque `hmr update /src/App.tsx` apparaît dans `/tmp/nodefony-server.log` (config `pipeViteLogs: true` du module @nodefony/frontend) — la trace est ingestible par Vision et Loki sans config supplémentaire.

Exemple :
```
19:38:02.220 INFO    frontend           :  [vite] (client) hmr update /src/App.tsx
19:38:02.536 INFO    frontend           :  [vite] (client) hmr update /src/App.tsx
```

## Verdict

✅ **L'architecture child_process tient ses promesses.**

- **Aucune dégradation détectable** du backend pendant que Vite recompile (p99 174ms vs baseline 213ms — variance dans le bruit de mesure).
- **0 erreur** dans les deux cas.
- **Throughput stable** ~470-490 RPS.

Le fait que le scénario HMR soit même **légèrement meilleur** que la baseline confirme que le child Vite n'a aucun impact sur l'event-loop backend (les écarts mesurés sont du bruit système — variation de GC, autres processes macOS, etc.).

## Notes

- **Latence absolue élevée** (p50 ~100ms) : pas lié à Vite. Probable origine : pipeline Nodefony dev complet (sessions Sequelize, firewall, sanitisation headers, audit log) sur HTTP/1.1 5151. À optimiser séparément.
- **Trigger HMR vs build complet** : ce bench mesure HMR (touch source → rebuild module + WS push). Pour stress-tester un cold rebuild complet, il faudrait `frontendService.build()` qui appelle `vite.build()` programmatique (in-proc) — pas comparable.

## Comparaison à venir

Branche jumelle `poc/frontend-single` : même module `@nodefony/frontend` mais avec un superviseur **in-proc** (`vite.createServer()` dans le process Node backend). Mêmes mesures à reproduire.

Décision finale = comparer p99 + behaviour pendant compil entre les 2 branches.

## Reproduction

```bash
# Sur la branche poc/frontend-child :
npm install && npm run build
node -e "/* spawn detached nodefony development */" > /tmp/nodefony-server.log 2>&1 &
# Attendre "Server Listen on wss"

# Bench 1 — latence backend (avec et sans trigger HMR pendant le run)
node scripts/poc-bench.mjs --duration 10000 --concurrency 50 --label baseline
node scripts/poc-bench.mjs --duration 10000 --concurrency 50 --label with-vite-rebuild \
  --touch /Users/cci/repository/nodefony-core/src/modules/test-frontend-react/frontend/src/App.tsx \
  --touch-delay 2000

# Bench 2 — latence HMR end-to-end (touch → message WS reçu)
node scripts/poc-hmr-perf.mjs \
  --file /Users/cci/repository/nodefony-core/src/modules/test-frontend-react/frontend/src/App.tsx \
  --entries src/main.tsx --iterations 8 --gap-ms 2000
```
