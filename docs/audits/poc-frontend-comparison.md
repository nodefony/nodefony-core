---
title: "POC @nodefony/frontend — Comparaison child vs in-proc + décision archi"
date: 2026-05-17
branches:
  - poc/frontend-child
  - poc/frontend-single
status: decision-pending
---

# Comparaison `poc/frontend-child` vs `poc/frontend-single` — Décision archi

## Hypothèse de départ (audit Gemini 2026-05-17)

L'approche **hybride découplée** (Vite dans un child process système séparé)
devait dominer l'approche **in-proc** (Vite dans le même process Node que
Nodefony) sur la latence backend pendant la compilation. Hypothèse fondée sur :

> « Worker Threads et thread principal ont un event-loop partagé, donc tout
>  travail CPU intensif côté Vite bloque les réponses backend. Un child
>  process système isole complètement les deux event-loops. »

## Ce que le POC a mesuré

### Bench HMR-only (le scénario quotidien du dev)

| Métrique                        | child_process | in-proc | Δ        |
| ------------------------------- | ------------- | ------- | -------- |
| Baseline backend p99 (conc=50)  | 213 ms        | 215 ms  | ≈ 0      |
| HMR-touch backend p99           | 175 ms        | 207 ms  | ≈ bruit  |
| Storm 14 rebuilds backend p99   | n/a           | 186 ms  | n/a      |
| Super-storm conc=200 p99        | n/a           | 622 ms  | ≈ baseline 635 |
| HMR end-to-end p50              | 114 ms        | 114 ms  | 0        |
| HMR end-to-end p95              | 263 ms        | 280 ms  | ≈ bruit  |
| Throughput backend (conc=50)    | 473-495 RPS   | 451-470 RPS | ≈ idem |

**Verdict perf brute** : sur le scénario HMR (le 99 % du temps en dev),
**aucune différence détectable**. esbuild + plugin-react sont si optimisés
en incremental que le compil ne fait pas bouger la latence backend même
sous concurrence 200 + 67 rewrites en 15 s.

L'hypothèse du blocage event-loop par compil Vite **ne se valide pas** en
HMR léger. Elle se validerait sur :
- Cold start avec optimizeDeps initial (mais on `await` les 2 supervisors
  avant `Server Listen` → impact transparent pour le client)
- Build prod (`vite.build()`) — **mais c'est in-proc dans les 2 branches**
  car on l'appelle programmatiquement. Non-différenciateur.

## Critères au-delà de la perf brute

| Critère                            | child_process | in-proc | Note |
| ---------------------------------- | ------------- | ------- | ---- |
| **Crash isolation** (Vite plante)  | ✅ Backend survit | ❌ Process meurt | Décisif pour la résilience dev |
| **OOM isolation**                  | ✅ Limites système séparées | ❌ Tas V8 partagé | esbuild peut consommer 200+ MB |
| **GC pressure**                    | ✅ Indépendant | ❌ Pollue heap Nodefony | Affecte tail latency p99 backend en long run |
| **Memory profiling**               | ✅ heap snapshot isolé | ❌ Mêlé | Faciliter `--inspect` sur 1 framework |
| **Multi-cluster (PM2)**            | ✅ 1 Vite partagé / N workers | ❌ N Vites = N copies en RAM | Critique en dev cluster-like |
| **Vision control plane (Phase 10)** | ✅ restart Vite isolé | ❌ stop/start lourd | API admin propre |
| **Surface API typing**             | ✅ minimaliste | ❌ types Vite importés | Risque de couplage transitif |
| **DX logs**                        | ✅ syslog (pipeViteLogs) | ✅ syslog (customLogger) | Identique en pratique |
| **HMR speed (UX dev)**             | 114 ms p50 | 114 ms p50 | Identique |
| **Boot Vite**                      | ~200 ms (spawn + parse "Local:") | ~180 ms (createServer + listen) | Identique en pratique |
| **Complexité code**                | +ViteProcessSupervisor +Generator | ViteInProcSupervisor seul | child + ~50 LoC |

## Décision retenue

🏆 **`poc/frontend-child` — l'approche hybride découplée gagne**, mais
**pas pour la raison perf-only** qui était dans l'hypothèse de départ.

Elle gagne pour :
1. **Crash isolation** (Vite peut planter sans tuer Nodefony — critique en dev)
2. **OOM isolation** (esbuild ~200 MB de pic à l'optimizeDeps initial)
3. **Multi-cluster** (PM2 → 1 Vite shared, pas N copies)
4. **Vision control plane** (admin restart Vite cleanly via SIGTERM)
5. **Observabilité** (heap snapshot, profiling, ps isolés)

Le surcoût de ~50 LoC (Supervisor + ConfigGenerator) est négligeable face à
ces gains structurels.

## Implications opérationnelles

### À mettre dans `@nodefony/frontend` (à promouvoir sur `claude-ts`)

- `ViteProcessSupervisor.ts` (spawn `npx vite`)
- `ViteConfigGenerator.ts` (écrit `vite.config.generated.mjs`)
- `FrontendService.ts` orchestrateur DI
- Presets : react19, vanilla (autres en suivant)
- Commands : frontend:{build,dev,status}
- Décision `pipeViteLogs: true` par défaut (logs Vite dans syslog Nodefony)
- Décision `autoStartInDevelopment: true` par défaut

### À jeter de `poc/frontend-single`

Conserver la branche pour référence historique uniquement. Ne pas merger.
Garder le doc d'audit `poc-frontend-single-perf.md` comme preuve qu'on a
comparé.

### À documenter dans la mémoire IA

Mettre à jour [[project-phase14-frontend-builder]] :
- L'archi 4 (Hybride Découplée) est validée par POC mesuré.
- L'archi 1 (Single thread / in-proc) est **non décisive sur perf HMR** mais
  perdante sur isolation crash/OOM/multi-cluster.

## Prochaines étapes Phase 14

1. **P14.MVP** ✅ — Module skeleton + child supervisor + React preset + bench
   → terminé sur `poc/frontend-child`.
2. **P14.2** — Promouvoir le code sur `claude-ts` (sans préfixe POC), commit
   propre, merger. Décision user-pending.
3. **P14.3** — TemplateHelper prod (lire `manifest.json`, injecter assets fingerprintés).
4. **P14.4** — Preset Vue 3 + Svelte 5 (cohérence multi-framework).
5. **P14.5** — Cluster awareness (1 Vite supervisor / N workers PM2 via IPC).
6. **P14.6** — HMR cross-module (lien avec `watcherService.register` —
   permet aux modules backend de recharger en HMR aussi).
