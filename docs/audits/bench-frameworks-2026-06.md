---
title: Banc comparatif frameworks — Nodefony vs Express / Fastify / node nu
date: 2026-06-11
branch: poc/api-souveraine
status: mesuré — verdict rendu
depends_on: request-lifecycle-plan-2026-06.md (backlog « chiffre manquant »)
outils: .claude/skills/nodefony-load-test/bench-frameworks/ (apps + bench.sh) · scripts/bench-ab-mono.sh (Nodefony)
---

# Banc comparatif frameworks — le chiffre manquant du fast path

Objectif (backlog du plan cycle requête) : **chiffrer le ROI du chantier « fast path »
P2/P3b avant de l'engager**. L'objectif produit est « perfs ≥ Express/Fastify » — on ne
disposait d'aucune mesure côte à côte.

## Protocole (équité stricte)

- Même machine, même fenêtre (~6 min, dérive contrôlée 1,2 % par re-bench Nodefony).
- `wrk -t4 -c128 -d10s` × 3 runs → médiane (protocole `bench-ab-mono.sh`).
- **186 routes** par app, route de bench en **position #31** (réplique de l'app dev
  Nodefony, cf `project_request_cycle_perf_plan_kit`), routes paramétrées.
- Payload JSON identique : la réponse de `AlsController.state`
  (`/nodefony/test/als-test/state`).
- `NODE_ENV=production`, logs off (`NF_LOG_DRIVER=null` côté Nodefony, `logger: false`
  côté Fastify), HTTP clair, mono-process.
- Versions : node 26.3.0 · Express 5.1 · Fastify 5.x.

## Résultats (2026-06-11)

| Cible                         |       RPS | × vs Nodefony | % du plafond machine |
| ----------------------------- | --------: | ------------: | -------------------: |
| node:http nu (0 routing)      |    23 985 |         4,55× |                100 % |
| Fastify 5 (index radix)       |    20 782 |         3,95× |                 87 % |
| Fastify + fast-json-stringify |    20 620 |         3,92× |                 86 % |
| Express 5 (scan linéaire)     |    11 740 |         2,23× |                 49 % |
| **Nodefony (mono prod)**      | **5 264** |            1× |                 22 % |

Contrôle de fenêtre : Nodefony re-benché en fin de série = 5 329 RPS (+1,2 % = bruit).

## Décomposition de l'écart ×4,55 — ce qui décide du plan

1. **Nodefony → Express = ×2,23 — ce n'est PAS le routing.** Express 5 scanne ses
   routes **linéairement comme Nodefony**, avec les mêmes 186 routes, et double quand
   même le débit. Cette tranche = **coût par requête** : allocations
   Context/Request/Response, scope DI, audit, hooks, metaData.
2. **Express → Fastify = ×1,77** : index radix (find-my-way) + pipeline plus mince.
   C'est la part maximale que rapporterait l'index de routes seul.
3. **Fastify → nu = ×1,15** : plancher incompressible d'un framework.

Enseignement secondaire : **fast-json-stringify est neutre** sur petit payload
(20 620 ≈ 20 782) — la sérialisation par schéma n'est pas une piste pour Nodefony.

## Verdict

- **Le chantier fast path est justifié** : plafond de ROI ×4 (rejoindre Fastify).
- **Mais l'ordre d'attaque change** : l'index de routes seul ne capterait que la
  tranche 2 (≤ ×1,8). Le plus gros gisement (×2,2) est le **travail par requête** —
  ce qui ré-ouvre les candidats #4/#5 (scope DI/reflect, allocs Context) classés à tort
  « ROI faible » par `project_perf_candidates_remaining` (le grattage micro était épuisé,
  pas le structurel).

## Plan du chantier fast path (ordre imposé par le banc)

1. **Banc de non-régression routing complet** (prérequis absolu — matching « 1er match
   ordre d'insertion », 405, wildcard, domain, WS).
2. **Profil ciblé du delta vs Express** (`node --prof` sur la route de bench) : où
   partent les ~0,10 ms/req d'écart → leviers chiffrés, pas devinés.
3. **Leviers coût/requête** (allocs Context/Request/Response, scope DI, reflect
   résiduel) — A/B chacun, gardé seulement si > bruit ±5 %.
4. **Index de routes** : map exacte (routes littérales) → fallback scan regex
   (paramétrées/wildcard) — la tranche Express→Fastify.

## Reproduire

```bash
# Nodefony (flip TEMPORAIRE @nodefony/test policy dev→optional + build, REVERT ensuite)
bash .claude/skills/nodefony-load-test/scripts/bench-ab-mono.sh nodefony

# Concurrents (sandbox isolé, npm install au premier usage)
cd .claude/skills/nodefony-load-test/bench-frameworks && npm install
bash bench.sh bare 5161
bash bench.sh express 5162
bash bench.sh fastify 5163
FASTIFY_SCHEMA=1 bash bench.sh fastify 5163 FASTIFY_SCHEMA=1
```

> ⚠️ Machine calme obligatoire (leçon « fausse régression 7000→3674 » = charge Brave).
> Toujours re-bencher une cible en fin de série pour valider la fenêtre.
