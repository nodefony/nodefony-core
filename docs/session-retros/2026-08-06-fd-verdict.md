---
date: 2026-08-06
session_id: fd-singletons-sans-lookup
focus: F-D wiring figé — mesuré et REJETÉ (A/B dans le bruit), chantier fabrique CLOS
---

# Session retro — 2026-08-06 — F-D

## Fait

- F-D implémenté bout-en-bout : `IServiceWiring` (core) + `IContextWiring` (http), wiring
  figé résolu 1× par HttpKernel (0 alloc/req), 6 lookups container/req supprimés (kernel,
  syslog, HttpKernel, sessions, router, upload), fallback `get()` intact.
- Tests neufs vus ROUGES au débranchement (Service 1/3, Context 1/2) puis verts.
- Toutes suites vertes : core 2595 · http 764 · framework 502 · security 929 ·
  intégration 619 · memory 9/9 · load 27/27.
- A/B mono prod, paires alternées, secteur débridé, flips prouvés par marqueur dist :
  old1 13 426 (1,4 %) · new1 13 203 (2,9 %) · old2 13 418 (0,7 %) · new2 13 539 (1,0 %).
- **Verdict : REJET + revert intégral** — directions opposées entre paires (−1,7 % / +0,9 %),
  moyenne −0,4 %. Critère pré-engagé du kit appliqué (« garder seulement si l'A/B mord »).
  Arbre revenu à HEAD (`5bba2436`), dist rebâti, unit re-confirmées (2592/762).

## Coûts évidents

- 3 séries refusées (dispersion 4,7-6 %) causées par `mds` (Spotlight) qui réindexe les dist
  après chaque rebuild `--force` — ~40 min d'attentes perdues avant le diagnostic.
- Le cycle flip → rebuild → attente froid+mds → mesure : ~15-25 min PAR série. 7 séries.

## Recommandations

1. Garde de banc : intégrer `mds ≤ 2 %` stable (2 checks espacés) à `bench-ab-mono.sh` à
   côté de `cpu_regime()` — candidate si un 2ᵉ banc se fait polluer.
2. Le pattern « critère de conservation écrit AVANT la mesure » à généraliser aux lots
   invasifs (gravé au RETEX).

## Patterns récurrents (déjà gérés)

- ✅ Protocole thermal + cpu_regime (kit perf) — a fonctionné tel quel.
- ✅ Flip par `git show HEAD:` + marqueur dist (kit perf) — 4 flips, 0 incident.

## Commits produits

| Commit | Sujet                                                                   |
| ------ | ----------------------------------------------------------------------- |
| (docs) | verdict F-D au MIGRATION_STATUS + retex — aucun commit de code (revert) |
