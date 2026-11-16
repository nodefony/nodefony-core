---
title: "Performance — les chiffres, et ce qu'ils valent"
navTitle: Performance
updated: 2026-11-16
lang: fr
module: "global"
topic: perf-index
section: "Performance"
audience: [developer, devops]
tags: [performance, benchmark, mesure, comparaison, dimensionnement]
status: stable
source: "docs/performance/"
---

📍 [Documentation](../index.md) › **Performance**

> 📊 **Les mesures de la version courante, avec leurs figures :**
> [nodefony.net/performance/latest](https://nodefony.net/performance/latest/) — comparatif, base
> de données, tenue dans la durée, dimensionnement d'un pod. Les données qui les nourrissent sont
> versionnées dans [`data/`](data/README.md).

Ce dossier tient en trois pages : celle-ci résume ; [Où part le temps](analyses.md) décompose le
budget d'une requête ; [Méthode de mesure](methode.md) dit comment un nombre devient une mesure,
et quels instruments ont menti. Chaque chiffre porte son décor et la commande qui le rejoue : il
est écrit pour être contesté.

## Ce qui a été mesuré

Campagne du 15 novembre 2026, Node 26.13.1, un seul processus, sur un portable de 2018 (Intel
Core i9-8950HK, 12 cœurs logiques, 32 Go, macOS) — générateur de charge sur la même machine. Les
absolus sont donc bas pour tous ; seuls les rapports entre camps, mesurés en alternance dans la
même fenêtre, sont exploitables.

Les témoins rendent le **même résultat observable** que Nodefony — statut, en-têtes de sécurité,
identifiant de requête, `traceparent`, CORS, contrôle anti-CSRF, zones du pare-feu —, vérifié par
un contrôle de parité avant chaque campagne : Express 5.3.0 équipé, NestJS 12.5.0 équipé sur
Fastify 5.12.8 et sur `node:http`, et pour la base Drizzle 0.45.4 avec better-sqlite3 13.1.1 des
deux côtés.

| Mesure                                      | Résultat                                                              |
| ------------------------------------------- | --------------------------------------------------------------------- |
| route triviale, face à NestJS (Fastify)     | Nodefony à 96,2 % — CPU du fil principal ×1,04                        |
| route triviale, face à NestJS (node:http)   | Nodefony à 82,8 % — ~10 µs par requête, décomposés étage par étage    |
| route triviale, face à Express équipé       | Nodefony à 99,7 % — dans le bruit, ~22 200 req/s chacun               |
| lecture + écriture SQLite, Express / NestJS | 105,7 % / 106,3 %                                                     |
| POST validé, Express / NestJS               | 103,3 % / 106,6 %                                                     |
| POST refusé (422), Express / NestJS         | **79,2 %** / 120,4 % — sans base, la réception du corps est suspectée |
| tenue, 90 min sous charge                   | aucune fuite (tas plat, ressources stables), débit −1 %               |
| résolution du banc (test nul)               | 97,7 % et 100 %                                                       |

La route triviale ne fait rien : le framework y est 100 % du budget, c'est le cas où il pèse le
plus. Dès qu'une base entre dans la boucle, le cycle approche la milliseconde et l'écart entre
frameworks en devient une fraction.

## Ce que ces chiffres ne disent pas

- **La parité prouve le résultat, pas le travail.** Nodefony ouvre une portée d'injection par
  requête, tient un contexte commun à HTTP et WebSocket, arme un délai de réponse : ce travail
  invisible est mesuré, et ses pistes de gain nommées, dans [Où part le temps](analyses.md).
- **90 minutes ne sont pas trois jours** : le banc de tenue écarte les fuites grossières, pas les
  lentes.
- **Aucun absolu n'est transposable** : poste de développement, base dans le processus.
- **PostgreSQL** n'est pas comparé (camp Nodefony dédié à venir), et le multi-pod sous trafic réel
  relève d'autres bancs.

## Les trois pages

### [`index`](index.md) — les chiffres et ce qu'ils valent

Cette page : ce qui a été mesuré, face à quoi, et les réserves qui le bornent.

### [`analyses`](analyses.md) — où part le temps

Le budget d'une requête étage par étage, ce que chaque framework fait faire à Node, le travail
que la parité ne voit pas, la base de données, le binaire temps réel, et ce qui reste ouvert.

### [`methode`](methode.md) — comment un chiffre devient une mesure

Le protocole des paires alternées, les gardes de décor, la qualité des séries publiées, et les
instruments qui ont menti. À lire avant de rejouer ou de contester un chiffre.

## Rejouer

```bash
# toute la campagne, de nuit
caffeinate -dims bash .claude/skills/nodefony-load-test/scripts/perf-campaign.sh --at 01:30
# le fichier publié, recomposé depuis les séries brutes
node .claude/skills/nodefony-load-test/scripts/perf-compose.mjs \
  --campaign tmp/bench/perf-campaign-<date> --data docs/performance/data/10.0.0.json
# le site, depuis les données versionnées
node scripts/site/build-perf-site.mjs --out tmp/sites/perf
```

## Pour aller plus loin

- 🧭 [Par où commencer](../demarrer.md) — les parcours guidés de la documentation
- 🔬 [Où part le temps](analyses.md) — le budget d'une requête, décomposé
- 📐 [Méthode de mesure](methode.md) — le protocole et les instruments qui ont menti
- 🗂️ [Les données versionnées](data/README.md) — ce que contient un jeu, comment en ajouter un
- ⚖️ [ADR-0028](../adr/0028-temoins-nommes-pages-performance.md) — pourquoi les témoins sont nommés
