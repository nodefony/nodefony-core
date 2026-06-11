---
title: Profil du delta Nodefony vs Express — où partent les ticks par requête
date: 2026-06-11
branch: poc/api-souveraine
status: profilé — leviers chiffrés, à A/B un par un
depends_on: bench-frameworks-2026-06.md (verdict ×2,23 = coût/req, pas le routing)
méthode: node --prof sous wrk 30 s (reference_perf_profiling_method), même route/payload/186 routes
---

# Profil du delta vs Express — étape 2 du chantier fast path

Le banc comparatif a montré Nodefony→Express = **×2,23 SANS que le routing soit en
cause** (Express scanne linéairement aussi). Ce profil attribue le delta fonction
par fonction — chaque levier sera A/B (`bench-ab-mono.sh`) avant d'être gardé.

## Protocole

- `node --prof` sur les DEUX serveurs (Nodefony mono prod `NF_LOG_DRIVER=null` ;
  Express 5 prod), wrk `-t4 -c128 -d30s`, même route/payload/table de 186 routes,
  arrêt gracieux SIGINT (flush V8). Analyse `--prof-process` : `[Summary]`,
  `[JavaScript]`, bottom-up (piège macOS : le faux symbole natif fourre-tout —
  lire ses ENFANTS JS, cf `reference_perf_profiling_method`).
- ⚠️ Les RPS sous `--prof` ne sont PAS comparables au banc (fenêtre différente +
  overhead profiler) — seules les **distributions** comptent.

## CPU par requête (normalisation ticks/req)

|          | RPS (30 s, sous --prof) | ticks totaux | **ticks / req** |
| -------- | ----------------------: | -----------: | --------------: |
| Nodefony |      8 084 (~242 k req) |      ~17 884 |      **0,0737** |
| Express  |     17 591 (~528 k req) |      ~24 709 |      **0,0468** |

→ **CPU/req = ×1,57** (le reste de l'écart RPS = GC + latence/jitter).
GC : Nodefony 2,1 % vs Express 0,8 % du profil → **GC/req ≈ ×4,4** (pression
allocation, cohérent avec le ressenti « alloc/req » des profils antérieurs).

## Leviers Nodefony chiffrés (part du profil total, ticks self/subtree)

| #      | Levier                                      |                                  Poids | Détail                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------- | -------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | **Audit `renderHttp` par requête**          |           **~5,9 %** (1 055 t subtree) | LE plus gros poste JS identifié. `logRequest` → objet 14 champs + `new Date().toISOString()` + `phases.map` + `JSON.stringify` + **Pdu poussé au ring** — alors que `NF_LOG_DRIVER=null` = AUCUN consommateur. Corrobore le « skip total = +14,6 % » mesuré le 2026-06-05.             |
| **T2** | **Pdu sous le seuil construits quand même** |                       ~1,7 % (≈ 311 t) | `Syslog.log` n'a **AUCUN gate de sévérité** : un log DEBUG en prod (ex. `Match route : ${name}` du Router, template string construite par requête) crée le Pdu + `pushStack` au ring pour RIEN. Gate boot-time (re-résoluble pour l'« audit à chaud ») + messages lazy aux call sites. |
| **T3** | **`response.setTimeout` par requête**       | ~2,6 % (465 t self `setStreamTimeout`) | `HttpContext.handle()` → `this.setTimeout()` arme un timeout + closure sur CHAQUE réponse, alors que `server.setTimeout` + `requestTimeout` sont DÉJÀ configurés au boot côté serveur. Doublon probable → vérifier la sémantique puis supprimer/conditionner.                          |
| **T4** | **Churn de listeners**                      |   ~1,9 % (345 t self `removeListener`) | Teardown détache des paires finish/close par requête ; Express n'attache quasi rien par requête (invisible chez lui). Mutualiser au niveau serveur où possible.                                                                                                                        |
| **T5** | Scope DI enter/leave                        |                       ~0,8 % (≈ 150 t) | Résiduel après le durcissement Container (+6 %). Basse priorité.                                                                                                                                                                                                                       |
| —      | Routing `Router.resolve` scan               |                 **0,9 %** (161 t self) | **CONFIRMÉ : le scan O(N) n'est PAS le goulet** — l'index radix (étape 4) aura un gain borné.                                                                                                                                                                                          |

Somme attribuée ≈ 13 % du profil JS-visible + leur amplification native
(allocations servies par le fourre-tout C++ 64 %) + GC ×4,4 → couvre l'essentiel
du ×1,57 CPU/req.

## Ce que paie Express (et qu'on ne paie pas)

Son scan router = **8 %** (`next`) + `parseurl` 2,5 % + **etag par réponse** 1,1 % +
parse `content-type` 1,4 % — Express « gaspille » ~13 % en routing/etag et gagne
quand même : son plancher hors routing est bien plus bas. C'est la preuve inverse
du verdict du banc : **le gisement est le coût fixe par requête, pas le matching**.

## Plan d'attaque (étape 3 du chantier — 1 levier = 1 A/B)

1. **T1 audit** : gate boot-time « pas de consommateur → pas de renderHttp »
   (driver null + 0 transport + 0 listener `onLog` → skip), ring d'audit sur
   opt-in. Choix produit à valider : l'audit 4xx/5xx peut rester toujours-ON
   (erreurs = faible volume), seul le 2xx nominal est gaté.
2. **T2 syslog** : seuil de sévérité résolu au boot DEVANT `createPDU`/`pushStack`
   (re-résoluble — compat vision « audit à chaud » `project_log_audit_window_vision`) ;
   retirer les template strings des call sites hot path (router).
3. **T3 timeout** : auditer la sémantique `response.setTimeout` vs
   `server.setTimeout`/`requestTimeout` → supprimer le doublon par requête.
4. **T4 listeners** : inventaire des listeners attachés/req au teardown, mutualiser.
5. Re-bench comparatif (`bench-frameworks/`) après chaque lot gardé.

Gates par lot : `bench-ab-mono.sh` paires alternées (> bruit ±5 % sinon jeter) +
`npm run test:integration` http + `npm run test:memory` + banc routing
(`routing-nonregression.test.ts`).

## Reproduire

```bash
# Nodefony (flip policy @nodefony/test dev→optional + build, REVERT après)
node --prof src/nodefony/bin/nodefony production   # NODE_ENV=production NF_LOG_DRIVER=null
wrk -t4 -c128 -d30s http://127.0.0.1:5151/nodefony/test/als-test/state
kill -INT <pid>   # flush V8 — JAMAIS kill -9
node --prof-process isolate-*.log > prof.txt

# Express (sandbox bench-frameworks ; SIGINT handler intégré aux apps)
NODE_ENV=production PORT=5162 node --prof .claude/skills/nodefony-load-test/bench-frameworks/express.mjs
```
