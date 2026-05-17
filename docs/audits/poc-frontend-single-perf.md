---
title: "POC @nodefony/frontend — branche in-process — mesures perf"
date: 2026-05-17
branch: poc/frontend-single
machine: darwin 24.6.0, Node 26.1.0
status: validated
---

# POC `@nodefony/frontend` — Branche `poc/frontend-single` — Mesures perf

## Setup

- **Architecture** : `ViteInProcSupervisor` lance Vite via `vite.createServer()` DANS le process Node backend. Vite partage l'event-loop, le tas V8 et l'AsyncContext avec Nodefony.
- **Cleanup** : `await server.close()` au `onTerminate`.
- **Reste identique à `poc/frontend-child`** : même module, même test consumer React, mêmes presets, même builder, même TemplateHelper, même API publique `IViteSupervisor`. **Seul `ViteProcessSupervisor.ts` → `ViteInProcSupervisor.ts` change** (et `ViteConfigGenerator.ts` est supprimé — inutile en in-proc).
- **Boot Vite** : ~180 ms entre `createServer + listen` (vs ~200 ms spawn child branche jumelle).

## Mesures — Bench 1 : latence backend HTTP

| Scenario                          | Conc. | Total req | Errors | RPS | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
| --------------------------------- | ----- | --------- | ------ | --- | -------- | -------- | -------- | -------- |
| **Baseline** (no Vite activity)   | 50    | 4734      | 0      | 470 | 100.28   | 154.48   | 214.61   | 361.08   |
| **HMR triggered @ 2s** (touch)    | 50    | 4652      | 0      | 463 | 101.10   | 161.12   | 206.96   | 274.04   |
| **Storm** (14 rewrites/15s)       | 50    | 6949      | 0      | 451 | 105.57   | 145.09   | 185.51   | 288.11   |
| **Baseline conc=200**             | 200   | 6728      | 0      | 438 | 442.10   | 537.36   | 635.32   | 773.58   |
| **Super-storm conc=200** (67 rewrites/15s @ 200ms) | 200 | 6801 | 0 | 444 | 437.53 | 546.74 | 622.39 | 739.96 |

**Storm protocol** : `--touch-interval 200` (rewrites toutes les 200ms — Vite recompile ~67 fois en 15s, validé via `[vite] hmr update /src/App.tsx` dans le syslog).

## Mesures — Bench 2 : latence HMR end-to-end (touch → patch reçu)

| Statistique                  | Valeur (ms) |
| ---------------------------- | ----------- |
| Iterations                   | 8 (0 fail)  |
| p50                          | 114.51      |
| p95                          | 279.78      |
| p99                          | 279.78      |
| min                          | 11.79       |
| max (= iter 0, cold)         | 279.78      |
| mean                         | 113.07      |

## Verdict

✅ **HMR-only : aucune différence perf significative entre in-proc et child.**

Le coût des transformations Vite (esbuild incremental + plugin-react HMR) est trop faible pour faire bouger l'aiguille à 50-200 concurrence backend. La p99 reste dans le bruit de mesure.

⚠️ **Mais perf n'est PAS le seul critère.** Voir comparaison + décision dans `poc-frontend-comparison.md`.

## Reproduction

```bash
# Sur la branche poc/frontend-single :
npm install && npm run build
node -e "/* spawn detached nodefony development */" > /tmp/nodefony-server.log 2>&1 &
# Attendre "Server Listen on wss"

# Warmup graphe Vite (nécessaire pour activer le watch)
curl -s http://127.0.0.1:5173/src/main.tsx > /dev/null

# Bench 1 — latence backend
node scripts/poc-bench.mjs --duration 10000 --concurrency 50 --label baseline
node scripts/poc-bench.mjs --duration 15000 --concurrency 200 \
  --label super-storm --touch <App.tsx> --touch-delay 1000 --touch-interval 200

# Bench 2 — HMR end-to-end
node scripts/poc-hmr-perf.mjs --file <App.tsx> --entries src/main.tsx \
  --iterations 8 --gap-ms 2000
```
